// 이벤트 NPC "도둑 잡기 경찰관":
// 내 캐릭터가 도둑 → 신랑·신부와 하객 몇 명이 쫓아옴.
// 잡힐 때까지 버틴 시간을 기록한다 (api/chase.js).
// - 시작: 비밀번호 확인 → 창 닫기 → 플레이 모드 → 카운트다운 → 추격
// - 추격자는 GuestCharacter.tickControlled에 추격 입력을 전달한다.
// - 추격자에 한해 공중 이동 목표에 도달하면 가로 속도를 멈춘다.
// - 조종을 놓거나 다른 탭으로 가면 그 자리에서 종료한다.
// - 랭킹·연락처·개발자 관리 칸은 공통 js/board.js를 사용한다.

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
    hooks.play(); // 기존 플레이 모드 진입 동작 유지

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

    // 3·2·1 → 도망쳐!
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

    // 로비·관람 모드 등으로 조종을 놓으면 종료
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

  // ---------- 추격 AI ----------
  // 발판을 노드로, 이동 방법을 간선으로 구성한다.
  // 걷기·낙하·점프·사다리·로프·발판 통과·점프해서 로프 잡기를 지원한다.
  // 그래프는 게임마다 한 번 만들고, 추격 경로는 진행 중 갱신한다.

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
    const add = (from, e) => (g[from] ??= []).push(e);
    const names = Object.keys(CONFIG.floors);
    const control = CONFIG.motion.control;

    // 실제 점프 최고점보다 여유를 두어 로프 잡기 경로를 계산한다.
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
          add(a, {
            to: next,
            x: edge,
            act: 'walk',
            dir,
            land: edge,
          });
          continue;
        }

        // 발판 끝에서 걸어 나가 아래 발판으로 떨어지기
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

        // 가까운 발판으로 점프해서 건너가기
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
          // 바로 아래 발판으로 엎드려 내려가기
          add(a, {
            to: b,
            x,
            act: 'drop',
            land: x,
          });
        } else if (dy < 0 && dy >= -jumpUp) {
          // 위쪽 발판으로 점프해 착지하기
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

      // 아래 발판이 연결된 사다리·로프는 바로 올라갈 수 있다.
      if (bottom.name) {
        add(bottom.name, {
          to: top.name,
          x: c.x,
          act: 'up',
          land: c.x,
        });
      }

      // 아래 끝이 허공이면 손을 놓은 뒤 착지할 발판을 찾는다.
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

        // 로프 바로 아래에 설 수 있는 발판만 연결한다.
        if (c.x < x1 || c.x > x2) continue;

        const footY = floorY(floor, c.x);
        const handY = footY - control.grabHeight;

        if (footY <= top.y + 2) continue;

        // 점프 중 손 높이가 잡기 범위 안으로 들어오는지 확인한다.
        const highestHandY = handY - safeJumpHeight;
        if (handY <= top.y - 4) continue;
        if (highestHandY >= bottom.y + 4) continue;

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

  /** 현재 발판과 x에서 목적 발판으로 가는 첫 이동 구간 */
  function firstStep(graph, from, x, to) {
    const dist = { [from]: 0 };
    const pos = { [from]: x };
    const first = {};
    const done = new Set();

    for (;;) {
      let u = null;

      for (const n in dist) {
        if (!done.has(n) && (u === null || dist[n] < dist[u])) {
          u = n;
        }
      }

      if (u === null) return null;
      if (u === to) return first[u] ?? null;

      done.add(u);

      for (const e of graph[u] ?? []) {
        // 동작 지점까지의 가로 거리 + 동작당 기본 비용
        const d = dist[u] + Math.abs(e.x - pos[u]) + 40;

        if (d < (dist[e.to] ?? Infinity)) {
          dist[e.to] = d;
          pos[e.to] = e.land;
          first[e.to] = first[u] ?? e;
        }
      }
    }
  }

  /** 추격자 한 명의 이동 입력을 생성한다. */
  function brain(c, target, graph) {
    const mem = {
      still: 0,
      lastX: c.x,
      lastY: c.y,
      wander: 0,
      wanderDir: 1,
      jumpCd: 0,
      climbDir: -1,
      step: null,
      stepAt: 0,
      stepFrom: null,
      stepTo: null,
      airX: null,
      grabStep: null,
      lastMode: null,
    };

    // 실제로 같은 사다리·로프인지 확인한다.
    // 매달린 끝의 bottom.y에는 grabHeight가 더해져 있다.
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

    // 지금 잡을 수 있는 구조물이 경로에서 노린 구조물인지 확인한다.
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
            (step.climbBottom ? 0 : CONFIG.motion.control.grabHeight)
          )
        ) < 1
      );

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
      const dt = Math.min(delta, 50) / 1000;
      const moveStep = control.walkSpeed * c.chaser.speed * dt;
      const tolerance = Math.max(3, moveStep / 2 + 0.1);
      const targetPhys = target.phys;
      const targetClimb =
        targetPhys?.mode === 'climb' ? targetPhys.climb : null;

      // 빠르게 이동할 때 목표 좌표 양옆을 반복해서 넘지 않도록
      // 한 프레임 이동량을 고려해 도착 허용 범위를 잡는다.
      const go = (distance) => {
        if (distance < -tolerance) input.left = true;
        else if (distance > tolerance) input.right = true;
      };

      const jump = () => {
        if (mem.jumpCd > 0) return false;

        input.jump = true;
        mem.jumpCd = 600;
        return true;
      };

      mem.jumpCd = Math.max(0, mem.jumpCd - delta);

      // 착지하면 이전 공중 이동 목표를 끝내고 경로를 다시 찾는다.
      if (p.mode === 'ground' && mem.lastMode !== 'ground') {
        mem.airX = null;
        mem.grabStep = null;
        mem.step = null;
        mem.still = 0;
      }

      mem.lastMode = p.mode;

      // 지상에서 일정 시간 거의 움직이지 못하면 막힘으로 판단한다.
      const moved = Math.hypot(c.x - mem.lastX, c.y - mem.lastY);

      mem.still =
        p.mode === 'ground' && moved < 0.5
          ? mem.still + delta
          : 0;

      mem.lastX = c.x;
      mem.lastY = c.y;

      if (p.mode === 'climb') {
        mem.wander = 0;
        mem.grabStep = null;

        // 같은 사다리·로프 위에 있으면 대상의 실제 높이를 따라간다.
        if (sameClimb(p.climb, targetClimb)) {
          const dy = target.y - c.y;
          const climbTolerance = Math.max(
            2,
            control.climbSpeed * dt / 2 + 0.1
          );

          input.up = dy < -climbTolerance;
          input.down = dy > climbTolerance;
        } else {
          // 다른 곳의 대상에게 가는 중이면 계획한 끝점까지 이동한다.
          input.up = mem.climbDir < 0;
          input.down = mem.climbDir > 0;
        }

        return Object.assign(out, input);
      }

      if (p.mode === 'air') {
        const aimX = mem.grabStep?.x ?? mem.airX ?? target.x;
        go(aimX - c.x);

        // 추격자에 한해 목표 x에 도달하면 남은 가로 속도를 멈춘다.
        // 일반 플레이어의 조작 코드는 변경하지 않는다.
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

      // 막혔을 때 잠깐 좌우 이동과 점프로 빠져나온다.
      if (mem.still > 1000) {
        mem.still = 0;
        mem.wander = 800;
        mem.wanderDir = Math.random() < 0.5 ? -1 : 1;
        mem.step = null;
        mem.grabStep = null;
      }

      if (mem.wander > 0) {
        mem.wander -= delta;
        go(mem.wanderDir * 10);
        jump();
        return Object.assign(out, input);
      }

      const dx = target.x - c.x;

      // 대상이 실제로 지상에 있을 때만 같은 발판 직접 추격을 사용한다.
      // 공중·매달림 상태에서는 이전 floorName만으로 판단하지 않는다.
      if (
        targetPhys?.mode === 'ground' &&
        c.floorName === target.floorName
      ) {
        mem.step = null;
        go(dx);
        return Object.assign(out, input);
      }

      let goalFloor;

      if (targetClimb) {
        // 매달린 대상은 해당 사다리·로프의 상단 발판으로 접근한다.
        goalFloor = targetClimb.top.name;
      } else if (targetPhys?.mode === 'air') {
        // 공중의 대상은 현재 위치 아래의 발판을 임시 목적지로 삼는다.
        goalFloor = landingBelow(target.x, target.y, null)?.name;
      } else {
        goalFloor = target.floorName;
      }

      let e = null;

      // 대상이 매달린 로프의 상단에 도착하면 아래로 내려가 추격한다.
      // 아래 끝에 발판이 없는 로프도 대상에게 접근할 수 있게 한다.
      if (targetClimb && c.floorName === targetClimb.top.name) {
        e = {
          x: targetClimb.x,
          act: 'down',
          land: targetClimb.x,
        };
      } else {
        const now = performance.now();

        // 현재 발판·목적 발판이 바뀌거나 0.3초가 지나면 경로 갱신
        if (
          !mem.step ||
          mem.stepFrom !== c.floorName ||
          mem.stepTo !== goalFloor ||
          now - mem.stepAt > 300
        ) {
          mem.step = goalFloor
            ? firstStep(graph, c.floorName, c.x, goalFloor)
            : null;

          mem.stepFrom = c.floorName;
          mem.stepTo = goalFloor;
          mem.stepAt = now;
        }

        e = mem.step;
      }

      if (!e) {
        // 등록된 경로가 없으면 기존처럼 대상의 가로 방향으로 이동한다.
        go(dx);
        return Object.assign(out, input);
      }

      const near = Math.abs(e.x - c.x);
      const actionRange = Math.max(5, tolerance);

      if (e.act === 'walk') {
        go(e.dir * 10);
      } else if (e.act === 'fall') {
        go(e.dir * 10);
        mem.airX = e.land;
      } else if (e.act === 'gap') {
        go(e.dir * 10);
        if (near < 14 && jump()) mem.airX = e.land;
      } else if (near > actionRange) {
        go(e.x - c.x);
      } else if (e.act === 'up' || e.act === 'down') {
        mem.climbDir = e.act === 'up' ? -1 : 1;
        input.up = e.act === 'up';
        input.down = e.act === 'down';
        mem.airX = e.land;
      } else if (e.act === 'grab') {
        // 지상에서 수직 점프한 뒤 공중에서 노린 사다리·로프를 잡는다.
        if (p.prone) {
          input.up = true;
        } else if (jump()) {
          mem.grabStep = e;
          mem.airX = e.x;
          mem.climbDir = -1;
        }
      } else if (e.act === 'drop') {
        // 아래 입력으로 엎드린 뒤 점프 입력으로 발판을 통과한다.
        input.down = true;
        input.jump = true;
        mem.airX = e.land;
      } else if (e.act === 'jump') {
        if (p.prone) {
          input.up = true;
        } else if (jump()) {
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
