// 개발자 모드 (페이지를 ?dev 로 열기): 이동 가능 영역(발판·사다리·로프·무대) 편집기.
// - 종류(걷기/사다리/로프/무대)와 도구(이동/추가/지우기)를 고르고 지도 위를 드래그해서 편집
// - 저장하면 /api/map 이 js/map-data.js 를 저장소에 커밋 → 1~2분 뒤 사이트에 반영
// - 조종: 캐릭터 팝업의 "조종하기" (개발자 모드에선 신랑·신부도). 조종 자체는 js/control.js의 Controller
// - 시작점 도구: 방명록 등록 직후 새 캐릭터가 나타나는 위치(CONFIG.spawn)를 지정
// - 신랑신부 도구: 누른 곳 발판 위에 신랑·신부를 나란히 (CONFIG.couple)
// - 캐릭터 끌기(편집 도구가 아닐 때): 누르고 끌면 놓은 곳의 발판으로 옮김. 신랑·신부·고정 NPC는 그 자리가 저장됨
// - NPC를 누르면 NPC 설정 창: 이름·디렉토리·한줄 멘트·소개 글, 배치 방식(고정/랜덤/무대/기본) → CONFIG.npcs (저장·되돌리기 대상)
//   디렉토리 이름을 바꾸면 저장할 때 API가 img/npc/<id>/ 폴더와 js/npcs.js의 id를 같이 바꾼다
// - NPC 추가(툴바): 사진·설명으로 AI 캐릭터 생성 → 화면 가운데 발판에 바로 등장. 저장하면 이미지가 img/npc/<id>/에 커밋되고 설정은 map-data npcs[id].def
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
    this.deletedNpcDirs = new Set(); // 저장된 추가 NPC 중 삭제한 것 → 저장 때 img/npc/<id>/ 폴더도 지움
    this.pendingNpcImages = {}; // 추가했지만 아직 저장 안 한 NPC 이미지 { <id>: { front, idle?, walk? } } (스냅샷엔 안 넣음 — 너무 큼)

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
        <button type="button" class="dev-btn" data-act="npc-add">NPC 추가</button>
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
    bar.querySelector('[data-act="npc-add"]').addEventListener('click', () => this.openNpcCreator());
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
    const npc = c instanceof NpcCharacter ? c.npc : null;
    if (npc && isStaticNpc(npc)) {
      // 가만히 있는 NPC(사물): 발판과 상관없이 놓은 자리(공중도)에 고정
      this.checkpoint();
      const { floor, ...rest } = CONFIG.npcs[npc.id] ?? {};
      CONFIG.npcs = { ...CONFIG.npcs, [npc.id]: { ...rest, mode: 'fixed', x: Math.round(c.x), y: Math.round(c.y) } };
      c.held = false;
      return this.changed();
    }
    const stageOnly = isCouple ? !coupleFixed() : npc && c.mode === 'stage';
    const name = floorForDrop(c.x, c.y, stageOnly ? isStage : undefined);
    if (!name) UI.showToast(stageOnly ? '무대(노란 선) 위에 놓아 주세요' : '발판(빨간·노란 선) 위에 놓아 주세요');
    if (isCouple && name) {
      this.checkpoint();
      CONFIG.couple = { ...coupleData(), [c.info.id]: { floor: name, x: Math.round(c.x) } };
    }
    if (npc && name && c.mode === 'fixed') {
      // 고정 NPC는 놓은 자리가 저장된다
      this.checkpoint();
      CONFIG.npcs = { ...CONFIG.npcs, [npc.id]: { ...CONFIG.npcs[npc.id], mode: 'fixed', floor: name, x: Math.round(c.x) } };
      c.dropAt(name, c.x);
      return this.changed();
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
    this.syncNpcs();
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
    // 고정 NPC 자리도 같은 방식으로 (못 옮기면 고정 해제 → 기본)
    for (const [id, n] of Object.entries(CONFIG.npcs)) {
      if (n.mode !== 'fixed' || n.y != null) continue; // 발판 없이 놓인 자리(y)는 그대로
      const p = relocatePoint({ floor: n.floor, x: n.x });
      if (p) CONFIG.npcs[id] = { ...n, ...p };
      else {
        const { mode, floor, x, ...rest } = n;
        CONFIG.npcs[id] = rest;
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
    const { floors, climbs, spawn, couple, npcs } = JSON.parse(snap);
    CONFIG.floors = floors;
    CONFIG.climbs = climbs;
    CONFIG.spawn = spawn;
    CONFIG.couple = couple;
    CONFIG.npcs = npcs ?? {};
    this.changed();
  }

  /** 저장 후: 디렉토리 이름을 바꾼 NPC는 새 id로 (서버가 폴더·npcs.js를 바꿨으므로. 이미지는 이미 불러와 있어 다시 안 불러옴). 바꾼 게 있으면 true */
  applyNpcRenames() {
    let renamed = false;
    for (const c of this.scene.npcs) {
      const { dir, ...rest } = CONFIG.npcs[c.npc.id] ?? {};
      if (!dir) continue;
      delete CONFIG.npcs[c.npc.id];
      if (Object.keys(rest).length) CONFIG.npcs[dir] = rest;
      c.npc.id = dir;
      c.info.id = `npc-${dir}`;
      renamed = true;
    }
    return renamed;
  }

  /** NPC 설정 창: 한줄 멘트·소개 글·배치 방식을 바꾸면 CONFIG.npcs에 넣는다 (저장 버튼으로 사이트에 반영) */
  openNpcSettings(c) {
    const { id } = c.npc;
    const cur = CONFIG.npcs[id] ?? {};
    const pending = this.pendingNpcImages[id] && !this.pendingNpcImages[id].replace; // 아직 저장 안 한 새 NPC
    const regen = {
      desc: cur.def?.desc ?? '',
      moving: c.npc.motions.includes('walk') ? 'walk' : 'static',
      height: cur.def?.height ?? c.npc.height ?? 40,
      heightLocked: !cur.def, // js/npcs.js의 기본 NPC 키는 코드에 있음
    };
    UI.openNpcSettings({ ...c.info, dir: cur.dir ?? id, album: cur.album, avatarUrl: c.getAvatarUrl(), mode: c.mode }, ({ name, dir, shortMsg, longMsg, mode, album, images, desc, height }) => {
      if (images) {
        if (!images.front) return '캐릭터를 먼저 생성해 주세요.';
        if (dir !== (cur.dir ?? id)) return '이미지와 디렉토리 이름은 따로 바꿔 주세요. (이미지를 먼저 저장한 뒤 이름 변경)';
      }
      if (pending) dir = id; // 아직 저장 안 한 추가 NPC는 폴더가 없어서 이름을 못 바꿈
      if (!name) return '이름을 입력해 주세요.';
      const albumError = checkAlbum(album);
      if (albumError) return albumError;
      if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(dir)) return '디렉토리 이름은 영문 소문자·숫자·-만 쓸 수 있어요.';
      const taken = this.scene.npcs.some((o) => o !== c && (o.npc.id === dir || CONFIG.npcs[o.npc.id]?.dir === dir));
      if (taken) return `"${dir}"는 다른 NPC가 쓰고 있어요.`;
      const next = { name: name === c.npc.name && !cur.def ? undefined : name, dir: dir === id ? undefined : dir, shortMsg, longMsg, album: album ?? undefined, def: cur.def };
      if (mode === 'fixed') {
        // 지금 서 있는 자리에 고정 (가만히 있는 NPC는 발판과 상관없이 x, y 그대로)
        Object.assign(next, isStaticNpc(c.npc) ? { mode, x: Math.round(c.x), y: Math.round(c.y) } : { mode, floor: c.floorName, x: Math.round(c.x) });
      }
      else if (mode !== 'default') next.mode = mode;
      if (images && cur.def) {
        // 추가한 NPC: 설명·키·동작도 새 이미지에 맞춘다
        const motions = ['idle', 'walk'].filter((m) => images[m]);
        next.def = { desc: desc || cur.def.desc, height: Phaser.Math.Clamp(Math.round(height) || cur.def.height, 10, 200), motions };
      }
      const texts = npcTexts(c.npc);
      if (!images && name === texts.name && dir === (cur.dir ?? id) && shortMsg === texts.shortMsg && longMsg === texts.longMsg && mode === c.mode && (album ?? null) === (cur.album ?? null)) return; // 바뀐 것 없음
      this.checkpoint();
      CONFIG.npcs = { ...CONFIG.npcs, [id]: next };
      if (images) {
        this.replaceNpcImages(c, images, pending);
        this.changed();
        return UI.showToast('이미지를 바꿨어요. 저장 버튼을 누르면 사이트에 반영돼요 (이미지 변경은 되돌리기 없음)', 3500);
      }
      c.updateInfo(npcTexts(c.npc));
      this.changed();
      UI.showToast('저장 버튼을 누르면 사이트에 반영돼요');
    }, { dirLocked: pending, onDelete: () => this.deleteNpc(c), regen });
  }

  /**
   * 신랑·신부 설정 창: 이름·한줄 멘트·소개 글 → CONFIG.npcs.groom/bride (js/data.js COUPLE 값을 덮어씀, 저장·되돌리기 대상)
   * "이미지 새로 만들기"(사진·설명)로 만든 이미지는 저장 때 img/npc/<id>/에 덮어쓴다 (설명은 CONFIG.npcs[id].desc)
   */
  openCoupleSettings(c) {
    const { id } = c.info;
    const cur = CONFIG.npcs[id] ?? {};
    UI.openNpcSettings(
      { ...c.info, dir: id, avatarUrl: c.getAvatarUrl(), mode: 'default' },
      ({ name, shortMsg, longMsg, images, desc }) => {
        if (!name) return '이름을 입력해 주세요.';
        if (images && !images.front) return '캐릭터를 먼저 생성해 주세요.';
        const texts = coupleTexts(id);
        if (!images && name === texts.name && shortMsg === texts.shortMsg && longMsg === texts.longMsg) return; // 바뀐 것 없음
        this.checkpoint();
        CONFIG.npcs = { ...CONFIG.npcs, [id]: { name, shortMsg, longMsg, desc: images ? desc || undefined : cur.desc } };
        c.updateInfo(coupleTexts(id));
        this.changed();
        if (images) {
          this.replaceCoupleImages(c, images);
          return UI.showToast('이미지를 바꿨어요. 저장 버튼을 누르면 사이트에 반영돼요 (이미지 변경은 되돌리기 없음)', 3500);
        }
        UI.showToast('저장 버튼을 누르면 사이트에 반영돼요');
      },
      { textsOnly: true, regen: { desc: cur.desc ?? '', couple: true } }
    );
  }

  /** 신랑·신부 이미지 교체: 새 텍스처(다른 키)로 바로 바꾸고 저장 때 img/npc/<id>/에 덮어쓴다. 못 만든 동작은 지금 이미지 그대로 */
  replaceCoupleImages(c, images) {
    const { id } = c.info;
    this.pendingNpcImages[id] = { ...images, replace: true };
    const urls = Object.fromEntries(Object.entries(images).map(([m, src]) => [m === 'front' ? 'spriteUrl' : `${m}Url`, src]));
    Object.assign(c.info, urls, { texId: `${id}-${Date.now()}` }); // texId: 텍스처를 새로 불러오게
    loadSpriteTextures(this.scene, c.info).then((sprite) => c.active && c.applySprite(sprite));
    this.history = [];
  }

  /**
   * NPC 삭제 (되돌리기 가능). 추가한 NPC는 설정을 지우고 저장 때 이미지 폴더도 지운다.
   * js/npcs.js의 기본 NPC는 코드에 있어서 deleted 표시로 숨기기만 (이미지는 남김)
   */
  deleteNpc(c) {
    const { id } = c.npc;
    this.checkpoint();
    const npcs = { ...CONFIG.npcs };
    if (c.npc.custom) {
      delete npcs[id];
      this.deletedNpcDirs.add(id);
    } else npcs[id] = { deleted: true };
    CONFIG.npcs = npcs;
    this.changed();
    UI.showToast(`${c.info.name}을(를) 삭제했어요. 저장 버튼을 누르면 사이트에 반영돼요`, 3000);
  }

  /**
   * NPC 이미지 교체: 새 이미지로 맵의 NPC를 다시 만들고 저장 때 img/npc/<id>/에 덮어쓴다 (replace).
   * 저장 전 새 NPC(pendingNew)면 그냥 새 이미지로. 이미지는 스냅샷에 없어서 되돌리기 기록은 비운다
   */
  replaceNpcImages(c, images, pendingNew) {
    const { id } = c.npc;
    this.pendingNpcImages[id] = { ...images, replace: !pendingNew };
    const s = CONFIG.npcs[id];
    const npc = s?.def ? { ...customNpc(id, s) } : { ...c.npc };
    Object.assign(npc, { images, imagesRev: Date.now() }); // imagesRev: 텍스처를 새로 불러오게
    const i = this.scene.npcs.indexOf(c);
    c.destroy();
    this.scene.npcs[i] = new NpcCharacter(this.scene, npc, { onSelect: this.scene.onSelect });
    this.history = [];
  }

  /** NPC 추가 창: 사진·설명으로 캐릭터를 만들어 추가 (화면 가운데 발판) */
  openNpcCreator() {
    UI.openNpcSettings({ name: '', dir: '', shortMsg: '', longMsg: '', mode: 'random' }, (v) => this.addNpc(v), { create: true });
  }

  /** NPC 추가 창에서 "추가": 검사 후 CONFIG.npcs에 넣고 맵에 바로 만든다. 오류 문구를 돌려주면 창이 그대로 */
  addNpc({ name, dir, shortMsg, longMsg, mode, album, desc, height, images }) {
    if (!images?.front) return '캐릭터를 먼저 생성해 주세요.';
    const albumError = checkAlbum(album);
    if (albumError) return albumError;
    if (!desc) return 'NPC 설명(무엇인지)을 입력해 주세요.';
    if (!name) return '이름을 입력해 주세요.';
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(dir)) return '디렉토리 이름(영문 소문자·숫자·-)을 입력해 주세요.';
    const taken = CONFIG.npcs[dir] || this.scene.npcs.some((o) => o.npc.id === dir || CONFIG.npcs[o.npc.id]?.dir === dir);
    if (taken || this.deletedNpcDirs.has(dir) || ['groom', 'bride'].includes(dir)) return `"${dir}"는 이미 있는 이름이에요.`;

    const motions = ['idle', 'walk'].filter((m) => images[m]);
    const entry = { name, shortMsg, longMsg, ...(album ? { album } : {}), def: { desc, height: Phaser.Math.Clamp(Math.round(height) || 40, 10, 200), motions } };
    if (mode === 'fixed') {
      // 화면 가운데에서 가장 가까운 발판 위 (없으면 무대 가운데)
      const cam = this.scene.cameras.main;
      const p = cam.getWorldPoint(cam.width / 2, cam.height / 2);
      const floor = floorForDrop(p.x, p.y) ?? mainStageName();
      const { x1, x2 } = floorSpan(CONFIG.floors[floor]);
      Object.assign(entry, { mode, floor, x: Math.round(Phaser.Math.Clamp(p.x, x1, x2)) });
    } else if (mode !== 'default') entry.mode = mode;

    this.checkpoint();
    CONFIG.npcs = { ...CONFIG.npcs, [dir]: entry };
    this.pendingNpcImages[dir] = images;
    const npc = { ...customNpc(dir, entry), images };
    this.scene.npcs.push(new NpcCharacter(this.scene, npc, { onSelect: this.scene.onSelect }));
    this.changed();
    UI.showToast('NPC를 추가했어요. 저장 버튼을 누르면 사이트에 반영돼요', 3000);
  }

  /** 맵 위 NPC를 CONFIG.npcs에 맞춘다: 삭제됐거나 되돌리기로 빠진 NPC는 지우고, 되돌리기로 살아난 NPC는 다시 만든다 */
  syncNpcs() {
    const gone = (npc) => (npc.custom ? !CONFIG.npcs[npc.id]?.def : CONFIG.npcs[npc.id]?.deleted);
    this.scene.npcs = this.scene.npcs.filter((c) => {
      if (!gone(c.npc)) return true;
      c.destroy();
      return false;
    });
    const shown = new Set(this.scene.npcs.map((c) => c.npc.id));
    const all = [
      ...NPCS.filter((npc) => !npc.custom),
      ...Object.entries(CONFIG.npcs)
        .filter(([, s]) => s.def)
        .map(([id, s]) => ({ ...customNpc(id, s), images: this.pendingNpcImages[id] })),
    ];
    for (const npc of all) {
      if (shown.has(npc.id) || gone(npc)) continue;
      this.scene.npcs.push(new NpcCharacter(this.scene, npc, { onSelect: this.scene.onSelect }));
    }
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
    const password = devPassword();
    if (!password) return;

    const btn = this.bar.querySelector('.dev-save');
    btn.disabled = true;
    btn.textContent = '저장 중...';
    try {
      // 새 NPC 이미지·바꾼 이미지 (아직 저장 안 했고, 되돌리기·삭제로 빠지지 않은 것만)
      const npcImages = {};
      for (const [id, { replace, ...imgs }] of Object.entries(this.pendingNpcImages)) {
        if (replace ? CONFIG.npcs[id]?.deleted || this.deletedNpcDirs.has(id) : !CONFIG.npcs[id]?.def) continue;
        npcImages[id] = { replace };
        const maxWidth = ['groom', 'bride'].includes(id) ? 1536 : 768; // 신랑·신부는 하객처럼 머리 폭을 재서 원본 크기 그대로
        for (const [m, src] of Object.entries(imgs)) npcImages[id][m] = await shrinkWebp(src, maxWidth);
      }
      // 삭제한 추가 NPC 폴더 (되돌리기로 살아난 것·저장 전 추가였던 것은 빼고)
      const npcDeletes = [...this.deletedNpcDirs].filter((id) => !CONFIG.npcs[id] && !(this.pendingNpcImages[id] && !this.pendingNpcImages[id].replace));
      await postJson('/api/map', { password, map: mapData(), npcImages, npcDeletes });
      rememberDevPassword(password);
      this.deletedNpcDirs.clear();
      this.pendingNpcImages = Object.fromEntries(Object.entries(this.pendingNpcImages).filter(([id]) => !npcImages[id])); // 올린 것만 비움
      // NPC 폴더를 만들었거나·지웠거나·이름을 바꿨으면 되돌리기 기록을 비운다 (저장소 폴더와 안 맞는 스냅샷으로 되돌리면 꼬임)
      if (this.applyNpcRenames() || npcDeletes.length || Object.keys(npcImages).length) this.history = [];
      this.savedSnap = this.snapshot();
      this.dirty = false;
      UI.showToast('저장했어요! 1~2분 뒤 사이트에 반영돼요', 3000);
    } catch (err) {
      rememberDevPassword(password, err);
      UI.showToast(err.message, 3500);
    } finally {
      btn.disabled = false;
      btn.textContent = '저장';
      this.updateToolbar();
    }
  }
}

