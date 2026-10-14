// 이벤트 NPC "도둑 잡기 경찰관":
// 내 캐릭터가 도둑 → 신랑·신부와 하객 몇 명이 쫓아온다.
// 잡힐 때까지 버틴 시간을 기록한다 (api/chase.js).
// - 추격자는 기존 GuestCharacter.tickControlled의 실제 이동 입력을 사용한다.
// - 전체 경로를 유지하고, 다음 발판에 실제로 도착했을 때 구간을 완료한다.
// - 목표에 접근하지 못하거나 이동 구간을 끝내지 못하면 대체 경로를 찾는다.
// - 실패 구간 제외는 추격자마다 따로 적용하며 잠시 뒤 다시 사용할 수 있다.
// - 일반 플레이어 물리·속도·잡힘 거리·기록 저장·경품 규칙은 변경하지 않는다.

const Chase = (() => {
  const el = document.getElementById('chase-modal');
  const modal = UI.setupModal(el);
  const $ = (sel) => el.querySelector(sel);
  const form = $('.chase-start');
  const errorEl = $('.chase-error');
  const resultEl = $('.chase-result');
  const cfg = CONFIG.chase;

  let password = ''; // 재도전용 비밀번호는 현재 페이지 메모리에만 보관
  let busy = false;
  let mine = null;
  let game = null;
  let hooks = null; // main.js: { scene(), mine(), play() }

  const api = (body) => postJson('/api/chase', body);
  const fmtTime = (ms) => `${(ms / 1000).toFixed(1)}초`;

  const board = eventBoard(el, {
    path: '/api/chase',
    title: '🏆 오래 버티기 랭킹',
    score: (r) => fmtTime(r.ms),
    password: {
      get: () => password,
      set: (pw) => (password = pw),
    },
    isPlaying: () => Boolean(game),
    close: () => modal.close(),
  });

  // 화면 위 타이머와 그만하기 버튼
  const hud = document.createElement('div');
  hud.className = 'chase-hud';
  hud.hidden = true;
  hud.innerHTML =
    '<span class="chase-time">⏱ 0.0초</span>' +
    '<button type="button" class="chase-quit">그만하기</button>';

  // 화면 가운데 카운트다운
  const countEl = document.createElement('div');
  countEl.className = 'chase-count';
  document.body.append(hud, countEl);

  hud.querySelector('.chase-quit').addEventListener('click', () => {
    finish('stop');
  });

  function showError(msg) {
    errorEl.textContent = msg || '';
    errorEl.hidden = !msg;
  }

  /** settings: NPC 설정 버튼용 함수. result: 방금 끝난 게임 결과 */
  function open(settings, result) {
    if (game) return;

    mine = UI.getMine?.();
    board.reset(mine, settings);

    $('.chase-need').hidden = Boolean(mine);
    $('.chase-pw').hidden = !mine;
    $('.chase-go').hidden = !mine;
    $('.chase-go').textContent = result ? '다시 도전' : '도전하기';

    form.elements.password.value = password;
    resultEl.hidden = !result;

    if (result) {
      resultEl.textContent = `⏱ ${fmtTime(result.ms)} 버텼어요!`;
      board.render({
        ranking: result.ranking,
        hasContact: result.hasContact,
        prize: result.prize,
      });
    }

    showError('');
    modal.open();
    board.load();
  }

  // 도전 시작: 비밀번호 확인 → 토큰 발급 → 창 닫고 게임 시작
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || !mine) return;

    const pw = form.elements.password.value;
    if (!pw) return showError('비밀번호를 입력해 주세요.');

    if (!mine.info.number) {
      return showError('방금 만든 캐릭터는 1~2분 뒤에 도전할 수 있어요.');
    }

    const s = hooks?.scene();
    const me = hooks?.mine();

    if (!s || !me) {
      return showError('내 캐릭터를 찾지 못했어요. 새로고침 후 다시 시도해 주세요.');
    }

    busy = true;
    showError('');
    $('.chase-go').textContent = '확인 중...';

    try {
      const r = await api({
        action: 'start',
        number: mine.info.number,
        id: mine.info.id,
        password: pw,
      });

      password = pw;
      modal.close();
      begin(s, me, r.token, r.countdown);
    } catch (err) {
      showError(err.message);
    } finally {
      busy = false;
      $('.chase-go').textContent = '도전하기';
    }
  });

  // ---------- 게임 ----------

  function begin(s, me, token, countdown) {
    hooks.play();

    // 추격자: 신랑·신부 + 나를 제외한 활성 하객 중 무작위 선택
    const others = Phaser.Utils.Array.Shuffle(
      s.guests.filter((g) => g !== me && g.active)
    ).slice(0, cfg.guests);

    const graph = buildGraph();

    const chasers = [
      ...s.couple.map((c) => ({ c, speed: cfg.coupleSpeed })),
      ...others.map((c) => ({ c, speed: cfg.guestSpeed })),
    ];

    for (const { c, speed } of chasers) {
      if (s.control.controlled === c) s.control.release();

      // 카운트다운 동안은 추격 입력을 보내지 않는다.
      c.startChase(brain(c, me, graph), 0);
      c.chaseSpeed = speed;

      const p = farPoint(me);
      c.dropAt(p.name, p.x);
    }

    const startAt = performance.now() + countdown;
    game = {
      s,
      me,
      token,
      chasers,
      startAt,
      started: false,
      over: false,
    };

    s.onTick = tick;
    hud.hidden = false;
    hud.querySelector('.chase-time').textContent = `⏱ ${fmtTime(0)}`;

    const steps = Math.round(countdown / 1000);

    for (let i = 0; i <= steps; i++) {
      setTimeout(() => {
        if (game?.token !== token) return;
        flashCount(i < steps ? String(steps - i) : '도망쳐!');
      }, i * 1000);
    }
  }

  function flashCount(text) {
    countEl.textContent = text;
    countEl.classList.remove('show');
    void countEl.offsetWidth;
    countEl.classList.add('show');
  }

  /** 충분히 멀리 떨어진 발판 위를 선택한다. 못 찾으면 가장 먼 후보 사용 */
  function farPoint(me) {
    let best = null;

    for (let i = 0; i < 40; i++) {
      const floor = pickGuestFloor();
      const name = Object.keys(CONFIG.floors).find(
        (n) => CONFIG.floors[n] === floor
      );
      const { x1, x2 } = floorSpan(floor);
      const x = Phaser.Math.Between(Math.ceil(x1), Math.floor(x2));
      const d = Math.hypot(x - me.x, floorY(floor, x) - me.y);

      if (!best || d > best.d) best = { name, x, d };
      if (d >= cfg.minStartDist) break;
    }

    return best;
  }

  function tick() {
    const g = game;
    if (!g || g.over) return;

    const now = performance.now();

    if (!g.started && now >= g.startAt) {
      g.started = true;

      for (const { c } of g.chasers) {
        c.chaser.speed = c.chaseSpeed;
        c.say(Phaser.Utils.Array.GetRandom(cfg.lines), 1800);
      }
    }

    hud.querySelector('.chase-time').textContent =
      `⏱ ${fmtTime(Math.max(0, now - g.startAt))}`;

    if (g.s.control.controlled !== g.me) return finish('stop');
    if (!g.started) return;

    // 기존 잡힘 거리 기준 유지
    const caught = g.chasers.some(
      ({ c }) =>
        Math.abs(c.x - g.me.x) < cfg.catchX &&
        Math.abs(c.y - g.me.y) < cfg.catchY
    );

    if (caught) finish('caught');
  }

  /** 종료 → 서버에 기록 저장 → 추격 해제 → 결과 창 */
  async function finish(reason) {
    const g = game;
    if (!g || g.over) return;

    g.over = true;
    g.s.onTick = null;

    for (const { c } of g.chasers) {
      if (c.chaser) c.chaser.speed = 0;
    }

    if (reason === 'caught') {
      flashCount('잡혔다!');
      g.me.floatText('🚨', { size: 26, rise: 30 });
    }

    let result = null;

    try {
      result = await api({
        action: 'end',
        token: g.token,
      });
    } catch (err) {
      UI.showToast(err.message, 3000);
    }

    setTimeout(() => {
      for (const { c } of g.chasers) {
        if (c.active && c.chaser) c.stopChase();
      }

      hud.hidden = true;
      game = null;

      if (result) open(null, result);
    }, reason === 'caught' ? 1400 : 300);
  }

  // 탭이 숨겨지면 게임 화면만 멈춘 채 시간이 늘어나지 않도록 종료
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) finish('stop');
  });

  // ---------- 추격 경로 ----------

  /** x에서 y 아래에 있는 가장 가까운 발판. except 발판은 제외 */
  function landingBelow(x, y, except) {
    let best = null;

    for (const [name, f] of Object.entries(CONFIG.floors)) {
      if (name === except) continue;

      const { x1, x2 } = floorSpan(f);
      if (x < x1 || x > x2) continue;

      const fy = floorY(f, x);

      if (fy >= y - 0.5 && (!best || fy < best.y)) {
        best = { name, y: fy };
      }
    }

    return best;
  }

  /** 발판 이름 → 이동 경로 목록 */
  function buildGraph() {
    const jumpUp = 50;
    const g = {};
    const names = Object.keys(CONFIG.floors);
    const control = CONFIG.motion.control;
    let serial = 0;

    // 실패한 구간만 잠시 제외할 수 있도록 구간별 식별자를 붙인다.
    const add = (from, e) => {
      (g[from] ??= []).push({
        ...e,
        from,
        key: `edge-${serial++}`,
      });
    };

    const safeJumpHeight = Math.min(
      jumpUp,
      (control.jumpVelocity * control.jumpVelocity) /
        (2 * control.gravity) - 8
    );

    for (const a of names) {
      const fa = CONFIG.floors[a];
      const { x1, x2 } = floorSpan(fa);

      for (const dir of [-1, 1]) {
        const edge = dir > 0 ? x2 : x1;
        const next = floorContinuation(a, dir);

        if (next) {
          // 이어진 발판으로 넘어갈 때 실제 도착 범위를 반영한다.
          const ns = floorSpan(CONFIG.floors[next]);
          const land = Math.min(Math.max(edge, ns.x1), ns.x2);

          add(a, {
            to: next,
            x: edge,
            act: 'walk',
            dir,
            land,
          });
          continue;
        }

        const fall = landingBelow(
          edge + dir * 10,
          floorY(fa, edge),
          a
        );

        if (fall) {
          add(a, {
            to: fall.name,
            x: edge,
            act: 'fall',
            dir,
            land: edge + dir * 10,
          });
        }

        for (const t of gapJumpTargets(a, edge, dir)) {
          add(a, {
            to: t.name,
            x: edge,
            act: 'gap',
            dir,
            land: t.x,
          });
        }
      }

      for (const b of names) {
        if (b === a) continue;

        const fb = CONFIG.floors[b];
        const sb = floorSpan(fb);
        const lo = Math.max(x1, sb.x1) + 8;
        const hi = Math.min(x2, sb.x2) - 8;

        if (lo > hi) continue;

        const x = (lo + hi) / 2;
        const dy = floorY(fb, x) - floorY(fa, x);

        if (
          dy > 2 &&
          landingBelow(x, floorY(fa, x) + 2, a)?.name === b
        ) {
          add(a, {
            to: b,
            x,
            act: 'drop',
            land: x,
          });
        } else if (dy < 0 && dy >= -jumpUp) {
          add(a, {
            to: b,
            x,
            act: 'jump',
            land: x,
          });
        }
      }
    }

    for (const c of CONFIG.climbs) {
      if (!c.floors.every((n) => CONFIG.floors[n])) continue;

      const { top, bottom } = climbEnds(c);

      if (bottom.name) {
        add(bottom.name, {
          to: top.name,
          x: c.x,
          act: 'up',
          land: c.x,
        });
      }

      const down = bottom.name
        ? bottom
        : landingBelow(
            c.x,
            bottom.y + control.grabHeight,
            top.name
          );

      if (down) {
        add(top.name, {
          to: down.name,
          x: c.x,
          act: 'down',
          land: c.x,
        });
      }

      // 발판에서 점프해 사다리·로프 중간이나 매달린 끝을 잡는다.
      for (const name of names) {
        if (name === top.name || name === bottom.name) continue;

        const floor = CONFIG.floors[name];
        const { x1, x2 } = floorSpan(floor);
        if (c.x < x1 || c.x > x2) continue;

        const footY = floorY(floor, c.x);
        const handY = footY - control.grabHeight;

        if (footY <= top.y + 2) continue;
        if (handY <= top.y - 4) continue;
        if (handY - safeJumpHeight >= bottom.y + 4) continue;

        add(name, {
          to: top.name,
          x: c.x,
          act: 'grab',
          dir: -1,
          land: c.x,
          climbType: c.type,
          climbTop: top.name,
          climbBottom: bottom.name,
          climbEnd: bottom.y,
        });
      }
    }

    return g;
  }

  /** 이동 구간의 예상 동작 시간. 경로 선택·실패 판단용이며 실제 속도는 변경하지 않는다. */
  function actionMs(e, speed) {
    const control = CONFIG.motion.control;
    const walk = Math.max(1, control.walkSpeed * speed);
    const y0 = floorY(CONFIG.floors[e.from], e.x);
    const y1 = floorY(CONFIG.floors[e.to], e.land);
    const vertical = Math.abs(y1 - y0);

    if (
      e.act === 'up' ||
      e.act === 'down' ||
      e.act === 'grab'
    ) {
      return (
        (vertical / control.climbSpeed) * 1000 +
        (e.act === 'grab' ? 800 : 150)
      );
    }

    if (e.act === 'jump' || e.act === 'gap') {
      return Math.max(
        750,
        (Math.abs(e.land - e.x) / walk) * 1000 + 150
      );
    }

    if (e.act === 'fall' || e.act === 'drop') {
      return (
        Math.sqrt((2 * vertical) / control.gravity) * 1000 + 250
      );
    }

    return 120;
  }

  /**
   * 목적 발판까지의 전체 경로를 찾는다.
   * 같은 발판이라도 도착 x가 다르면 별도 상태로 계산한다.
   * blocked는 이 추격자에게서 최근 실패한 구간의 임시 제외 목록이다.
   */
  function findRoute(graph, from, x, to, speed, blocked, now) {
    if (
      !CONFIG.floors[from] ||
      !CONFIG.floors[to] ||
      from === to
    ) {
      return [];
    }

    const walk = Math.max(
      1,
      CONFIG.motion.control.walkSpeed * speed
    );

    const states = new Map();
    states.set('start', {
      floor: from,
      x,
      cost: 0,
      route: [],
      done: false,
    });

    for (;;) {
      let u = null;

      for (const state of states.values()) {
        if (!state.done && (!u || state.cost < u.cost)) {
          u = state;
        }
      }

      if (!u) return [];
      if (u.floor === to) return u.route;

      u.done = true;

      for (const e of graph[u.floor] ?? []) {
        if ((blocked.get(e.key) ?? 0) > now) continue;

        const cost =
          u.cost +
          (Math.abs(e.x - u.x) / walk) * 1000 +
          actionMs(e, speed);

        const key = `${e.to}@${e.land}`;
        const old = states.get(key);

        if (!old || cost < old.cost) {
          states.set(key, {
            floor: e.to,
            x: e.land,
            cost,
            route: [...u.route, e],
            done: false,
          });
        }
      }
    }
  }

  // ---------- 추격 입력 ----------

  function brain(c, target, graph) {
    const mem = {
      clock: 0,
      route: [],
      goal: null,
      edge: null,
      edgeStarted: 0,
      edgeBudget: 0,
      bestDistance: Infinity,
      progressAt: 0,
      retryAt: 0,
      blocked: new Map(),
      jumpCd: 0,
      climbDir: -1,
      airX: null,
      grabStep: null,
      lastMode: null,
      escapeUntil: 0,
      escapeDir: 1,
    };

    const sameClimb = (a, b) =>
      Boolean(
        a &&
        b &&
        a.type === b.type &&
        Math.abs(a.x - b.x) < 1 &&
        a.top.name === b.top.name &&
        a.bottom.name === b.bottom.name &&
        Math.abs(a.top.y - b.top.y) < 1 &&
        Math.abs(a.bottom.y - b.bottom.y) < 1
      );

    const matchesGrab = (climb, step) =>
      Boolean(
        climb &&
        step &&
        climb.type === step.climbType &&
        Math.abs(climb.x - step.x) < 1 &&
        climb.top.name === step.climbTop &&
        climb.bottom.name === step.climbBottom &&
        Math.abs(
          climb.bottom.y -
          (
            step.climbEnd +
            (step.climbBottom
              ? 0
              : CONFIG.motion.control.grabHeight)
          )
        ) < 1
      );

    const clearRoute = () => {
      mem.route = [];
      mem.edge = null;
      mem.grabStep = null;
    };

    // 같은 구간을 진행하는 동안 제한 시간과 진행 상황을 초기화하지 않는다.
    const activate = (edge) => {
      if (mem.edge === edge) return;

      mem.edge = edge;
      mem.edgeStarted = mem.clock;
      mem.bestDistance = Math.abs(edge.x - c.x);
      mem.progressAt = mem.clock;

      const walk = Math.max(
        1,
        CONFIG.motion.control.walkSpeed * c.chaser.speed
      );

      mem.edgeBudget =
        (mem.bestDistance / walk) * 1000 +
        actionMs(edge, c.chaser.speed) +
        2400;
    };

    // 해당 추격자에게 실패한 구간만 5초 동안 피한다.
    const failEdge = () => {
      if (mem.edge?.key) {
        mem.blocked.set(mem.edge.key, mem.clock + 5000);
      }

      clearRoute();
      mem.airX = null;
      mem.retryAt = 0;
    };

    return (delta) => {
      const input = {
        left: false,
        right: false,
        up: false,
        down: false,
        jump: false,
      };

      const out = {
        ...input,
        consumeJump: () => input.jump,
      };

      const p = c.phys;

      // 카운트다운·종료 후에는 추격 입력을 보내지 않는다.
      if (!c.chaser?.speed || !p) return out;

      const control = CONFIG.motion.control;
      const elapsed = Math.max(0, Math.min(delta, 50));
      const dt = elapsed / 1000;
      const moveStep =
        control.walkSpeed * c.chaser.speed * dt;

      // 물리 처리와 같은 시간 단위를 사용한다.
      mem.clock += elapsed;
      mem.jumpCd = Math.max(0, mem.jumpCd - elapsed);

      for (const [key, until] of mem.blocked) {
        if (until <= mem.clock) mem.blocked.delete(key);
      }

      // 한 프레임 이동량을 고려해 목표 좌표 양옆의 반복 반전을 줄인다.
      const tolerance = Math.max(3, moveStep + 0.5);

      const go = (distance) => {
        if (distance < -tolerance) input.left = true;
        else if (distance > tolerance) input.right = true;
      };

      // 발판 끝으로 계속 나아갈 때는 거리 판정과 방향 입력을 분리한다.
      const goDir = (dir) => {
        input.left = dir < 0;
        input.right = dir > 0;
      };

      const jump = () => {
        if (mem.jumpCd > 0) return false;

        input.jump = true;
        mem.jumpCd = 600;
        return true;
      };

      const targetPhys = target.phys;
      const targetClimb =
        targetPhys?.mode === 'climb'
          ? targetPhys.climb
          : null;

      if (
        p.mode === 'ground' &&
        mem.lastMode !== 'ground'
      ) {
        mem.airX = null;
        mem.grabStep = null;

        // 같은 발판으로 되돌아온 실패한 점프는 경로와 제한 시간을 유지한다.
      }

      mem.lastMode = p.mode;

      // ---------- 사다리·로프 위 ----------

      if (p.mode === 'climb') {
        mem.grabStep = null;
        mem.escapeUntil = 0;

        if (sameClimb(p.climb, targetClimb)) {
          const dy = target.y - c.y;
          const climbTolerance = Math.max(
            2,
            control.climbSpeed * dt + 0.5
          );

          input.up = dy < -climbTolerance;
          input.down = dy > climbTolerance;
        } else {
          input.up = mem.climbDir < 0;
          input.down = mem.climbDir > 0;
        }

        return Object.assign(out, input);
      }

      // ---------- 공중 ----------

      if (p.mode === 'air') {
        const aimX =
          mem.grabStep?.x ?? mem.airX ?? target.x;

        go(aimX - c.x);

        // 추격자만 목표 x에서 가로 관성을 멈춘다.
        if (!input.left && !input.right) p.vx = 0;

        if (mem.grabStep) {
          const grab = c.findClimb(-1, null);

          if (matchesGrab(grab, mem.grabStep)) {
            input.up = true;
            mem.climbDir = -1;
          }
        }

        return Object.assign(out, input);
      }

      // ---------- 지상 ----------

            // ---------- 지상 ----------

      const dx = target.x - c.x;

      // 대상이 점프 중이면 현재 위치 바로 아래의 착지 후보 발판을 확인한다.
      const targetLandingFloor =
        targetPhys?.mode === 'air'
          ? landingBelow(target.x, target.y, null)?.name
          : target.floorName;

      // 같은 발판으로 착지할 대상은 불필요하게 따라 점프하지 않고 지상에서 추격한다.
      if (
        (
          targetPhys?.mode === 'ground' ||
          targetPhys?.mode === 'air'
        ) &&
        Boolean(c.floorName) &&
        c.floorName === targetLandingFloor
      ) {
        clearRoute();
        mem.escapeUntil = 0;

        // 엎드린 상태라면 먼저 일어난다.
        if (p.prone) input.up = true;

        go(dx);
        return Object.assign(out, input);
      }

      let goalFloor;

      if (targetClimb) {
        goalFloor = targetClimb.top.name;
      } else if (targetPhys?.mode === 'air') {
        goalFloor =
          landingBelow(target.x, target.y, null)?.name;
      } else {
        goalFloor = target.floorName;
      }

      // 다음 발판에 실제로 도착했을 때만 구간 완료.
      // 경로 전체를 버리지 않고 그다음 구간을 이어서 실행한다.
      if (
        mem.edge &&
        c.floorName !== mem.edge.from
      ) {
        if (
          c.floorName === mem.edge.to &&
          mem.route[0] === mem.edge
        ) {
          mem.route.shift();
          mem.edge = null;
        } else {
          // 예상과 다른 발판에 착지했다면 경로를 다시 찾는다.
          failEdge();
        }
      }

      // 대상의 목적 발판이 바뀌었을 때 경로를 새로 계산한다.
      if (mem.goal !== goalFloor) {
        clearRoute();
        mem.goal = goalFloor;
        mem.retryAt = 0;
        mem.escapeUntil = 0;
      }

            // 대체 경로가 없으면 잠시 방향을 고정해 걷는다.
      // 이 탈출 처리에서는 불필요한 점프를 실행하지 않는다.
      if (mem.escapeUntil > mem.clock) {
        goDir(mem.escapeDir);

        if (p.prone) input.up = true;

        return Object.assign(out, input);
      }

      // 대상이 매달린 로프의 상단에 도착하면 아래로 내려간다.
      if (
        targetClimb &&
        c.floorName === targetClimb.top.name
      ) {
        const key =
          `target-rope-${targetClimb.type}-` +
          `${targetClimb.x}-${targetClimb.top.name}`;

        if (!mem.edge || mem.edge.key !== key) {
          const e = {
            key,
            from: c.floorName,
            to: targetClimb.bottom.name || c.floorName,
            x: targetClimb.x,
            land: targetClimb.x,
            act: 'down',
          };

          mem.route = [e];
          activate(e);
        }
      } else if (
        !mem.route.length &&
        mem.clock >= mem.retryAt
      ) {
        mem.route = findRoute(
          graph,
          c.floorName,
          c.x,
          goalFloor,
          c.chaser.speed,
          mem.blocked,
          mem.clock
        );

                if (!mem.route.length) {
          // 경로가 없다는 이유만으로 점프하지 않는다.
          // 짧게 방향을 고정해 걸어서 이동한 뒤 경로를 다시 찾는다.
          mem.escapeDir =
            Math.sign(dx) ||
            (Math.random() < 0.5 ? -1 : 1);

          mem.escapeUntil = mem.clock + 450;
          mem.retryAt = mem.clock + 900;
          mem.airX = c.x + mem.escapeDir * 45;

          goDir(mem.escapeDir);

          if (p.prone) input.up = true;

          return Object.assign(out, input);
        }
      }

      const e = mem.route[0];

      if (!e) {
        return Object.assign(out, input);
      }

      activate(e);

      const near = Math.abs(e.x - c.x);
      const actionRange = Math.min(
        control.grabRange - 1,
        Math.max(5, tolerance)
      );

      // 좌우로 움직였는지가 아니라 목표에 더 가까워졌는지 확인한다.
      if (near < mem.bestDistance - 2) {
        mem.bestDistance = near;
        mem.progressAt = mem.clock;
      }

      const approachStalled =
        near > actionRange &&
        mem.clock - mem.progressAt > 1600;

      // 반복 점프·왕복으로도 구간을 끝내지 못하면 실패로 처리한다.
      const actionTimedOut =
        mem.clock - mem.edgeStarted > mem.edgeBudget;

      if (approachStalled || actionTimedOut) {
        failEdge();

        if (p.prone) input.up = true;

        return Object.assign(out, input);
      }

      // 내려가기 이외의 동작에서는 엎드린 자세부터 해제한다.
      if (
        p.prone &&
        e.act !== 'drop' &&
        e.act !== 'down'
      ) {
        input.up = true;
        return Object.assign(out, input);
      }

      if (e.act === 'walk') {
        goDir(e.dir);
      } else if (e.act === 'fall') {
        goDir(e.dir);
        mem.airX = e.land;
      } else if (e.act === 'gap') {
        goDir(e.dir);

        if (
          near <= Math.max(14, moveStep + 2) &&
          jump()
        ) {
          mem.airX = e.land;
        }
      } else if (near > actionRange) {
        go(e.x - c.x);
      } else if (
        e.act === 'up' ||
        e.act === 'down'
      ) {
        mem.climbDir = e.act === 'up' ? -1 : 1;
        input.up = e.act === 'up';
        input.down = e.act === 'down';
        mem.airX = e.land;
      } else if (e.act === 'grab') {
        if (jump()) {
          mem.grabStep = e;
          mem.airX = e.x;
          mem.climbDir = -1;
        }
      } else if (e.act === 'drop') {
        input.down = true;
        input.jump = true;
        mem.airX = e.land;
      } else if (e.act === 'jump') {
        if (jump()) {
          mem.airX = e.land;
        }
      }

      return Object.assign(out, input);
    };
  }

  return {
    open,
    /** main.js에서 scene(), mine(), play() 연결 */
    attach(h) {
      hooks = h;
    },
  };
})();
