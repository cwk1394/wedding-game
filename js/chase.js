// 이벤트 NPC "도둑 잡기 경찰관": 내 캐릭터가 도둑 → 신랑·신부(2배 빠름)와 하객 몇 명(1.5배)이 쫓아옴. 잡힐 때까지 버틴 시간을 기록 (api/chase.js)
// - 시작: 내 캐릭터 비밀번호 확인 → 창이 닫히고 플레이 모드 + 3·2·1 → 추격. 버틴 시간은 서버 시각으로 잰다
// - 추격자는 조종 물리(GuestCharacter.tickControlled)에 추격 입력(brain)을 넣어 움직임 → 점프·사다리·로프·엎드려 내려가기를 플레이어와 똑같이 씀
// - 조종을 놓거나(로비·관람 모드) 다른 탭으로 가면 그 자리에서 끝 (탭이 숨으면 게임이 멈춰서 시간만 흐르므로)
// 아래쪽 랭킹·연락처·개발자 관리 칸은 공통 (js/board.js)

const Chase = (() => {
  const el = document.getElementById('chase-modal');
  const modal = UI.setupModal(el);
  const $ = (sel) => el.querySelector(sel);
  const form = $('.chase-start');
  const errorEl = $('.chase-error');
  const resultEl = $('.chase-result');
  const cfg = CONFIG.chase;

  let password = ''; // 이 창에서 한 번 맞게 입력하면 "다시 도전"에 그대로
  let busy = false;
  let mine = null;
  let game = null; // 진행 중인 게임
  let hooks = null; // main.js: { scene(), mine(), play() }

  const api = (body) => postJson('/api/chase', body);
  const fmtTime = (ms) => `${(ms / 1000).toFixed(1)}초`;
  const board = eventBoard(el, {
    path: '/api/chase',
    title: '🏆 오래 버티기 랭킹',
    score: (r) => fmtTime(r.ms),
    password: { get: () => password, set: (pw) => (password = pw) },
    isPlaying: () => Boolean(game),
    close: () => modal.close(),
  });

  // 화면 위 타이머 + 가운데 카운트다운
  const hud = document.createElement('div');
  hud.className = 'chase-hud';
  hud.hidden = true;
  hud.innerHTML = '<span class="chase-time">⏱ 0.0초</span><button type="button" class="chase-quit">그만하기</button>';
  const countEl = document.createElement('div');
  countEl.className = 'chase-count';
  document.body.append(hud, countEl);
  hud.querySelector('.chase-quit').addEventListener('click', () => finish('stop'));

  function showError(msg) {
    errorEl.textContent = msg || '';
    errorEl.hidden = !msg;
  }

  /** settings: 개발자 모드일 때 "NPC 설정" 버튼이 여는 함수. result: 방금 끝난 게임 결과 */
  function open(settings, result) {
    if (game) return; // 도망치는 중엔 안 열림
    mine = UI.getMine?.();
    board.reset(mine, settings);
    $('.chase-need').hidden = Boolean(mine);
    $('.chase-pw').hidden = !mine;
    $('.chase-go').hidden = !mine;
    $('.chase-go').textContent = result ? '다시 도전' : '도전하기';
    form.elements.password.value = password;
    resultEl.hidden = !result;
    if (result) {
      const rank = result.rank && result.rank <= 3 ? ` · ${result.rank}위! ☕ 쿠폰 순위` : result.rank ? ` · ${result.rank}위` : '';
      resultEl.textContent = `⏱ ${fmtTime(result.ms)} 버텼어요${rank}`;
      board.render({ ranking: result.ranking, hasContact: result.hasContact });
    }
    showError('');
    modal.open();
    board.load();
  }

  // 도전 시작: 비밀번호 확인 → 토큰 → 창 닫고 게임
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || !mine) return;
    const pw = form.elements.password.value;
    if (!pw) return showError('비밀번호를 입력해 주세요.');
    if (!mine.info.number) return showError('방금 만든 캐릭터는 1~2분 뒤에 도전할 수 있어요.');
    const s = hooks?.scene();
    const me = hooks?.mine();
    if (!s || !me) return showError('내 캐릭터를 찾지 못했어요. 새로고침 후 다시 시도해 주세요.');
    busy = true;
    showError('');
    $('.chase-go').textContent = '확인 중...';
    try {
      const r = await api({ action: 'start', number: mine.info.number, id: mine.info.id, password: pw });
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
    hooks.play(); // 내 캐릭터 조종 + 확대
    // 추격자: 신랑·신부 + 나를 뺀 하객 중 무작위 몇 명
    const others = Phaser.Utils.Array.Shuffle(s.guests.filter((g) => g !== me && g.active)).slice(0, cfg.guests);
    const graph = buildGraph();
    const chasers = [...s.couple.map((c) => ({ c, speed: cfg.coupleSpeed })), ...others.map((c) => ({ c, speed: cfg.guestSpeed }))];
    for (const { c, speed } of chasers) {
      s.control.controlled === c && s.control.release();
      c.startChase(brain(c, me, graph), 0); // 카운트다운 동안은 멈춰 있음 (속도 0)
      c.chaseSpeed = speed;
      const p = farPoint(me);
      c.dropAt(p.name, p.x);
    }
    const startAt = performance.now() + countdown;
    game = { s, me, token, chasers, startAt, started: false, over: false };
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

  /** 내 캐릭터에서 cfg.minStartDist 이상 떨어진 아무 발판 위 (못 찾으면 가장 먼 곳) */
  function farPoint(me) {
    let best = null;
    for (let i = 0; i < 40; i++) {
      const floor = pickGuestFloor();
      const name = Object.keys(CONFIG.floors).find((n) => CONFIG.floors[n] === floor);
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
    hud.querySelector('.chase-time').textContent = `⏱ ${fmtTime(Math.max(0, now - g.startAt))}`;
    if (g.s.control.controlled !== g.me) return finish('stop'); // 조종을 놓음 (로비로·관람 모드)
    if (!g.started) return;
    const caught = g.chasers.some(({ c }) => Math.abs(c.x - g.me.x) < cfg.catchX && Math.abs(c.y - g.me.y) < cfg.catchY);
    if (caught) finish('caught');
  }

  /** 끝 (잡힘·그만하기·조종 놓음): 서버에 기록 → 잠깐 뒤 추격자 원래대로 + 결과 창 */
  async function finish(reason) {
    const g = game;
    if (!g || g.over) return;
    g.over = true;
    g.s.onTick = null;
    for (const { c } of g.chasers) if (c.chaser) c.chaser.speed = 0; // 그 자리에 멈춤
    if (reason === 'caught') {
      flashCount('잡혔다!');
      g.me.floatText('🚨', { size: 26, rise: 30 });
    }
    let result = null;
    try {
      result = await api({ action: 'end', token: g.token });
    } catch (err) {
      UI.showToast(err.message, 3000);
    }
    setTimeout(() => {
      for (const { c } of g.chasers) if (c.active && c.chaser) c.stopChase();
      hud.hidden = true;
      game = null;
      if (result) open(null, result);
    }, reason === 'caught' ? 1400 : 300);
  }

  // 다른 탭으로 가면 게임(화면)은 멈추는데 시간은 흐르므로 그 자리에서 끝
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) finish('stop');
  });

  // ---------- 추격 AI ----------
  // 발판을 점으로, 오가는 방법(이어 걷기·사다리/로프·발판 끝에서 떨어지기·엎드려 뚫고 내려가기·위로 점프·틈 건너뛰기)을 선으로 한 그래프에서
  // 대상이 있는 발판까지 가장 짧은 길(다익스트라)을 찾고, 그 첫 구간의 동작을 입력으로 만든다. 같은 발판이면 곧장 쫓아감.
  // 한자리에 막히면 잠깐 아무 데로나 움직여 빠져나옴. 발판·사다리는 게임 중 안 바뀌므로 게임마다 한 번 만든다

  /** x에서 y 아래(같은 높이 포함) 가장 가까운 발판 { name, y } (except 제외) */
  function landingBelow(x, y, except) {
    let best = null;
    for (const [name, f] of Object.entries(CONFIG.floors)) {
      if (name === except) continue;
      const { x1, x2 } = floorSpan(f);
      if (x < x1 || x > x2) continue;
      const fy = floorY(f, x);
      if (fy >= y - 0.5 && (!best || fy < best.y)) best = { name, y: fy };
    }
    return best;
  }

  /** 발판 이름 → [{ to, x(동작할 곳), act, dir, land(도착 x) }] */
  function buildGraph() {
    const jumpUp = 50; // 제자리 점프로 올라갈 수 있는 높이 (조종 점프 약 58px)
    const g = {};
    const add = (from, e) => (g[from] ??= []).push(e);
    const names = Object.keys(CONFIG.floors);
    for (const a of names) {
      const fa = CONFIG.floors[a];
      const { x1, x2 } = floorSpan(fa);
      for (const dir of [-1, 1]) {
        const edge = dir > 0 ? x2 : x1;
        const next = floorContinuation(a, dir);
        if (next) {
          add(a, { to: next, x: edge, act: 'walk', dir, land: edge });
          continue;
        }
        const fall = landingBelow(edge + dir * 10, floorY(fa, edge), a); // 발판 끝에서 걸어 나가 떨어짐
        if (fall) add(a, { to: fall.name, x: edge, act: 'fall', dir, land: edge + dir * 10 });
        for (const t of gapJumpTargets(a, edge, dir)) add(a, { to: t.name, x: edge, act: 'gap', dir, land: t.x });
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
        if (dy > 2 && landingBelow(x, floorY(fa, x) + 2, a)?.name === b) add(a, { to: b, x, act: 'drop', land: x }); // 바로 아래 발판
        else if (dy < 0 && dy >= -jumpUp) add(a, { to: b, x, act: 'jump', land: x }); // 점프해서 위 발판에 착지
      }
    }
    for (const c of CONFIG.climbs) {
      if (!c.floors.every((n) => CONFIG.floors[n])) continue;
      const { top, bottom } = climbEnds(c);
      if (bottom.name) add(bottom.name, { to: top.name, x: c.x, act: 'up', land: c.x });
      const down = bottom.name ? bottom : landingBelow(c.x, bottom.y + CONFIG.motion.control.grabHeight, top.name); // 매달린 끝에서 손 놓고 떨어짐
      if (down) add(top.name, { to: down.name, x: c.x, act: 'down', land: c.x });
    }
    return g;
  }

  /** from 발판(x 위치)에서 to 발판까지 가장 짧은 길의 첫 구간 (없으면 null) */
  function firstStep(graph, from, x, to) {
    const dist = { [from]: 0 };
    const pos = { [from]: x };
    const first = {};
    const done = new Set();
    for (;;) {
      let u = null;
      for (const n in dist) if (!done.has(n) && (u === null || dist[n] < dist[u])) u = n;
      if (u === null) return null;
      if (u === to) return first[u] ?? null;
      done.add(u);
      for (const e of graph[u] ?? []) {
        const d = dist[u] + Math.abs(e.x - pos[u]) + 40; // 걷는 거리 + 동작 하나당 조금
        if (d < (dist[e.to] ?? Infinity)) {
          dist[e.to] = d;
          pos[e.to] = e.land;
          first[e.to] = first[u] ?? e;
        }
      }
    }
  }

  function brain(c, target, graph) {
    const mem = { still: 0, lastX: c.x, lastY: c.y, wander: 0, wanderDir: 1, jumpCd: 0, climbDir: -1, step: null, stepAt: 0, airX: null };
    return (delta) => {
      const input = { left: false, right: false, up: false, down: false, jump: false };
      const out = { ...input, consumeJump: () => input.jump };
      const p = c.phys;
      if (!c.chaser?.speed || !p) return out; // 카운트다운·끝난 뒤: 가만히
      const go = (d) => {
        if (d < -3) input.left = true;
        else if (d > 3) input.right = true;
      };
      const jump = () => {
        if (mem.jumpCd > 0) return;
        input.jump = true;
        mem.jumpCd = 600;
      };
      mem.jumpCd -= delta;

      // 한자리에 막혀 있으면 잠깐 아무 방향으로 + 점프
      mem.still = Math.hypot(c.x - mem.lastX, c.y - mem.lastY) < 0.5 ? mem.still + delta : 0;
      mem.lastX = c.x;
      mem.lastY = c.y;
      if (mem.still > 1000 && p.mode !== 'climb') {
        mem.still = 0;
        mem.wander = 800;
        mem.wanderDir = Math.random() < 0.5 ? -1 : 1;
      }
      if (mem.wander > 0) {
        mem.wander -= delta;
        go(mem.wanderDir * 10);
        if (mem.wander > 600) input.jump = true;
        return Object.assign(out, input);
      }

      if (p.mode === 'climb') {
        input.up = mem.climbDir < 0;
        input.down = mem.climbDir > 0;
        return Object.assign(out, input);
      }
      if (p.mode === 'air') {
        go((mem.airX ?? target.x) - c.x); // 뛰어내리거나 건너뛸 때 노린 곳으로
        return Object.assign(out, input);
      }
      mem.airX = null;

      const dx = target.x - c.x;
      const dy = target.y - c.y;
      if (c.floorName === target.floorName || Math.hypot(dx, dy) < 60) {
        go(dx);
        if (dy < -20 && Math.abs(dx) < 70) jump();
        return Object.assign(out, input);
      }
      // 길 찾기는 0.3초마다 (발판 위치가 바뀌었으면 바로)
      const now = performance.now();
      if (!mem.step || mem.stepFrom !== c.floorName || now - mem.stepAt > 300) {
        mem.step = firstStep(graph, c.floorName, c.x, target.floorName);
        mem.stepFrom = c.floorName;
        mem.stepAt = now;
      }
      const e = mem.step;
      if (!e) {
        go(dx); // 길이 없으면 그냥 그쪽으로
        return Object.assign(out, input);
      }
      const near = Math.abs(e.x - c.x);
      if (e.act === 'walk') go(e.dir * 10);
      else if (e.act === 'fall') {
        go(e.dir * 10);
        mem.airX = e.land;
      } else if (e.act === 'gap') {
        go(e.dir * 10);
        if (near < 14) {
          jump();
          mem.airX = e.land;
        }
      } else if (near > 5) go(e.x - c.x);
      else if (e.act === 'up' || e.act === 'down') {
        mem.climbDir = e.act === 'up' ? -1 : 1;
        input.up = e.act === 'up';
        input.down = e.act === 'down';
      } else if (e.act === 'drop') {
        input.down = true; // 엎드려서 → 점프 = 발판을 뚫고 아래로
        input.jump = true;
        mem.airX = e.land;
      } else if (e.act === 'jump') {
        jump();
        mem.airX = e.land;
      }
      return Object.assign(out, input);
    };
  }

  return {
    open,
    /** main.js에서 연결: scene(), mine()(맵 위 내 캐릭터), play()(조종 시작) */
    attach(h) {
      hooks = h;
    },
  };
})();
