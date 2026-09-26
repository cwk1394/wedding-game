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
        padding: { x: 5, y: 2 },
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0.5, 0);
    this.tagBg = scene.add.graphics(); // 이름표 배경 (모서리 살짝 둥글게)
    this.drawTagBg();
    this.add([this.sprite, this.tagBg, this.tag]);

    // 누르는 영역: 발(원점) 기준 고정 사각형 + 네임태그.
    // 스프라이트 자체에 걸면 걷기·사다리 프레임마다 크기가 달라 가장자리를 눌러도 안 잡히는 경우가 생긴다.
    this.setInteractive(new Phaser.Geom.Rectangle(0, 0, 1, 1), Phaser.Geom.Rectangle.Contains);
    this.input.cursor = 'pointer';
    this.updateHitArea(CHAR_W, CHAR_H);
    this.on('pointerup', (pointer) => {
      if (scene.view?.dragMoved) return; // 맵을 드래그하다 손을 뗀 경우는 클릭 아님
      if (scene.dev?.editing) return; // 개발자 모드 편집 중
      if (pointer.event?.target !== scene.game.canvas) return; // 팝업 등 캔버스 밖을 누른 경우
      if (scene.dev?.tool === 'spawn') return; // 개발자 모드 시작점 도구는 DevMode가 처리
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

  drawTagBg() {
    const { width: w, height: h } = this.tag;
    this.tagBg.clear().fillStyle(0x000000, 0.6).fillRoundedRect(-w / 2, 4, w, h, 3);
  }

  /** 방명록을 수정했을 때: 이름표·말풍선 문구 갱신 */
  updateInfo(info) {
    Object.assign(this.info, info);
    this.tag.setText(this.info.name);
    this.drawTagBg();
    this.updateHitArea(this.sprite.displayWidth || CHAR_W, this.sprite.displayHeight || CHAR_H);
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
        color: CONFIG.bubble.style.text,
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0.5);

    const w = text.width + 18;
    const h = text.height + 10;
    const cy = -this.sprite.displayHeight - 14 - h / 2; // 말풍선 중심 y
    const bottom = cy + h / 2;
    text.setY(cy);

    // 메이플스토리풍 말풍선: 아주 옅은 하늘색 바탕 + 얇고 연한 테두리 + 위쪽 광택·아래쪽 음영·옅은 그림자로 입체감
    const B = CONFIG.bubble.style;
    const top = cy - h / 2;
    const left = -w / 2;
    const r = 7;
    const g = this.scene.add.graphics();
    const tail = (dy = 0) => g.fillTriangle(-6, bottom - 1 + dy, 6, bottom - 1 + dy, 0, bottom + 8 + dy);
    // 그림자 (아래로 살짝)
    g.fillStyle(B.shadow, 0.22);
    g.fillRoundedRect(left, top + 2, w, h, r);
    tail(2);
    // 바탕
    g.fillStyle(B.fill, 1);
    g.fillRoundedRect(left, top, w, h, r);
    tail();
    // 얇고 연한 테두리
    g.lineStyle(B.lineWidth, B.line, 1);
    g.strokeRoundedRect(left, top, w, h, r);
    g.beginPath();
    g.moveTo(-6, bottom);
    g.lineTo(0, bottom + 8);
    g.lineTo(6, bottom);
    g.strokePath();
    // 꼬리와 몸통 이음새의 테두리 가리기
    g.fillStyle(B.fill, 1);
    g.fillRect(-5, bottom - 2.5, 10, 3);
    // 아래쪽 안쪽 음영 (테두리 쪽이 살짝 도톰해 보이게)
    g.fillStyle(B.shade, 0.55);
    g.fillRoundedRect(left + 1.5, top + h - 5, w - 3, 3.5, { tl: 0, tr: 0, bl: r - 2, br: r - 2 });
    // 위쪽 광택
    g.fillStyle(0xffffff, 0.85);
    g.fillRoundedRect(left + 2, top + 1.5, w - 4, Math.max(4, h * 0.42), { tl: r - 2, tr: r - 2, bl: 3, br: 3 });

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
    const climbXs = this.info?.npc ? [] : climbsOn(name).map((c) => c.x); // NPC는 사다리/로프를 안 탄다
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
    if (this.controlled) {
      this.poseKey = null; // 다음 프레임에 조종 포즈를 새 이미지로 다시 적용
      this.placeMarker();
    } else {
      this.updatePose();
    }
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

  /** 개발자 모드에서 끌어다 놓기: name 발판의 x 위치에 바로 선다 (조종 중이면 조종은 그대로) */
  dropAt(name, x) {
    this.held = false;
    this.climb = null;
    this.jump = null;
    this.leap = null;
    this.setFloor(name);
    const { x1, x2 } = floorSpan(this.floor);
    this.x = this.controlled ? Phaser.Math.Clamp(x, x1, x2) : Phaser.Math.Clamp(x, this.minX, this.maxX);
    const y = floorY(this.floor, this.x);
    if (this.controlled) {
      this.landOn(name, y);
      this.poseKey = null;
    } else {
      this.y = y;
      this.state = 'idle';
      this.stateTimer = Phaser.Math.Between(800, 2000);
      this.updatePose();
    }
    this.setDepth(this.y);
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
    if (this.held) return; // 개발자 모드에서 끌고 있는 중
    if (this.controlled) return this.tickControlled(delta, this.scene.control.input);
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
        } else if (this.canJump !== false && !this.jump && this.scene.time.now >= (this.leapReadyAt ?? 0)) {
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
        if (crossed && this.canClimb !== false && this.scene.time.now >= this.climbReadyAt) {
          this.climbReadyAt = this.scene.time.now + 1500; // 같은 사다리를 지나는 동안 한 번만 판정
          if (Math.random() < m.climbChance) return this.startClimb(crossed);
        }
        if (this.canJump !== false && Math.random() < (m.jumpChance * delta) / 1000) this.startJump();
      }
    }

    // 기울어진 구간(계단, 출렁다리)은 x에 맞춰 발 높이를 따라간다. 아래쪽 캐릭터가 앞에 그려지도록 depth도 갱신
    const groundY = floorY(this.floor, this.x);
    this.y = groundY - jumpOffset;
    this.setDepth(groundY);
  }
}