// ---------- 편집용 도우미 ----------

/** 앨범 디렉토리 이름 검사 (album이 null이면 일반 NPC라 통과). 오류 문구 또는 null */
function checkAlbum(album) {
  if (album == null) return null;
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(album) ? null : '앨범 디렉토리 이름(영문 소문자·숫자·-)을 입력해 주세요.';
}

/** 개발자 비밀번호: 처음 한 번 묻고 탭을 닫을 때까지 기억 (저장·NPC 캐릭터 생성). 취소하면 null */
function devPassword() {
  let password = null;
  try {
    password = sessionStorage.getItem('devPassword');
  } catch {}
  return password || prompt('개발자 모드 비밀번호') || null;
}

/** 서버 응답에 따라 비밀번호 기억: 맞으면 저장, 틀렸다는 오류면 지움 */
function rememberDevPassword(password, err) {
  try {
    if (!err) sessionStorage.setItem('devPassword', password);
    else if (/비밀번호/.test(err.message)) sessionStorage.removeItem('devPassword');
  } catch {}
}

/** 이미지 data URL을 가로 maxWidth 이하 webp로 줄인다 (NPC 이미지 커밋 용량 절약, gen-npc와 같은 768px). webp로 못 만드는 브라우저면 그대로 */
async function shrinkWebp(src, maxWidth = 768) {
  const img = await loadImage(src);
  if (img.naturalWidth <= maxWidth) return src;
  const canvas = document.createElement('canvas');
  canvas.width = maxWidth;
  canvas.height = Math.round((img.naturalHeight * maxWidth) / img.naturalWidth);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = canvas.toDataURL('image/webp', 0.9);
  return out.startsWith('data:image/webp') ? out : src;
}

/** 저장·되돌리기 대상인 지도 데이터 전체 (js/map-data.js 내용) */
function mapData() {
  return { floors: CONFIG.floors, climbs: CONFIG.climbs, spawn: CONFIG.spawn, couple: CONFIG.couple, npcs: CONFIG.npcs };
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
