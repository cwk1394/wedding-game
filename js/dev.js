// 개발자 모드 (페이지를 ?dev 로 열기): 이동 가능 영역(발판·사다리·로프·무대) 편집기.
// - 종류(걷기/사다리/로프/무대)와 도구(이동/추가/지우기)를 고르고 지도 위를 드래그해서 편집
// - 저장하면 /api/map 이 js/map-data.js 를 저장소에 커밋 → 1~2분 뒤 사이트에 반영
// - 조종: 캐릭터 팝업의 "조종하기" (개발자 모드에선 신랑·신부도). 조종 자체는 js/control.js의 Controller
// - 시작점 도구: 방명록 등록 직후 새 캐릭터가 나타나는 위치(CONFIG.spawn)를 지정
// - 신랑신부 도구: 누른 곳 발판 위에 신랑·신부를 나란히 (CONFIG.couple)
// - 캐릭터 끌기(편집 도구가 아닐 때): 누르고 끌면 놓은 곳의 발판으로 옮김. 신랑·신부는 그 자리(CONFIG.couple)가 저장됨
// 편집 내용은 CONFIG.floors / CONFIG.climbs 를 바로 바꾸고, 돌아다니는 하객에게도 즉시 적용된다.

const DEV_COLORS = { walk: 0xff4d6d, ladder: 0x00c853, rope: 0x2979ff, stage: 0xffc107, gapJump: 0xb04dff };
const DEV_TYPES = { walk: '걷기', ladder: '사다리', rope: '로프', stage: '무대' };

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
    scene.control.onChange = () => this.updateToolbar();
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
    return this.tool === 'add' || this.tool === 'erase';
  }

  // ---------- 조종 (Controller에 위임) ----------

  get controlled() {
    return this.scene.control.controlled;
  }

  releaseGuest() {
    this.scene.control.release();
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
          <button type="button" data-v="spawn">시작점</button>
          <button type="button" data-v="couple">신랑신부</button>
        </div>
      </div>
      <div class="dev-row">
        <button type="button" class="dev-btn" data-act="undo">되돌리기</button>
        <button type="button" class="dev-btn dev-save" data-act="save">저장</button>
        <label class="dev-check"><input type="checkbox" data-act="hide" /> 하객 숨기기</label>
        <label class="dev-check" title="켜면 신랑·신부가 자리에 서 있고, 끄면 무대 안에서만 돌아다녀요"><input type="checkbox" data-act="fixed" /> 신랑신부 고정</label>
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
    bar.querySelector('[data-act="fixed"]').addEventListener('change', (e) => {
      this.checkpoint();
      CONFIG.couple = { ...coupleData(), fixed: e.target.checked };
      this.changed();
      if (!e.target.checked) UI.showToast('신랑·신부가 무대 안에서만 돌아다녀요');
    });
    this.updateToolbar();
  }

  updateToolbar() {
    this.bar.querySelectorAll('.dev-seg').forEach((seg) =>
      seg.querySelectorAll('[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === this[seg.dataset.group]))
    );
    this.bar.querySelector('[data-group="type"]').classList.toggle('dim', !this.editing);
    this.bar.querySelector('[data-act="undo"]').disabled = !this.history.length;
    this.bar.querySelector('.dev-save').classList.toggle('dirty', this.dirty);
    this.bar.querySelector('[data-act="fixed"]').checked = coupleFixed();
    const label = DEV_TYPES[this.type];
    const hints = {
      move: '드래그로 지도 이동 · 캐릭터를 끌면 그 자리로 (신랑·신부 자리는 저장) · 두 손가락/휠로 확대 · 보라 곡선 = 자동 점프',
      add:
        this.type === 'stage'
          ? '시작점에서 누르고 끝점에서 떼면 직선 무대 추가 (신랑신부 고정이 꺼져 있으면 신랑·신부가 여기서만 다님, 조각끼리 끝을 붙이면 이어짐)'
          : this.type === 'walk'
          ? '시작점에서 누르고 끝점에서 떼면 직선 발판 추가 (계단은 비스듬히)'
          : `위 발판에서 세로로 드래그해서 ${label} 추가 (아래 끝이 발판이면 연결, 허공이면 매달린 ${label})`,
      erase: `문질러서 ${label} 지우기 (${label}만 지워져요)`,
      spawn: '지도를 눌러 방명록 등록 직후 새 캐릭터가 나타날 시작점을 지정 (발판 위, 노란 깃발)',
      couple: '지도를 눌러 신랑·신부 자리를 지정 (가까운 발판 위에 나란히, 고정이 꺼져 있으면 무대만) · 한 명씩 옮기려면 캐릭터를 끌기',
    };
    // 조종 중(캐릭터 팝업의 "조종하기")이면 조작법을 대신 보여준다
    this.bar.querySelector('.dev-hint').textContent = this.controlled
      ? `${this.controlled.info.name} 조종 중 · ←→ 걷기 · ↑↓ 사다리/로프 · Space 점프 (점프 중 ↑↓로 매달리기)`
      : hints[this.tool];
  }

  // ---------- 그리기 ----------

  draw() {
    const g = this.gfx.clear();
    for (const [name, f] of Object.entries(CONFIG.floors)) {
      const color = isStage(name) ? DEV_COLORS.stage : DEV_COLORS.walk;
      g.lineStyle(6, color, 0.9).strokePoints(f.path.map(([x, y]) => ({ x, y })));
      g.fillStyle(0xffffff, 1);
      f.path.forEach(([x, y]) => g.fillCircle(x, y, 3.5));
    }
    for (const c of CONFIG.climbs) {
      if (!c.floors.every((n) => CONFIG.floors[n])) continue;
      const { top, bottom } = climbEnds(c);
      g.lineStyle(6, DEV_COLORS[c.type], 0.9).lineBetween(c.x, top.y, c.x, bottom.y);
      g.fillStyle(0xffffff, 1).fillCircle(c.x, top.y, 3.5);
      if (bottom.name) g.fillCircle(c.x, bottom.y, 3.5);
      else g.lineStyle(3, DEV_COLORS[c.type], 1).lineBetween(c.x - 7, bottom.y, c.x + 7, bottom.y); // 매달린 끝 (가로 눈금)
    }
    // 시작점 (노란 깃발)
    const spawn = spawnPoint();
    if (spawn) {
      g.lineStyle(3, 0x6b4e00, 1).lineBetween(spawn.x, spawn.y, spawn.x, spawn.y - 34);
      g.fillStyle(0xffd400, 1).fillTriangle(spawn.x, spawn.y - 34, spawn.x + 22, spawn.y - 27, spawn.x, spawn.y - 20);
      g.fillCircle(spawn.x, spawn.y, 5);
    }
    // 점프로 건너갈 수 있는 곳 (보라 곡선, 발판 양 끝에서) — CONFIG.motion.gapJump 기준 자동 계산
    g.lineStyle(2.5, DEV_COLORS.gapJump, 0.95);
    for (const [name, f] of Object.entries(CONFIG.floors)) {
      const { x1, x2 } = floorSpan(f);
      const m = Math.min(CHAR_W / 2, (x2 - x1) / 4);
      for (const [dir, x] of [[-1, x1 + m], [1, x2 - m]]) {
        const y = floorY(f, x);
        for (const t of gapJumpTargets(name, x, dir)) {
          const h = CONFIG.motion.jumpHeight + Math.max(0, y - t.y) * 0.6;
          const pts = [];
          for (let i = 0; i <= 12; i++) {
            const p = i / 12;
            pts.push({ x: x + (t.x - x) * p, y: y + (t.y - y) * p - h * 4 * p * (1 - p) });
          }
          g.strokePoints(pts);
          g.fillStyle(DEV_COLORS.gapJump, 1).fillCircle(t.x, t.y, 3);
        }
      }
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
    } else if (this.type === 'walk' || this.type === 'stage') {
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
    const twoFingers = this.scene.input.manager.pointers.filter((p) => p.isDown).length >= 2;
    if (!this.editing) {
      // 편집 도구가 아니면: 캐릭터를 누르고 끌면 그 캐릭터를 옮긴다 (두 손가락이면 핀치 확대에 양보)
      if (twoFingers) return this.endCharDrag();
      const p = this.worldPoint(pointer);
      const c = this.characterAt(p, [...this.scene.couple, ...this.scene.guests, ...this.scene.npcs]);
      if (!c) return;
      this.scene.view.drag = null; // 지도 대신 캐릭터를 끈다
      this.charDrag = { id: pointer.id, character: c, dx: c.x - p.x, dy: c.y - p.y, sx: pointer.x, sy: pointer.y, moved: false };
      return;
    }
    // 두 손가락이면 핀치 확대에 양보
    if (twoFingers) {
      this.stroke = null;
      this.preview.clear();
      return;
    }
    this.stroke = { id: pointer.id, points: [this.worldPoint(pointer)] };
    this.drawPreview();
  }

  onMove(pointer) {
    const d = this.charDrag;
    if (d && pointer.id === d.id && pointer.isDown) {
      if (!d.moved) {
        if (Math.hypot(pointer.x - d.sx, pointer.y - d.sy) < CONFIG.view.dragThreshold * DPR) return;
        d.moved = true;
        d.from = { floor: d.character.floorName, x: d.character.x };
        d.character.held = true; // 끄는 동안은 스스로 움직이지 않음
        d.character.hideBubble();
        this.scene.view.dragMoved = true; // 손을 떼도 클릭(팝업·선택)으로 치지 않게
      }
      const p = this.worldPoint(pointer);
      d.character.setPosition(p.x + d.dx, p.y + d.dy).setDepth(14000);
      return;
    }
    if (!this.stroke || pointer.id !== this.stroke.id || !pointer.isDown) return;
    const p = this.worldPoint(pointer);
    const last = this.stroke.points[this.stroke.points.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 3) return;
    this.stroke.points.push(p);
    this.drawPreview();
  }

  /** 신랑신부 도구: 누른 곳 가까운 발판 위에 신랑(왼쪽)·신부(오른쪽)를 나란히 (고정이 아니면 무대만) */
  setCouple(pointer) {
    if (this.scene.view.dragMoved || pointer.event?.target !== this.scene.game.canvas) return;
    const p = this.worldPoint(pointer);
    const floor = floorNear(p.x, p.y, coupleFloorOk);
    if (!floor) return UI.showToast(coupleFixed() ? '발판(빨간·노란 선) 가까이를 눌러 주세요' : '무대(노란 선) 가까이를 눌러 주세요 (신랑신부 고정이 꺼져 있어요)');
    const { x1, x2 } = floorSpan(CONFIG.floors[floor]);
    const at = (dx) => ({ floor, x: Math.round(Phaser.Math.Clamp(p.x + dx, x1, x2)) });
    this.checkpoint();
    CONFIG.couple = { groom: at(-30), bride: at(30), fixed: coupleFixed() };
    this.changed();
  }

  /** 시작점 도구: 누른 곳 가까운 발판 위를 시작점으로 */
  setSpawn(pointer) {
    if (this.scene.view.dragMoved || pointer.event?.target !== this.scene.game.canvas) return;
    const p = this.worldPoint(pointer);
    const floor = floorNear(p.x, p.y);
    if (!floor) return UI.showToast('발판(빨간·노란 선) 가까이를 눌러 주세요');
    this.checkpoint();
    CONFIG.spawn = { floor, x: Math.round(p.x) };
    this.changed();
  }

  /** p(월드 좌표)를 누르는 영역에 둔 캐릭터들 중 가로로 가장 가까운 캐릭터 */
  characterAt(p, list) {
    let best = null;
    for (const c of list) {
      if (!c.visible || !c.input) continue;
      if (!Phaser.Geom.Rectangle.Contains(c.input.hitArea, p.x - c.x, p.y - c.y)) continue;
      if (!best || Math.abs(p.x - c.x) < Math.abs(p.x - best.x)) best = c;
    }
    return best;
  }

  /**
   * 캐릭터 끌기를 마침: 놓은 곳의 발판(발 아래 가장 가까운 것) 위로 옮긴다. 발판이 없으면 원래 자리로.
   * 신랑·신부는 그 자리가 지도 데이터(CONFIG.couple)에 들어가 되돌리기·저장 대상이 된다.
   */
  endCharDrag() {
    const d = this.charDrag;
    this.charDrag = null;
    if (!d?.moved) return;
    const c = d.character;
    const isCouple = c instanceof CoupleCharacter;
    const name = floorForDrop(c.x, c.y, isCouple ? coupleFloorOk : undefined);
    if (!name) UI.showToast(isCouple && !coupleFixed() ? '무대(노란 선) 위에 놓아 주세요 (신랑신부 고정이 꺼져 있어요)' : '발판(빨간·노란 선) 위에 놓아 주세요');
    if (isCouple && name) {
      this.checkpoint();
      CONFIG.couple = { ...coupleData(), [c.info.id]: { floor: name, x: Math.round(c.x) } };
    }
    if (isCouple && !c.controlled) {
      c.held = false;
      c.onMapChanged(); // 제자리(CONFIG.couple)에 선다
    } else {
      const to = name ? { floor: name, x: c.x } : d.from;
      c.dropAt(to.floor, to.x);
    }
    if (isCouple && name) this.changed();
  }

  onUp(pointer) {
    if (this.charDrag && pointer.id === this.charDrag.id) return this.endCharDrag();
    if (this.tool === 'spawn') return this.setSpawn(pointer);
    if (this.tool === 'couple') return this.setCouple(pointer);
    const stroke = this.stroke;
    if (!stroke || pointer.id !== stroke.id) return;
    this.stroke = null;
    this.preview.clear();
    if (this.tool === 'erase') this.erase(stroke.points);
    else if (this.type === 'walk' || this.type === 'stage') this.addFloor(stroke.points);
    else this.addClimb(stroke.points);
  }

  // ---------- 편집 ----------

  snapshot() {
    return JSON.stringify(mapData());
  }

  /** 바꾸기 전에 호출: 되돌리기 스냅샷 저장 */
  checkpoint() {
    this.history.push(this.snapshot());
    if (this.history.length > 50) this.history.shift();
  }

  changed() {
    this.releaseGuest();
    // 시작점·신랑신부 자리의 발판이 지워졌거나 잘렸으면 그 x를 덮는 발판으로 옮기고, 없으면 해제
    CONFIG.spawn = relocatePoint(CONFIG.spawn);
    if (CONFIG.couple) {
      for (const id of Object.keys(CONFIG.couple)) {
        if (id === 'fixed') continue;
        const p = relocatePoint(CONFIG.couple[id], coupleFloorOk);
        if (p) CONFIG.couple[id] = p;
        else delete CONFIG.couple[id]; // 기본 자리(무대 가운데)로
      }
    }
    this.dirty = this.snapshot() !== this.savedSnap;
    this.draw();
    this.updateToolbar();
    this.scene.refreshMap();
  }

  undo() {
    const snap = this.history.pop();
    if (!snap) return;
    const { floors, climbs, spawn, couple } = JSON.parse(snap);
    CONFIG.floors = floors;
    CONFIG.climbs = climbs;
    CONFIG.spawn = spawn;
    CONFIG.couple = couple;
    this.changed();
  }

  /** 누른 점과 뗀 점을 직선으로 잇는 발판 (계단처럼 기울어져도 됨) */
  addFloor(points) {
    const [a, b] = [points[0], points[points.length - 1]].sort((p, q) => p.x - q.x);
    if (b.x - a.x < 20) return UI.showToast('조금 더 길게 옆으로 드래그해 주세요');
    this.checkpoint();
    const name = this.type === 'stage' ? (CONFIG.floors.stage ? uniqueFloorName('stage') : 'stage') : uniqueFloorName('f');
    CONFIG.floors[name] = {
      path: [a, b].map((p) => [Math.round(p.x), Math.round(p.y)]),
    };
    this.changed();
  }

  /**
   * 세로 드래그로 사다리/로프 추가. 양 끝이 발판에 닿으면 두 발판을 잇고,
   * 위쪽 끝만 발판에 닿으면 아래가 허공에 매달린 사다리/로프(아래 끝 = 뗀 높이)
   */
  addClimb(points) {
    const x = points[0].x;
    const ys = [points[0].y, points[points.length - 1].y].sort((a, b) => a - b);
    const [topY, bottomY] = ys;
    const top = floorNear(x, topY);
    const bottom = floorNear(x, bottomY);
    const label = DEV_TYPES[this.type];
    if (!top) return UI.showToast(`${label} 위쪽 끝을 발판(빨간·노란 선) 위에 맞춰 주세요`);
    let climb;
    if (bottom && bottom !== top) {
      climb = { type: this.type, x: Math.round(x), floors: [top, bottom] };
    } else {
      const end = Math.round(bottomY);
      if (end - floorY(CONFIG.floors[top], x) < 20) return UI.showToast(`${label}를 아래로 조금 더 길게 드래그해 주세요`);
      climb = { type: this.type, x: Math.round(x), floors: [top], end };
    }
    this.checkpoint();
    CONFIG.climbs.push(climb);
    this.changed();
  }

  erase(points) {
    const r = this.brushRadius();
    const hit = (x, y) => points.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 <= r * r);
    const before = this.snapshot();

    if (this.type === 'walk' || this.type === 'stage') {
      const floors = {};
      const renamed = {}; // 원래 이름 → 잘리고 남은 조각 이름들
      for (const [name, f] of Object.entries(CONFIG.floors)) {
        if (isStage(name) !== (this.type === 'stage')) {
          floors[name] = f; // 걷기는 일반 발판만, 무대는 무대만 지운다
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
      if (JSON.stringify({ ...mapData(), floors, climbs }) === before) return;
      if (!Object.keys(floors).some(isStage)) return UI.showToast('무대는 조금이라도 남겨 주세요');
      this.checkpoint();
      CONFIG.floors = floors;
      CONFIG.climbs = climbs;
    } else {
      const keep = CONFIG.climbs.filter((c) => {
        if (c.type !== this.type || !c.floors.every((n) => CONFIG.floors[n])) return true;
        const { top, bottom } = climbEnds(c);
        const [y0, y1] = [top.y, bottom.y];
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
      await postJson('/api/map', { password, map: mapData() });
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

/** 저장·되돌리기 대상인 지도 데이터 전체 (js/map-data.js 내용) */
function mapData() {
  return { floors: CONFIG.floors, climbs: CONFIG.climbs, spawn: CONFIG.spawn, couple: CONFIG.couple };
}

/** 지금 신랑·신부 자리 { groom: { floor, x }, bride: { floor, x }, fixed } (지정 안 된 쪽은 기본 자리) */
function coupleData() {
  const data = { fixed: coupleFixed() };
  for (const id of ['groom', 'bride']) {
    const p = couplePoint(id);
    data[id] = { floor: p.floor, x: Math.round(p.x) };
  }
  return data;
}

/** 신랑·신부를 세울 수 있는 발판: 고정이면 어디든, 아니면 무대만 */
function coupleFloorOk(name) {
  return coupleFixed() || isStage(name);
}

/** 발판이 지워져 없어진 지점 { floor, x } → 그 x를 덮는 다른 발판(ok인 것)으로 옮김 (없으면 null) */
function relocatePoint(pt, ok = () => true) {
  if (!pt || CONFIG.floors[pt.floor]) return pt;
  const f = Object.entries(CONFIG.floors).find(([n, fl]) => ok(n) && pt.x >= floorSpan(fl).x1 && pt.x <= floorSpan(fl).x2);
  return f ? { ...pt, floor: f[0] } : null;
}

/**
 * 캐릭터를 놓을 발판: x를 덮는 발판 중 발 아래(위로 30px 여유)에서 가장 가까운 것, 없으면 위아래 가장 가까운 것.
 * ok(name)인 발판만
 */
function floorForDrop(x, y, ok = () => true) {
  let below = null;
  let near = null;
  for (const [name, f] of Object.entries(CONFIG.floors)) {
    if (!ok(name)) continue;
    const { x1, x2 } = floorSpan(f);
    if (x < x1 || x > x2) continue;
    const fy = floorY(f, x);
    if (fy >= y - 30 && (!below || fy < below.y)) below = { name, y: fy };
    if (!near || Math.abs(fy - y) < near.d) near = { name, d: Math.abs(fy - y) };
  }
  return (below ?? near)?.name ?? null;
}

function uniqueFloorName(prefix, taken = CONFIG.floors) {
  let i = 1;
  while (taken[`${prefix}${i}`] || CONFIG.floors[`${prefix}${i}`]) i++;
  return `${prefix}${i}`;
}

/** (x, y) 가까이(세로 24px 이내)에 있는 발판 이름 (ok(name)인 것만) */
function floorNear(x, y, ok = () => true) {
  let best = null;
  let bestDist = 24;
  for (const [name, f] of Object.entries(CONFIG.floors)) {
    if (!ok(name)) continue;
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