/**
 * 신랑/신부: 평소엔 제자리(couplePoint, 기본은 무대 가운데)에 고정, 살짝 통통 튀는 대기 모션.
 * 개발자 모드에서는 팝업의 "조종하기"로 하객처럼 직접 움직일 수 있고, 놓으면 제자리로 돌아간다.
 */
class CoupleCharacter extends GuestCharacter {
  constructor(scene, info, opts) {
    const home = couplePoint(info.id);
    super(scene, CONFIG.floors[home.floor], info, { ...opts, x: home.x, tagColor: '#ffe066' });
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
    const home = couplePoint(this.info.id);
    this.setFloor(home.floor);
    this.x = home.x;
    this.y = home.y;
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

// ---------- NPC ----------

/** js/npcs.js 설정 → 캐릭터 info */
function npcInfo(npc) {
  const dir = `img/npc/${npc.id}`;
  const info = {
    id: `npc-${npc.id}`,
    name: npc.name,
    npc: true,
    shortMsg: npc.popup?.shortMsg ?? '',
    longMsg: npc.popup?.longMsg ?? '',
    spriteUrl: `${dir}/front.webp`,
    walkUrl: npc.motions.includes('walk') ? `${dir}/walk.webp` : null,
    extraMotions: npc.motions.filter((m) => m !== 'walk'),
    height: npc.height,
    motionFrames: npc.motionFrames,
    motionHeight: npc.motionHeight,
  };
  for (const m of info.extraMotions) info[`${m}Url`] = `${dir}/${m}.webp`;
  return info;
}

/**
 * NPC: 자기 발판(이어진 발판 포함) 위만 돌아다니고 점프·사다리·로프는 안 쓴다. 조종 불가.
 * 서기(idle)/걷기(walk)/자기(sleep) 애니메이션을 쓰고, 효과(꽃가루·비눗방울·음표)를 낼 수 있다.
 */
class NpcCharacter extends GuestCharacter {
  constructor(scene, npc, opts) {
    const floor = CONFIG.floors[npc.floor] ?? pickGuestFloor();
    super(scene, floor, npcInfo(npc), { ...opts, x: npc.x, tagColor: '#c9f2ff' });
    this.npc = npc;
    this.canClimb = false;
    this.canJump = false;
    this.pose = 'idle'; // 현재 동작 (idle | walk | sleep | scratch …)
    if (npc.speed) this.speed = Phaser.Math.Between(...npc.speed);
    this.setFloor(this.floorName); // range 적용
    this.x = Phaser.Math.Clamp(this.x, this.minX, this.maxX);
    this.y = floorY(this.floor, this.x);
    this.effect = npc.effect ? new NpcEffect(scene, this, npc.effect) : null;
    if (npc.tilt) this.alignToFloor();
  }

  /** npc.tilt면 발판 기울기에 맞춰 살짝 기울인다 (옆모습 이미지용. 3/4 입체 이미지는 똑바로 두는 게 자연스럽다) */
  alignToFloor() {
    const slope = (floorY(this.floor, this.x + 8) - floorY(this.floor, this.x - 8)) / 16;
    this.sprite.setRotation(Math.atan(slope));
  }

  setFloor(name) {
    super.setFloor(name);
    const range = this.npc?.range;
    if (range) {
      // 신랑·신부 주변에서만 (둘 사이 가운데 기준)
      const cx = (couplePoint('groom').x + couplePoint('bride').x) / 2;
      this.minX = Math.max(this.minX, cx - range);
      this.maxX = Math.min(this.maxX, cx + range);
    }
  }

  pickState() {
    const st = this.npc.states;
    if (!st) return super.pickState();
    // walk / 특수 동작(sleep, scratch …) / 나머지는 idle
    let r = Math.random();
    this.pose = 'idle';
    for (const [name, p] of Object.entries(st)) {
      if (typeof p !== 'number' || name === 'idle') continue;
      if (r < p) {
        this.pose = name;
        break;
      }
      r -= p;
    }
    this.state = this.pose === 'walk' ? 'walk' : 'idle';
    this.stateTimer = Phaser.Math.Between(...(st[`${this.pose}Time`] ?? st.idleTime));
    if (this.pose === 'walk' && Math.random() < 0.5) this.dir = -this.dir;
    this.updatePose();
  }

  updatePose() {
    const key = this.texKey;
    const has = (m) => this.motions[m];
    const pose = this.state === 'walk' ? 'walk' : this.pose ?? 'idle';
    const anim = has(pose) ? pose : this.state === 'walk' ? 'walk' : 'idle';
    if (has(anim)) {
      this.setDir(this.dir);
      this.sprite.play(`${key}_${anim}`, true);
    } else {
      this.sprite.stop();
      this.sprite.setTexture(`${key}_0`);
      this.sprite.setFlipX(false);
    }
  }

  dropAt(name, x) {
    this.pose = 'idle'; // 자던 중이었어도 내려놓으면 깨어남
    super.dropAt(name, x);
    if (this.npc.tilt) this.alignToFloor();
  }

  onMapChanged() {
    if (this.npc?.fixed) {
      // 고정 NPC(택시)는 발판이 남아 있으면 그 자리 그대로
      if (CONFIG.floors[this.floorName]) {
        this.y = floorY(this.floor, this.x);
        if (this.npc.tilt) this.alignToFloor();
      }
      return;
    }
    super.onMapChanged();
  }

  tick(delta) {
    if (!this.npc?.fixed) super.tick(delta);
    this.effect?.update();
  }
}

/** NPC 효과: petals = 늘 꽃가루를 뿌림, bubbles = 서 있으면 비눗방울 / 걸으면 나팔 음표 */
class NpcEffect {
  constructor(scene, npc, type) {
    this.npc = npc;
    this.type = type;
    NpcEffect.ensureTextures(scene);
    const fade = { alpha: { start: 0.95, end: 0 } };
    if (type === 'petals') {
      this.emitters = {
        petals: scene.add.particles(0, 0, 'petal0', {
          speedX: { min: -40, max: 40 },
          speedY: { min: -75, max: -30 },
          gravityY: 80,
          lifespan: 1500,
          scale: { min: 0.35, max: 0.55 },
          rotate: { start: 0, end: 360 },
          tint: [0xffffff, 0xffe3ec, 0xfff4c8],
          frequency: 160,
          ...fade,
        }),
      };
    } else {
      // 비눗방울은 바라보는 쪽으로 날아가야 해서 방향별로 하나씩
      const bubble = (sign) =>
        scene.add.particles(0, 0, 'fx-bubble', {
          speedX: sign > 0 ? { min: 25, max: 55 } : { min: -55, max: -25 },
          speedY: { min: -30, max: -8 },
          gravityY: -10,
          lifespan: 2600,
          scale: { min: 0.35, max: 0.9 },
          frequency: 260,
          ...fade,
          emitting: false,
        });
      this.emitters = {
        bubbleL: bubble(-1),
        bubbleR: bubble(1),
        notes: scene.add.particles(0, 0, 'fx-note', {
          speedX: { min: -12, max: 12 },
          speedY: { min: -45, max: -25 },
          lifespan: 1400,
          scale: { min: 0.45, max: 0.7 },
          tint: [0xff7aa8, 0x7ab8ff, 0xffc93c],
          frequency: 380,
          ...fade,
          emitting: false,
        }),
      };
    }
  }

  static ensureTextures(scene) {
    if (!scene.textures.exists('fx-bubble')) {
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xcfefff, 0.35).fillCircle(12, 12, 10);
      g.lineStyle(2, 0xffffff, 0.95).strokeCircle(12, 12, 10);
      g.fillStyle(0xffffff, 0.95).fillCircle(8, 8, 2.5);
      g.generateTexture('fx-bubble', 24, 24);
      g.destroy();
    }
    if (!scene.textures.exists('fx-note')) {
      const tex = scene.textures.createCanvas('fx-note', 28, 32);
      const ctx = tex.getContext();
      ctx.font = 'bold 26px sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(80, 40, 60, .55)';
      ctx.fillStyle = '#ffffff';
      ctx.strokeText('♪', 4, 26);
      ctx.fillText('♪', 4, 26);
      tex.refresh();
    }
  }

  /** 매 프레임: 입/손 위치로 따라가고, 상태에 맞는 효과만 켠다 */
  update() {
    const npc = this.npc;
    const h = npc.sprite.displayHeight;
    const facing = npc.dir; // 이미지가 왼쪽을 보고, setDir로 뒤집으므로 dir = 바라보는 쪽
    const x = npc.x + facing * npc.sprite.displayWidth * 0.3;
    const y = npc.y - h * 0.6;
    const set = (e, on) => {
      e.setPosition(x, y).setDepth(npc.depth + 1);
      if (on && !e.emitting) e.start();
      else if (!on && e.emitting) e.stop();
    };
    const visible = npc.visible;
    if (this.type === 'petals') {
      set(this.emitters.petals, visible);
    } else {
      const walking = npc.state === 'walk';
      set(this.emitters.bubbleL, visible && !walking && facing < 0);
      set(this.emitters.bubbleR, visible && !walking && facing > 0);
      set(this.emitters.notes, visible && walking);
    }
  }
}
