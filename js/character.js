// 캐릭터 = 스프라이트 + 네임태그 + (가끔) 말풍선을 묶은 컨테이너.
// 컨테이너 원점(0,0)은 캐릭터 발 위치.

// 확대해도 글자가 선명하도록 기기 해상도에 맞춰 크게 렌더링
const TEXT_RESOLUTION = Math.min(5, Math.ceil((window.devicePixelRatio || 1) * 2));

class Character extends Phaser.GameObjects.Container {
  constructor(scene, x, y, info, { tagColor = '#ffffff', onSelect } = {}) {
    super(scene, x, y);
    scene.add.existing(this);

    this.info = info;
    this.texKey = createCharacterTexture(scene, info);
    this.bubble = null;

    this.sprite = scene.add.sprite(0, 0, `${this.texKey}_0`).setOrigin(0.5, 1);
    this.tag = scene.add
      .text(0, 4, info.name, {
        fontFamily: CONFIG.fontFamily,
        fontSize: '15px',
        color: tagColor,
        backgroundColor: 'rgba(0,0,0,0.6)',
        padding: { x: 5, y: 2 },
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0.5, 0);
    this.add([this.sprite, this.tag]);

    // 누르는 영역: 발(원점) 기준 고정 사각형 + 네임태그.
    // 스프라이트 자체에 걸면 걷기·사다리 프레임마다 크기가 달라 가장자리를 눌러도 안 잡히는 경우가 생긴다.
    this.setInteractive(new Phaser.Geom.Rectangle(0, 0, 1, 1), Phaser.Geom.Rectangle.Contains);
    this.input.cursor = 'pointer';
    this.updateHitArea(CHAR_W, CHAR_H);
    this.on('pointerup', (pointer) => {
      if (scene.view?.dragMoved) return; // 맵을 드래그하다 손을 뗀 경우는 클릭 아님
      if (scene.dev?.editing) return; // 개발자 모드 편집 중
      if (pointer.event?.target !== scene.game.canvas) return; // 팝업 등 캔버스 밖을 누른 경우
      if (scene.dev?.tool === 'control') return; // 개발자 모드 조종 도구: 선택은 DevMode가 처리 (겹친 캐릭터 중 가장 가까운 것)
      onSelect?.(this);
    });

    this.facesLeft = false; // 원본 이미지가 왼쪽을 바라보는지 (걷기 방향 뒤집기용)
    this.setDepth(y);
    this.scheduleBubble(Phaser.Math.Between(500, CONFIG.bubble.maxGap));

    // 이미지 스프라이트가 있으면 로드되는 동안은 임시 캐릭터를 보여주고, 로드되면 교체.
    // ready: 이미지 적용이 끝나면(실패해도) resolve → 첫 로딩 화면이 이걸 기다린다.
    this.ready = info.spriteUrl
      ? loadSpriteTextures(scene, info)
          .then((sprite) => this.active && this.applySprite(sprite))
          .catch((err) => console.warn(`${info.name} 스프라이트 로드 실패:`, err))
      : Promise.resolve();
  }

  applySprite({ key, facesLeft }) {
    this.texKey = key;
    this.facesLeft = facesLeft;
    this.sprite.setTexture(`${key}_0`).setScale(1 / CONFIG.sprite.textureScale);
    this.updateHitArea(this.sprite.displayWidth, this.sprite.displayHeight);
  }

  /** 누르는 영역 = 캐릭터(정면 크기보다 조금 넓게 — 걸어다니는 중에도 잘 잡히게) + 발밑 네임태그 */
  updateHitArea(width, height) {
    const w = Math.max(CHAR_W, width) * 1.3;
    const tagH = this.tag.height + 6;
    this.input.hitArea.setTo(-w / 2, -height, w, height + tagH);
  }

  /** 스프라이트 이미지를 data URL로 반환 (팝업 프로필용) */
  getAvatarUrl() {
    return this.scene.textures.getBase64(`${this.texKey}_0`);
  }

  scheduleBubble(delay) {
    this.scene.time.delayedCall(delay, () => {
      if (!this.active) return;
      this.say(this.info.shortMsg);
      this.scheduleBubble(
        CONFIG.bubble.duration + Phaser.Math.Between(CONFIG.bubble.minGap, CONFIG.bubble.maxGap)
      );
    });
  }

  say(message, duration = CONFIG.bubble.duration) {
    if (!message) return;
    this.hideBubble();

    const text = this.scene.add
      .text(0, 0, message, {
        fontFamily: CONFIG.fontFamily,
        fontSize: '16px',
        color: '#222222',
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0.5);

    const w = text.width + 18;
    const h = text.height + 10;
    const cy = -this.sprite.displayHeight - 14 - h / 2; // 말풍선 중심 y
    const bottom = cy + h / 2;
    text.setY(cy);

    const g = this.scene.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.lineStyle(2, 0x444444, 1);
    g.fillRoundedRect(-w / 2, cy - h / 2, w, h, 8);
    g.strokeRoundedRect(-w / 2, cy - h / 2, w, h, 8);
    // 꼬리
    g.fillTriangle(-6, bottom - 1, 6, bottom - 1, 0, bottom + 8);
    g.beginPath();
    g.moveTo(-6, bottom);
    g.lineTo(0, bottom + 8);
    g.lineTo(6, bottom);
    g.strokePath();

    const bubble = this.scene.add.container(0, 0, [g, text]).setAlpha(0);
    this.add(bubble);
    this.bubble = bubble;

    this.scene.tweens.add({ targets: bubble, alpha: 1, duration: 150 });
    this.scene.time.delayedCall(duration, () => {
      if (this.bubble !== bubble) return;
      this.scene.tweens.add({
        targets: bubble,
        alpha: 0,
        duration: 200,
        onComplete: () => this.hideBubble(bubble),
      });
    });
  }

  hideBubble(target = this.bubble) {
    if (!target) return;
    target.destroy();
    if (this.bubble === target) this.bubble = null;
  }

  tick() {}
}

/**
 * 발판 끝(dir 방향)에 바로 이어지는 다른 발판 이름 (끝점끼리 가로 6px·세로 10px 이내).
 * 개발자 모드에서 직선 여러 개로 그린 길은 이렇게 이어진 발판들 → 끊김 없이 걸어서 넘어간다.
 */
function floorContinuation(fromName, dir) {
  const end = dir > 0 ? CONFIG.floors[fromName].path.at(-1) : CONFIG.floors[fromName].path[0];
  for (const [name, f] of Object.entries(CONFIG.floors)) {
    if (name === fromName || name === 'stage') continue;
    const start = dir > 0 ? f.path[0] : f.path.at(-1);
    if (Math.abs(start[0] - end[0]) <= 6 && Math.abs(start[1] - end[1]) <= 10) return name;
  }
  return null;
}

/**
 * 발판 끝(x, dir 방향)에서 점프로 건너갈 수 있는 다른 발판의 착지점들 [{ name, x, y }].
 * 가로 틈이 maxGap 이하이고, 착지 높이 차가 위로 maxUp / 아래로 maxDown 이내인 발판 (stage 제외).
 * 틈이 없이 겹쳐 있는 발판(바로 아래층 등)으로 뛰어내리는 것도 포함.
 */
function gapJumpTargets(fromName, x, dir) {
  const g = CONFIG.motion.gapJump;
  const from = CONFIG.floors[fromName];
  const y = floorY(from, x);
  const span = floorSpan(from);
  const edge = dir > 0 ? span.x2 : span.x1;
  const out = [];
  const next = floorContinuation(fromName, dir); // 이어진 발판은 점프 대신 걸어서 넘어감
  for (const [name, f] of Object.entries(CONFIG.floors)) {
    if (name === fromName || name === 'stage' || name === next) continue;
    const { x1, x2 } = floorSpan(f);
    const m = Math.min(CHAR_W / 2, (x2 - x1) / 4);
    const gap = dir > 0 ? x1 - edge : edge - x2;
    if (gap > g.maxGap) continue;
    const tx = dir > 0 ? Math.max(x1 + m, x + 12) : Math.min(x2 - m, x - 12);
    if (tx < x1 + m - 0.5 || tx > x2 - m + 0.5) continue; // 앞쪽에 착지할 자리가 없음
    const ty = floorY(f, tx);
    if (ty - y < -g.maxUp || ty - y > g.maxDown) continue;
    out.push({ name, x: tx, y: ty });
  }
  return out;
}

/** 층에 붙은 사다리/로프 목록 */
function climbsOn(floorName) {
  return CONFIG.climbs.filter((c) => c.floors.includes(floorName));
}

/**
 * 하객: 층 위를 걷다 멈췄다 하고, 가끔 점프하거나 사다리/로프를 타고 다른 층으로 간다.
 * state: idle | walk | climb (점프는 걷는 도중 겹쳐서 일어남)
 */
class GuestCharacter extends Character {
  constructor(scene, floor, info, opts) {
    const { x1, x2 } = floorSpan(floor);
    const margin = Math.min(CHAR_W / 2, (x2 - x1) / 4); // 짧은 발판에서도 범위가 뒤집히지 않게
    const x = opts?.x ?? Phaser.Math.Between(x1 + margin, x2 - margin);
    super(scene, x, floorY(floor, x), info, opts);

    this.motions = {}; // 이미지 스프라이트 로드 후 { walk, jump, ladder, rope } 사용 가능 여부
    this.speed = Phaser.Math.Between(CONFIG.walkSpeed.min, CONFIG.walkSpeed.max);
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.state = 'idle';
    this.stateTimer = 0;
    this.jump = null; // { t, duration }
    this.climb = null; // { targetFloor, toY, dir }
    this.climbReadyAt = 0;
    this.setFloor(Object.keys(CONFIG.floors).find((name) => CONFIG.floors[name] === floor));
  }

  setFloor(name) {
    this.floorName = name;
    this.floor = CONFIG.floors[name];
    const { x1, x2 } = floorSpan(this.floor);
    const margin = Math.min(CHAR_W / 2, (x2 - x1) / 4);
    // 이어진 발판이 있는 쪽 끝은 여유 없이 끝까지 (그대로 걸어서 넘어감)
    this.nextFloor = { [-1]: floorContinuation(name, -1), [1]: floorContinuation(name, 1) };
    // 사다리/로프가 층 끝 가까이 있어도 닿을 수 있게 범위를 넓힌다
    const climbXs = climbsOn(name).map((c) => c.x);
    this.minX = Math.min(this.nextFloor[-1] ? x1 : x1 + margin, ...climbXs);
    this.maxX = Math.max(this.nextFloor[1] ? x2 : x2 - margin, ...climbXs);
  }

  /** 발판 끝에서 이어진 발판으로 넘어가기 (x는 새 발판 안으로) */
  continueTo(name) {
    this.setFloor(name);
    const { x1, x2 } = floorSpan(this.floor);
    this.x = Phaser.Math.Clamp(this.x, x1, x2);
  }

  setDir(dir) {
    this.dir = dir;
    this.sprite.setFlipX(this.facesLeft ? dir > 0 : dir < 0);
  }

  applySprite(sprite) {
    super.applySprite(sprite);
    this.motions = sprite.motions ?? {};
    this.updatePose();
  }

  pickState() {
    this.state = Math.random() < 0.65 ? 'walk' : 'idle';
    this.stateTimer = Phaser.Math.Between(1200, 4000);
    if (this.state === 'walk' && Math.random() < 0.5) this.dir = -this.dir;
    this.updatePose();
  }

  /** 현재 상태에 맞는 애니메이션/텍스처 */
  updatePose() {
    const key = this.texKey;
    if (this.state === 'climb') {
      // 사다리/로프 이미지가 없으면 서로 대신 쓰고, 둘 다 없으면 정면 그대로
      const type = this.climb.type;
      const other = type === 'ladder' ? 'rope' : 'ladder';
      const anim = this.motions[type] ? type : this.motions[other] ? other : null;
      this.sprite.setFlipX(false);
      if (anim) this.sprite.play(`${key}_${anim}`, true);
      else {
        this.sprite.stop();
        this.sprite.setTexture(`${key}_0`);
      }
      return;
    }
    const jumping = this.jump ?? this.leap;
    if (jumping && this.motions.jump) {
      this.setDir(this.dir);
      this.sprite.play({ key: `${key}_jump`, frameRate: (4 * 1000) / jumping.duration }, true);
      return;
    }
    if (this.state === 'walk') {
      this.setDir(this.dir);
      this.sprite.play(`${key}_walk`, true);
    } else {
      this.sprite.stop();
      this.sprite.setTexture(`${key}_0`);
      if (this.facesLeft) this.sprite.setFlipX(false); // 정면 이미지는 뒤집지 않음
    }
  }

  /** 발판/사다리가 바뀌었을 때 (개발자 모드): 내 층이 없어졌으면 다른 층으로 옮기고 범위를 다시 잡는다 */
  onMapChanged() {
    this.climb = null;
    this.jump = null;
    this.leap = null;
    if (this.state === 'climb' || this.state === 'leap') this.state = 'idle';
    let name = this.floorName;
    if (!CONFIG.floors[name] || name === 'stage') {
      const floor = pickGuestFloor();
      name = Object.keys(CONFIG.floors).find((n) => CONFIG.floors[n] === floor);
      const { x1, x2 } = floorSpan(floor);
      this.x = Phaser.Math.Between(x1, x2);
    }
    this.setFloor(name);
    this.x = Phaser.Math.Clamp(this.x, this.minX, this.maxX);
    this.y = floorY(this.floor, this.x);
    this.updatePose();
  }

  /** 다른 발판으로 점프해 건너가기 (포물선으로 착지점까지) */
  startLeap(target) {
    const span = floorSpan(CONFIG.floors[target.name]);
    if (target.x < span.x1 || target.x > span.x2) {
      target = { ...target, x: Phaser.Math.Clamp(target.x, span.x1, span.x2) };
      target.y = floorY(CONFIG.floors[target.name], target.x);
    }
    const dist = Math.hypot(target.x - this.x, target.y - this.y);
    this.jump = null;
    this.state = 'leap';
    this.leap = {
      ...target,
      x0: this.x,
      y0: this.y,
      t: 0,
      duration: Phaser.Math.Clamp(450 + dist * 4, 500, 1000),
      height: CONFIG.motion.jumpHeight + Math.max(0, this.y - target.y) * 0.6, // 위로 갈수록 높이 뜀
    };
    this.dir = Math.sign(target.x - this.x) || this.dir;
    this.hideBubble();
    this.updatePose();
  }

  startJump() {
    this.jump = { t: 0, duration: CONFIG.motion.jumpDuration };
    this.updatePose();
  }

  /** x 위치의 사다리/로프를 타고 반대편 층으로 */
  startClimb(climb) {
    const { top, bottom } = climbEnds(climb);
    // 매달린 사다리/로프는 위 발판에서만 탈 수 있다 (아래 끝이 허공)
    if (!bottom.name && this.floorName !== top.name) return;
    const target = this.floorName === top.name ? bottom : top;
    if (!target.name) target.y += CONFIG.motion.control.grabHeight; // 매달린 끝: 손이 끝에 걸릴 때까지
    this.jump = null;
    this.state = 'climb';
    this.climb = { ref: climb, type: climb.type, targetName: target.name, toY: target.y, dir: Math.sign(target.y - this.y) };
    this.x = climb.x;
    this.hideBubble();
    this.updatePose();
  }

  finishClimb() {
    if (!this.climb.targetName) {
      // 매달린 사다리/로프 아래 끝: 아래 가까이 발판이 있으면 뛰어내리고, 없으면 다시 올라간다
      const below = this.floorBelow(this.x, this.y);
      const by = below && floorY(CONFIG.floors[below], this.x);
      if (below && by - this.y <= CONFIG.motion.gapJump.maxDown * 1.5) {
        this.climb = null;
        this.state = 'walk';
        return this.startLeap({ name: below, x: this.x + this.dir * 10, y: floorY(CONFIG.floors[below], this.x + this.dir * 10) });
      }
      const { top } = climbEnds(this.climb.ref);
      Object.assign(this.climb, { targetName: top.name, toY: top.y, dir: -1 });
      return;
    }
    this.setFloor(this.climb.targetName);
    this.y = this.climb.toY;
    this.climb = null;
    this.climbReadyAt = this.scene.time.now + CONFIG.motion.climbCooldown;
    this.state = 'walk';
    this.stateTimer = Phaser.Math.Between(1500, 3500);
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.updatePose();
  }

  // ---------- 개발자 모드: 직접 조종 ----------
  // phys.mode: ground(발판 위) | air(점프/낙하, 중력) | climb(사다리/로프)
  // 공중에서는 내려오는 중에만 발판에 착지(아래에서 위로는 통과) — 메이플 방식

  setControlled(on) {
    this.controlled = on;
    const aiClimb = this.state === 'climb' ? this.climb : null;
    const aiAirborne = this.state === 'leap' || Boolean(this.jump);
    this.climb = null;
    this.jump = null;
    this.leap = null;
    if (on) {
      this.phys = { mode: 'ground', vx: 0, vy: 0, climb: null };
      if (aiClimb) {
        // 사다리/로프를 타던 중이면 그 자리에 매달린 채로 시작
        const { top, bottom } = climbEnds(aiClimb.ref);
        if (!bottom.name) bottom.y += CONFIG.motion.control.grabHeight;
        this.phys = { mode: 'climb', vx: 0, vy: 0, climb: { type: aiClimb.type, x: this.x, top, bottom } };
      } else if (aiAirborne) {
        this.phys.mode = 'air'; // 점프 중이었으면 그 자리에서 떨어져 착지
      }
      this.state = 'idle';
      this.poseKey = null;
      this.hideBubble();
      this.marker = this.scene.add
        .text(0, 0, '▼', { fontSize: '18px', color: '#ffd400', stroke: '#6b4e00', strokeThickness: 3, resolution: TEXT_RESOLUTION })
        .setOrigin(0.5, 1);
      this.add(this.marker);
      this.placeMarker();
      return;
    }
    this.marker?.destroy();
    this.marker = null;
    this.sprite.anims.resume();
    // 공중/사다리에서 놓으면 지금 위치 아래의 가장 가까운 발판으로
    if (this.phys?.mode !== 'ground') {
      const below = this.floorBelow(this.x, this.y - 40);
      if (below) this.floorName = below;
    }
    this.phys = null;
    this.state = 'idle';
    this.stateTimer = 0;
    this.onMapChanged();
  }

  placeMarker() {
    if (this.marker) this.marker.setY(-this.sprite.displayHeight - 4);
  }

  /** (x, y) 아래(또는 같은 높이)에 있는 가장 가까운 발판 이름 (stage 제외) */
  floorBelow(x, y) {
    let best = null;
    let bestY = Infinity;
    for (const [name, f] of Object.entries(CONFIG.floors)) {
      if (name === 'stage') continue;
      const { x1, x2 } = floorSpan(f);
      if (x < x1 || x > x2) continue;
      const fy = floorY(f, x);
      if (fy >= y && fy < bestY) {
        best = name;
        bestY = fy;
      }
    }
    return best;
  }

  /**
   * 잡을 수 있는 사다리/로프. 발판 위(onFloor)면 ↑는 아래쪽 끝 발판에서, ↓는 위쪽 끝 발판에서만.
   * 공중이면 사다리 x 가까이 + 사다리 높이 범위 안이면 잡는다.
   */
  findClimb(vert, onFloor) {
    const { grabRange: range, grabHeight } = CONFIG.motion.control;
    for (const c of CONFIG.climbs) {
      if (Math.abs(c.x - this.x) > range || !c.floors.every((n) => CONFIG.floors[n])) continue;
      const { top, bottom } = climbEnds(c);
      // 발이 내려갈 수 있는 한계: 발판이면 그 발판, 매달린 끝이면 손(발 위 grabHeight)이 끝에 걸릴 때까지
      const bottomLimit = bottom.name ? bottom.y : bottom.y + grabHeight;
      const grab = (y) => ({ type: c.type, x: c.x, top, bottom: { ...bottom, y: bottomLimit }, y });
      if (onFloor) {
        if (vert < 0 && bottom.name && onFloor === bottom.name) return grab(bottom.y - 1);
        if (vert > 0 && onFloor === top.name) return grab(top.y + 1);
      } else {
        // 공중: 손 높이(발 - grabHeight)가 사다리/로프 범위 안이면 잡는다
        const handY = this.y - grabHeight;
        if (handY > top.y - 6 && handY < bottom.y + 6) return grab(Phaser.Math.Clamp(this.y, top.y + 1, bottomLimit - 1));
      }
    }
    return null;
  }

  /** 지금 서 있는 발판 아래에 다른 발판이 있는지 (엎드려 뛰어내리기 가능 여부) */
  hasFloorBelow() {
    return Object.entries(CONFIG.floors).some(([name, f]) => {
      if (name === 'stage' || name === this.floorName) return false;
      const { x1, x2 } = floorSpan(f);
      return this.x >= x1 && this.x <= x2 && floorY(f, this.x) > this.y + 2;
    });
  }

  landOn(name, y) {
    this.setFloor(name);
    // 사다리 끝이 발판 끝보다 살짝 밖에 있어도 발판 안쪽에 내려선다 (안 그러면 바로 떨어져서 다시 매달림)
    const { x1, x2 } = floorSpan(this.floor);
    if (this.x < x1 || this.x > x2) {
      this.x = Phaser.Math.Clamp(this.x, x1, x2);
      y = floorY(this.floor, this.x);
    }
    this.y = y;
    Object.assign(this.phys, { mode: 'ground', vx: 0, vy: 0, climb: null, prone: false, dropFrom: null });
  }

  /** 조종 중 포즈 (바뀔 때만 애니메이션 교체) */
  setControlPose(key, apply) {
    if (this.poseKey === key) return;
    this.poseKey = key;
    this.sprite.anims.resume();
    apply();
    this.placeMarker();
  }

  tickControlled(delta, input) {
    const c = CONFIG.motion.control;
    const dt = Math.min(delta, 50) / 1000;
    const p = this.phys;
    const h = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const v = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    const jump = input.consumeJump();
    const key = this.texKey;

    if (p.mode === 'climb') {
      const cl = p.climb;
      if (jump && h) {
        // 사다리에서 옆으로 점프해서 내리기
        Object.assign(p, { mode: 'air', vx: h * c.walkSpeed, vy: -c.jumpVelocity * 0.6, climb: null });
        p.noGrabUntil = this.scene.time.now + 400; // 방금 놓은 사다리를 바로 다시 잡지 않게
        this.dir = h;
      } else {
        this.y += v * c.climbSpeed * dt;
        if (this.y <= cl.top.y) this.landOn(cl.top.name, cl.top.y);
        else if (this.y >= cl.bottom.y) {
          if (cl.bottom.name) this.landOn(cl.bottom.name, cl.bottom.y);
          else {
            Object.assign(p, { mode: 'air', vx: 0, vy: 0, climb: null }); // 매달린 끝에서 ↓ → 손 놓고 떨어짐
            p.noGrabUntil = this.scene.time.now + 400;
          }
        }
      }
    } else if (p.mode === 'ground') {
      const grab = v ? this.findClimb(v, this.floorName) : null;
      if (grab) {
        Object.assign(p, { mode: 'climb', climb: grab, vx: 0, vy: 0 });
        this.x = grab.x;
        this.y = grab.y;
      } else if (p.prone) {
        // 엎드린 상태: ↓를 떼거나 ←→면 일어서고, 점프면 발판 아래로 떨어진다 (아래에 발판이 있을 때만)
        if (jump && this.hasFloorBelow()) {
          Object.assign(p, { mode: 'air', vx: 0, vy: 0, prone: false, dropFrom: this.floorName });
        } else if (h || v <= 0) {
          p.prone = false;
        }
      } else if (v > 0) {
        p.prone = true; // ↓ + 잡을 사다리/로프 없음 → 엎드리기
      } else if (jump) {
        Object.assign(p, { mode: 'air', vx: h * c.walkSpeed, vy: -c.jumpVelocity });
      } else {
        this.x += h * c.walkSpeed * dt;
        const { x1, x2 } = floorSpan(this.floor);
        const next = this.x < x1 ? this.nextFloor[-1] : this.x > x2 ? this.nextFloor[1] : undefined;
        if (next) this.continueTo(next); // 이어진 발판으로 걸어서 넘어감
        if (next === null) Object.assign(p, { mode: 'air', vx: h * c.walkSpeed, vy: 0 }); // 발판 끝에서 떨어짐
        else this.y = floorY(this.floor, this.x);
      }
      if (h) this.dir = h;
    }

    if (p.mode === 'air') {
      if (h) {
        p.vx = h * c.walkSpeed; // 공중에서도 방향 조절
        this.dir = h;
      }
      const prevY = this.y;
      p.vy += c.gravity * dt;
      this.x = Phaser.Math.Clamp(this.x + p.vx * dt, 0, CONFIG.width);
      this.y += p.vy * dt;
      const canGrab = v && this.scene.time.now >= (p.noGrabUntil ?? 0);
      const grab = canGrab ? this.findClimb(v, null) : null; // 점프 중 ↑↓ + 사다리/로프 가까이 → 매달리기
      if (grab) {
        Object.assign(p, { mode: 'climb', climb: grab, vx: 0, vy: 0 });
        this.x = grab.x;
        this.y = grab.y;
      } else if (p.vy > 0) {
        // 내려오는 중: 이번 프레임에 지나친 발판 중 가장 위에 착지
        let land = null;
        for (const [name, f] of Object.entries(CONFIG.floors)) {
          if (name === 'stage' || name === p.dropFrom) continue; // 엎드려 뛰어내린 발판은 통과
          const { x1, x2 } = floorSpan(f);
          if (this.x < x1 || this.x > x2) continue;
          const fy = floorY(f, this.x);
          if (fy >= prevY - 0.5 && fy <= this.y && (!land || fy < land.y)) land = { name, y: fy };
        }
        if (land) {
          this.landOn(land.name, land.y);
        } else if (this.y > CONFIG.height + 100) {
          // 맵 밖으로 떨어지면 다른 발판에서 다시 시작
          const floor = pickGuestFloor();
          const name = Object.keys(CONFIG.floors).find((n) => CONFIG.floors[n] === floor);
          const { x1, x2 } = floorSpan(floor);
          this.x = (x1 + x2) / 2;
          this.landOn(name, floorY(floor, this.x));
        }
      }
    }

    // 포즈
    if (p.mode === 'climb') {
      const type = p.climb.type;
      const other = type === 'ladder' ? 'rope' : 'ladder';
      const anim = this.motions[type] ? type : this.motions[other] ? other : null;
      this.setControlPose(`climb-${anim}`, () => {
        this.sprite.setFlipX(false);
        if (anim) this.sprite.play(`${key}_${anim}`);
        else this.sprite.stop().setTexture(`${key}_0`);
      });
      if (anim) {
        if (v) this.sprite.anims.resume();
        else this.sprite.anims.pause(); // 멈춰 있으면 애니메이션도 멈춤
      }
    } else if (p.mode === 'air') {
      this.setControlPose(`air-${this.dir}`, () => {
        this.setDir(this.dir);
        if (this.motions.jump) this.sprite.play({ key: `${key}_jump`, frameRate: 8 });
        else this.sprite.play(`${key}_walk`);
      });
    } else if (p.prone) {
      this.setControlPose(`prone-${this.dir}`, () => {
        this.setDir(this.dir);
        if (this.motions.prone) this.sprite.play(`${key}_prone`);
        else if (this.motions.jump) this.sprite.stop().setTexture(`${key}_jump0`);
        else this.sprite.stop().setTexture(`${key}_0`).setFlipX(false);
      });
    } else if (h) {
      this.setControlPose(`walk-${this.dir}`, () => {
        this.setDir(this.dir);
        this.sprite.play(`${key}_walk`);
      });
    } else {
      this.setControlPose('idle', () => {
        this.sprite.stop();
        this.sprite.setTexture(`${key}_0`);
        this.sprite.setFlipX(false);
      });
    }
    this.setDepth(this.y);
  }


  tick(delta) {
    if (this.controlled) return this.tickControlled(delta, this.scene.dev.input);
    const m = CONFIG.motion;

    if (this.state === 'leap') {
      const L = this.leap;
      L.t += delta;
      const p = Math.min(1, L.t / L.duration);
      const baseY = L.y0 + (L.y - L.y0) * p;
      this.x = L.x0 + (L.x - L.x0) * p;
      this.y = baseY - L.height * 4 * p * (1 - p);
      this.setDepth(baseY);
      if (p >= 1) {
        this.setFloor(L.name);
        this.x = L.x;
        this.y = L.y;
        this.leap = null;
        this.state = 'walk';
        this.stateTimer = Phaser.Math.Between(1200, 3000);
        this.leapReadyAt = this.scene.time.now + 2000;
        this.updatePose();
      }
      return;
    }

    if (this.state === 'climb') {
      const step = (m.climbSpeed * delta) / 1000;
      this.y += this.climb.dir * step;
      this.setDepth(this.y);
      if ((this.climb.dir > 0 && this.y >= this.climb.toY) || (this.climb.dir <= 0 && this.y <= this.climb.toY)) {
        this.finishClimb();
      }
      return;
    }

    this.stateTimer -= delta;
    if (this.stateTimer <= 0 && !this.jump) this.pickState();

    let jumpOffset = 0;
    if (this.jump) {
      this.jump.t += delta;
      const p = this.jump.t / this.jump.duration;
      if (p >= 1) {
        this.jump = null;
        this.updatePose();
      } else {
        jumpOffset = m.jumpHeight * 4 * p * (1 - p); // 포물선
      }
    }

    if (this.state === 'walk') {
      const prevX = this.x;
      this.x += (this.dir * this.speed * delta) / 1000;
      if (this.x <= this.minX || this.x >= this.maxX) {
        const edgeDir = this.x <= this.minX ? -1 : 1;
        this.x = edgeDir < 0 ? this.minX : this.maxX;
        const next = this.nextFloor[edgeDir];
        // 발판 끝: 이어진 발판이면 그대로 걸어가고, 가까운 발판이 있으면 가끔 점프, 아니면 돌아선다
        if (next) {
          this.continueTo(next);
        } else if (!this.jump && this.scene.time.now >= (this.leapReadyAt ?? 0)) {
          const targets = gapJumpTargets(this.floorName, this.x, edgeDir);
          if (targets.length && Math.random() < m.gapJump.chance) {
            return this.startLeap(Phaser.Utils.Array.GetRandom(targets));
          }
        }
        if (!next) this.setDir(-edgeDir);
      }

      if (!this.jump) {
        // 사다리/로프를 지나가면 가끔 탄다
        const crossed = climbsOn(this.floorName).find(
          (c) => Math.min(prevX, this.x) <= c.x && c.x <= Math.max(prevX, this.x)
        );
        if (crossed && this.scene.time.now >= this.climbReadyAt) {
          this.climbReadyAt = this.scene.time.now + 1500; // 같은 사다리를 지나는 동안 한 번만 판정
          if (Math.random() < m.climbChance) return this.startClimb(crossed);
        }
        if (Math.random() < (m.jumpChance * delta) / 1000) this.startJump();
      }
    }

    // 기울어진 구간(계단, 출렁다리)은 x에 맞춰 발 높이를 따라간다. 아래쪽 캐릭터가 앞에 그려지도록 depth도 갱신
    const groundY = floorY(this.floor, this.x);
    this.y = groundY - jumpOffset;
    this.setDepth(groundY);
  }
}

/**
 * 신랑/신부: 평소엔 무대(stage) 제자리에 고정, 살짝 통통 튀는 대기 모션.
 * 개발자 모드 조종 도구로는 하객처럼 직접 움직일 수 있고, 놓으면 제자리로 돌아간다.
 */
class CoupleCharacter extends GuestCharacter {
  constructor(scene, x, y, info, opts) {
    super(scene, CONFIG.floors.stage, info, { ...opts, x, tagColor: '#ffe066' });
    this.home = { x, y };
    this.y = y;
    this.setDepth(y);
    if (info.id === 'bride') this.sprite.setFlipX(true); // 신랑 쪽 바라보기
    this.bob = scene.tweens.add({
      targets: this.sprite,
      y: -2,
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      delay: Phaser.Math.Between(0, 400),
    });
  }

  applySprite(sprite) {
    super.applySprite(sprite);
    if (!this.controlled) this.standAtHome();
  }

  /** 제자리에서 정면을 보고 선다 */
  standAtHome() {
    this.setFloor('stage');
    this.x = this.home.x;
    this.y = this.home.y;
    this.setDepth(this.y);
    this.state = 'idle';
    this.sprite.stop();
    this.sprite.setTexture(`${this.texKey}_0`);
    this.sprite.setFlipX(this.texKey.startsWith('sprite_') ? false : this.info.id === 'bride');
  }

  setControlled(on) {
    if (on) {
      this.bob.pause();
      this.sprite.y = 0;
    }
    super.setControlled(on);
  }

  /** 조종을 놓거나 지도가 바뀌면 제자리로 (하객처럼 다른 발판으로 가지 않음) */
  onMapChanged() {
    this.phys = null;
    this.climb = null;
    this.jump = null;
    this.leap = null;
    this.standAtHome();
    this.bob.resume();
  }

  tick(delta) {
    if (this.controlled) super.tick(delta); // 평소엔 움직이지 않음
  }
}
