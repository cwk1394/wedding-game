// 맵 보기 조작: 확대/축소(핀치, 휠)와 이동(드래그).
// 캔버스는 화면 전체(기기 픽셀 해상도)이고, 카메라 줌/위치로 맵의 어느 부분을 볼지 정한다.

const DPR = Math.min(window.devicePixelRatio || 1, 3);

class MapView {
  constructor(scene) {
    this.scene = scene;
    this.cam = scene.cameras.main;
    this.center = { ...CONFIG.view.focus }; // 화면 가운데에 올 월드 좌표
    this.zoom = 1;
    this.touched = false; // 사용자가 직접 조작했는지 (안 했으면 화면 회전 시 기본 보기로 복귀)
    this.dragMoved = false; // 이번 터치가 드래그/핀치였는지 (캐릭터 클릭과 구분)
    this.drag = null;
    this.pinch = null;

    this.updateLimits();
    this.reset();

    const input = scene.input;
    input.on('pointerdown', this.onDown, this);
    input.on('pointermove', this.onMove, this);
    input.on('pointerup', this.onUp, this);
    input.on('pointerupoutside', this.onUp, this);
    input.on('wheel', (pointer, _objs, _dx, dy) => {
      this.touched = true;
      this.zoomAt(pointer.x, pointer.y, Math.exp(-dy * 0.0015));
    });
    scene.scale.on('resize', this.onResize, this);
  }

  // ---------- 줌 한계 / 기본 보기 ----------

  updateLimits() {
    const { width, height } = this.cam;
    this.fitZoom = Math.min(width / CONFIG.width, height / CONFIG.height); // 맵 전체가 보이는 줌
    this.coverZoom = Math.max(width / CONFIG.width, height / CONFIG.height); // 화면을 꽉 채우는 줌
    this.minZoom = this.fitZoom;
    this.maxZoom = Math.max(this.coverZoom, CONFIG.view.maxZoom * DPR);
  }

  /** 세로 화면(폰)은 맵 높이를 화면에 꽉 채우고, 가로 화면은 맵 전체를 보여준다 */
  defaultZoom() {
    return this.cam.height > this.cam.width ? this.coverZoom : this.fitZoom;
  }

  reset() {
    this.zoom = this.defaultZoom();
    this.center = { ...CONFIG.view.focus };
    this.apply();
  }

  onResize() {
    this.updateLimits();
    if (this.touched) this.apply();
    else this.reset();
  }

  /** 줌/위치를 한계 안으로 맞추고 카메라에 적용. 맵이 화면보다 작은 방향은 가운데 정렬. */
  apply() {
    this.zoom = Phaser.Math.Clamp(this.zoom, this.minZoom, this.maxZoom);
    const halfW = this.cam.width / (2 * this.zoom);
    const halfH = this.cam.height / (2 * this.zoom);
    const clampAxis = (v, half, size) => (half * 2 >= size ? size / 2 : Phaser.Math.Clamp(v, half, size - half));
    this.center.x = clampAxis(this.center.x, halfW, CONFIG.width);
    this.center.y = clampAxis(this.center.y, halfH, CONFIG.height);
    this.cam.setZoom(this.zoom);
    this.cam.centerOn(this.center.x, this.center.y);
  }

  /** 화면 좌표 → 월드 좌표 */
  toWorld(sx, sy, zoom = this.zoom, center = this.center) {
    return {
      x: center.x + (sx - this.cam.width / 2) / zoom,
      y: center.y + (sy - this.cam.height / 2) / zoom,
    };
  }

  /** 화면 좌표 (sx, sy) 아래의 지점을 고정한 채로 줌 */
  zoomAt(sx, sy, factor) {
    const anchor = this.toWorld(sx, sy);
    const zoom = Phaser.Math.Clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    this.zoom = zoom;
    this.center = {
      x: anchor.x - (sx - this.cam.width / 2) / zoom,
      y: anchor.y - (sy - this.cam.height / 2) / zoom,
    };
    this.apply();
  }

  zoomBy(factor) {
    this.touched = true;
    this.zoomAt(this.cam.width / 2, this.cam.height / 2, factor);
  }

  // ---------- 터치 / 마우스 ----------

  downPointers() {
    return this.scene.input.manager.pointers.filter((p) => p.isDown);
  }

  startDrag(pointer) {
    this.drag = { id: pointer.id, x: pointer.x, y: pointer.y, center: { ...this.center } };
  }

  startPinch([a, b]) {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.pinch = {
      ids: [a.id, b.id],
      dist: Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y),
      zoom: this.zoom,
      anchor: this.toWorld(mid.x, mid.y), // 두 손가락 가운데 아래의 월드 지점
    };
    this.drag = null;
  }

  onDown(pointer) {
    const down = this.downPointers();
    if (down.length >= 2) {
      this.dragMoved = true;
      this.startPinch(down);
    } else {
      this.dragMoved = false;
      this.startDrag(pointer);
    }
  }

  onMove(pointer) {
    if (this.pinch) {
      const [a, b] = this.pinch.ids.map((id) => this.scene.input.manager.pointers.find((p) => p.id === id));
      if (!a?.isDown || !b?.isDown) return;
      const dist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.zoom = Phaser.Math.Clamp((this.pinch.zoom * dist) / this.pinch.dist, this.minZoom, this.maxZoom);
      // 처음 잡은 지점이 계속 손가락 가운데 아래에 오도록 이동
      this.center = {
        x: this.pinch.anchor.x - (mid.x - this.cam.width / 2) / this.zoom,
        y: this.pinch.anchor.y - (mid.y - this.cam.height / 2) / this.zoom,
      };
      this.touched = true;
      this.apply();
      return;
    }

    if (!this.drag || pointer.id !== this.drag.id || !pointer.isDown) return;
    const dx = pointer.x - this.drag.x;
    const dy = pointer.y - this.drag.y;
    if (!this.dragMoved && Math.hypot(dx, dy) < CONFIG.view.dragThreshold * DPR) return;
    this.dragMoved = true;
    this.touched = true;
    this.center = { x: this.drag.center.x - dx / this.zoom, y: this.drag.center.y - dy / this.zoom };
    this.apply();
  }

  onUp() {
    const down = this.downPointers();
    this.pinch = null;
    // 핀치하다 한 손가락만 떼면 남은 손가락으로 계속 드래그
    if (down.length === 1) this.startDrag(down[0]);
    else this.drag = null;
  }
}
