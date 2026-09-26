// 개발자 모드 (페이지를 ?dev 로 열기): 이동 가능 영역(발판·사다리·로프) 편집기.
// - 종류(걷기/사다리/로프)와 도구(이동/추가/지우기)를 고르고 지도 위를 드래그해서 편집
// - 저장하면 /api/map 이 js/map-data.js 를 저장소에 커밋 → 1~2분 뒤 사이트에 반영
// 편집 내용은 CONFIG.floors / CONFIG.climbs 를 바로 바꾸고, 돌아다니는 하객에게도 즉시 적용된다.

const DEV_COLORS = { walk: 0xff4d6d, ladder: 0x00c853, rope: 0x2979ff, stage: 0xffc107 };
const DEV_TYPES = { walk: '걷기', ladder: '사다리', rope: '로프' };

class DevMode {
  constructor(scene) {
    this.scene = scene;
    this.type = 'walk';
    this.tool = 'move';
    this.history = []; // 되돌리기용 스냅샷 (JSON 문자열)
    this.savedSnap = this.snapshot(); // 마지막으로 저장된(또는 처음) 상태 → 이것과 다르면 저장 안 된 변경
    this.dirty = false;
    this.stroke = null; // 드래그 중인 점들 (월드 좌표)

    this.gfx = scene.add.graphics().setDepth(20000);
    this.preview = scene.add.graphics().setDepth(20001);
    this.buildToolbar();
    this.draw();

    const input = scene.input;
    input.on('pointerdown', this.onDown, this);
    input.on('pointermove', this.onMove, this);
    input.on('pointerup', this.onUp, this);
    input.on('pointerupoutside', this.onUp, this);
    window.addEventListener('beforeunload', (e) => {
      if (!this.dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  /** 편집 도구가 켜져 있으면 드래그는 지도 이동 대신 편집 (MapView, 캐릭터 클릭이 참고) */
  get editing() {
    return this.tool !== 'move';
  }

  // ---------- 툴바 ----------

  buildToolbar() {
    const bar = document.createElement('div');
    bar.className = 'dev-bar';
    bar.innerHTML = `
      <div class="dev-row">
        <b class="dev-badge">DEV</b>
        <div class="dev-seg" data-group="type">
          ${Object.entries(DEV_TYPES)
            .map(([v, label]) => `<button type="button" data-v="${v}"><i style="background:#${DEV_COLORS[v].toString(16).padStart(6, '0')}"></i>${label}</button>`)
            .join('')}
        </div>
        <div class="dev-seg" data-group="tool">
          <button type="button" data-v="move">이동</button>
          <button type="button" data-v="add">추가</button>
          <button type="button" data-v="erase">지우기</button>
        </div>
      </div>
      <div class="dev-row">
        <button type="button" class="dev-btn" data-act="undo">되돌리기</button>
        <button type="button" class="dev-btn dev-save" data-act="save">저장</button>
        <label class="dev-check"><input type="checkbox" data-act="hide" /> 하객 숨기기</label>
      </div>
      <div class="dev-hint"></div>`;
    document.body.append(bar);
    this.bar = bar;

    bar.querySelectorAll('.dev-seg').forEach((seg) =>
      seg.addEventListener('click', (e) => {
        const v = e.target.closest('[data-v]')?.dataset.v;
        if (!v) return;
        this[seg.dataset.group] = v;
        this.updateToolbar();
      })
    );
    bar.querySelector('[data-act="undo"]').addEventListener('click', () => this.undo());
    bar.querySelector('[data-act="save"]').addEventListener('click', () => this.save());
    bar.querySelector('[data-act="hide"]').addEventListener('change', (e) => {
      for (const g of this.scene.guests) g.setVisible(!e.target.checked);
    });
    this.updateToolbar();
  }

  updateToolbar() {
    this.bar.querySelectorAll('.dev-seg').forEach((seg) =>
      seg.querySelectorAll('[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === this[seg.dataset.group]))
    );
    this.bar.querySelector('[data-act="undo"]').disabled = !this.history.length;
    this.bar.querySelector('.dev-save').classList.toggle('dirty', this.dirty);
    const label = DEV_TYPES[this.type];
    const hints = {
      move: '드래그로 지도 이동 · 두 손가락/휠로 확대',
      add:
        this.type === 'walk'
          ? '시작점에서 누르고 끝점에서 떼면 직선 발판 추가 (계단은 비스듬히)'
          : `아래 발판에서 위 발판까지 세로로 드래그해서 ${label} 추가`,
      erase: `문질러서 ${label} 지우기 (${label}만 지워져요)`,
    };
    this.bar.querySelector('.dev-hint').textContent = hints[this.tool];
  }

  // ---------- 그리기 ----------

  draw() {
    const g = this.gfx.clear();
    for (const [name, f] of Object.entries(CONFIG.floors)) {
      const color = name === 'stage' ? DEV_COLORS.stage : DEV_COLORS.walk;
      g.lineStyle(6, color, 0.9).strokePoints(f.path.map(([x, y]) => ({ x, y })));
      g.fillStyle(0xffffff, 1);
      f.path.forEach(([x, y]) => g.fillCircle(x, y, 3.5));
    }
    for (const c of CONFIG.climbs) {
      const [a, b] = c.floors.map((n) => (CONFIG.floors[n] ? floorY(CONFIG.floors[n], c.x) : null));
      if (a === null || b === null) continue;
      g.lineStyle(6, DEV_COLORS[c.type], 0.9).lineBetween(c.x, a, c.x, b);
      g.fillStyle(0xffffff, 1).fillCircle(c.x, a, 3.5).fillCircle(c.x, b, 3.5);
    }
  }

  drawPreview() {
    const g = this.preview.clear();
    const pts = this.stroke?.points;
    if (!pts?.length) return;
    const color = DEV_COLORS[this.type];
    if (this.tool === 'erase') {
      g.fillStyle(0xffffff, 0.35).lineStyle(1.5, color, 0.9);
      const r = this.brushRadius();
      pts.forEach((p) => g.fillCircle(p.x, p.y, r));
      const last = pts[pts.length - 1];
      g.strokeCircle(last.x, last.y, r);
    } else if (this.type === 'walk') {
      const last = pts[pts.length - 1];
      g.lineStyle(5, color, 0.6).lineBetween(pts[0].x, pts[0].y, last.x, last.y);
    } else {
      const last = pts[pts.length - 1];
      g.lineStyle(5, color, 0.6).lineBetween(pts[0].x, pts[0].y, pts[0].x, last.y);
    }
  }

  /** 지우개 반지름: 화면에서 약 16 CSS px */
  brushRadius() {
    return (16 * DPR) / this.scene.cameras.main.zoom;
  }

  // ---------- 입력 ----------

  worldPoint(pointer) {
    const p = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return { x: p.x, y: p.y };
  }

  onDown(pointer) {
    if (!this.editing) return;
    // 두 손가락이면 핀치 확대에 양보
    if (this.scene.input.manager.pointers.filter((p) => p.isDown).length >= 2) {
      this.stroke = null;
      this.preview.clear();
      return;
    }
    this.stroke = { id: pointer.id, points: [this.worldPoint(pointer)] };
    this.drawPreview();
  }

  onMove(pointer) {
    if (!this.stroke || pointer.id !== this.stroke.id || !pointer.isDown) return;
    const p = this.worldPoint(pointer);
    const last = this.stroke.points[this.stroke.points.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 3) return;
    this.stroke.points.push(p);
    this.drawPreview();
  }

  onUp(pointer) {
    const stroke = this.stroke;
    if (!stroke || pointer.id !== stroke.id) return;
    this.stroke = null;
    this.preview.clear();
    if (this.tool === 'erase') this.erase(stroke.points);
    else if (this.type === 'walk') this.addFloor(stroke.points);
    else this.addClimb(stroke.points);
  }

  // ---------- 편집 ----------

  snapshot() {
    return JSON.stringify({ floors: CONFIG.floors, climbs: CONFIG.climbs });
  }

  /** 바꾸기 전에 호출: 되돌리기 스냅샷 저장 */
  checkpoint() {
    this.history.push(this.snapshot());
    if (this.history.length > 50) this.history.shift();
  }

  changed() {
    this.dirty = this.snapshot() !== this.savedSnap;
    this.draw();
    this.updateToolbar();
    this.scene.refreshMap();
  }

  undo() {
    const snap = this.history.pop();
    if (!snap) return;
    const { floors, climbs } = JSON.parse(snap);
    CONFIG.floors = floors;
    CONFIG.climbs = climbs;
    this.changed();
  }

  /** 누른 점과 뗀 점을 직선으로 잇는 발판 (계단처럼 기울어져도 됨) */
  addFloor(points) {
    const [a, b] = [points[0], points[points.length - 1]].sort((p, q) => p.x - q.x);
    if (b.x - a.x < 20) return UI.showToast('조금 더 길게 옆으로 드래그해 주세요');
    this.checkpoint();
    CONFIG.floors[uniqueFloorName('f')] = {
      path: [a, b].map((p) => [Math.round(p.x), Math.round(p.y)]),
    };
    this.changed();
  }

  addClimb(points) {
    const start = points[0];
    const end = points[points.length - 1];
    const a = floorNear(start.x, start.y);
    const b = floorNear(start.x, end.y);
    if (!a || !b || a === b) {
      return UI.showToast(`${DEV_TYPES[this.type]} 양 끝을 서로 다른 발판(빨간 선) 위에 맞춰 주세요`);
    }
    this.checkpoint();
    CONFIG.climbs.push({ type: this.type, x: Math.round(start.x), floors: [a, b] });
    this.changed();
  }

  erase(points) {
    const r = this.brushRadius();
    const hit = (x, y) => points.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 <= r * r);
    const before = this.snapshot();

    if (this.type === 'walk') {
      const floors = {};
      const renamed = {}; // 원래 이름 → 잘리고 남은 조각 이름들
      for (const [name, f] of Object.entries(CONFIG.floors)) {
        if (name === 'stage') {
          floors[name] = f;
          continue;
        }
        const pieces = eraseFromPath(f.path, hit);
        renamed[name] = pieces.map((path, i) => {
          const pieceName = i === 0 ? name : uniqueFloorName(`${name}_`, floors);
          floors[pieceName] = { path };
          return pieceName;
        });
      }
      // 사다리/로프는 자기 x를 덮는 조각에 다시 연결, 없으면 삭제
      const climbs = [];
      for (const c of CONFIG.climbs) {
        const ends = c.floors.map((n) =>
          (renamed[n] ?? [n]).find((piece) => {
            const span = floors[piece] && floorSpan(floors[piece]);
            return span && c.x >= span.x1 - 4 && c.x <= span.x2 + 4;
          })
        );
        if (ends.every(Boolean)) climbs.push({ ...c, floors: ends });
      }
      if (JSON.stringify({ floors, climbs }) === before) return;
      this.checkpoint();
      CONFIG.floors = floors;
      CONFIG.climbs = climbs;
    } else {
      const keep = CONFIG.climbs.filter((c) => {
        if (c.type !== this.type || !c.floors.every((n) => CONFIG.floors[n])) return true;
        const [a, b] = c.floors.map((n) => floorY(CONFIG.floors[n], c.x));
        const [y0, y1] = [Math.min(a, b), Math.max(a, b)];
        return !points.some((p) => Math.abs(p.x - c.x) <= r && p.y >= y0 - r && p.y <= y1 + r);
      });
      if (keep.length === CONFIG.climbs.length) return;
      this.checkpoint();
      CONFIG.climbs = keep;
    }
    this.changed();
  }

  // ---------- 저장 ----------

  async save() {
    let password = null;
    try {
      password = sessionStorage.getItem('devPassword');
    } catch {}
    if (!password) password = prompt('개발자 모드 저장 비밀번호');
    if (!password) return;

    const btn = this.bar.querySelector('.dev-save');
    btn.disabled = true;
    btn.textContent = '저장 중...';
    try {
      await postJson('/api/map', { password, map: { floors: CONFIG.floors, climbs: CONFIG.climbs } });
      try {
        sessionStorage.setItem('devPassword', password);
      } catch {}
      this.savedSnap = this.snapshot();
      this.dirty = false;
      UI.showToast('저장했어요! 1~2분 뒤 사이트에 반영돼요', 3000);
    } catch (err) {
      if (/비밀번호/.test(err.message)) {
        try {
          sessionStorage.removeItem('devPassword');
        } catch {}
      }
      UI.showToast(err.message, 3500);
    } finally {
      btn.disabled = false;
      btn.textContent = '저장';
      this.updateToolbar();
    }
  }
}

// ---------- 편집용 도우미 ----------

function uniqueFloorName(prefix, taken = CONFIG.floors) {
  let i = 1;
  while (taken[`${prefix}${i}`] || CONFIG.floors[`${prefix}${i}`]) i++;
  return `${prefix}${i}`;
}

/** (x, y) 가까이(세로 24px 이내)에 있는 발판 이름 (stage 제외) */
function floorNear(x, y) {
  let best = null;
  let bestDist = 24;
  for (const [name, f] of Object.entries(CONFIG.floors)) {
    if (name === 'stage') continue;
    const { x1, x2 } = floorSpan(f);
    if (x < x1 - 6 || x > x2 + 6) continue;
    const d = Math.abs(floorY(f, x) - y);
    if (d <= bestDist) {
      best = name;
      bestDist = d;
    }
  }
  return best;
}

/** 꺾은선을 2px 간격으로 훑어 지우개에 닿은 부분을 빼고 남은 조각들(길이 16px 이상)을 돌려준다 */
function eraseFromPath(path, hit) {
  const samples = [];
  for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1];
    const [x1, y1] = path[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2));
    for (let s = i === 1 ? 0 : 1; s <= steps; s++) {
      const x = x0 + ((x1 - x0) * s) / steps;
      const y = y0 + ((y1 - y0) * s) / steps;
      samples.push({ x, y, erased: hit(x, y) });
    }
  }
  if (!samples.some((s) => s.erased)) return [path];

  const pieces = [];
  let run = [];
  for (const s of [...samples, { erased: true }]) {
    if (!s.erased) {
      run.push(s);
      continue;
    }
    if (run.length >= 2 && run[run.length - 1].x - run[0].x >= 16) {
      pieces.push(simplifyPath(run, 1).map((p) => [Math.round(p.x), Math.round(p.y)]));
    }
    run = [];
  }
  return pieces;
}

/** Ramer–Douglas–Peucker 꺾은선 단순화 */
function simplifyPath(pts, eps) {
  if (pts.length < 3) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let maxD = -1;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((b.x - a.x) * (a.y - pts[i].y) - (a.x - pts[i].x) * (b.y - a.y)) / len;
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= eps) return [a, b];
  return [...simplifyPath(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplifyPath(pts.slice(idx), eps)];
}
