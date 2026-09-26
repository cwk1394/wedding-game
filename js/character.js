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

    for (const target of [this.sprite, this.tag]) {
      target.setInteractive({ useHandCursor: true });
      target.on('pointerup', (pointer) => {
        if (scene.view?.dragMoved) return; // 맵을 드래그하다 손을 뗀 경우는 클릭 아님
        if (pointer.event?.target !== scene.game.canvas) return; // 팝업 등 캔버스 밖을 누른 경우
        onSelect?.(this);
      });
    }

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
    this.sprite.input.hitArea.setTo(0, 0, this.sprite.width, this.sprite.height);
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

/** 신랑/신부: 제자리에 고정, 살짝 통통 튀는 대기 모션 */
class CoupleCharacter extends Character {
  constructor(scene, x, y, info, opts) {
    super(scene, x, y, info, { ...opts, tagColor: '#ffe066' });
    if (info.id === 'bride') this.sprite.setFlipX(true); // 신랑 쪽 바라보기
    scene.tweens.add({
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
    this.sprite.setFlipX(false); // 정면 이미지는 뒤집지 않음
  }
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
    const x = Phaser.Math.Between(x1 + margin, x2 - margin);
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
    // 사다리/로프가 층 끝 가까이 있어도 닿을 수 있게 범위를 넓힌다
    const climbXs = climbsOn(name).map((c) => c.x);
    this.minX = Math.min(x1 + margin, ...climbXs);
    this.maxX = Math.max(x2 - margin, ...climbXs);
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
    if (this.jump && this.motions.jump) {
      this.setDir(this.dir);
      this.sprite.play({ key: `${key}_jump`, frameRate: (4 * 1000) / this.jump.duration }, true);
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

  startJump() {
    this.jump = { t: 0, duration: CONFIG.motion.jumpDuration };
    this.updatePose();
  }

  /** x 위치의 사다리/로프를 타고 반대편 층으로 */
  startClimb(climb) {
    const targetName = climb.floors.find((f) => f !== this.floorName);
    const target = CONFIG.floors[targetName];
    const toY = floorY(target, climb.x);
    this.jump = null;
    this.state = 'climb';
    this.climb = { type: climb.type, targetName, toY, dir: Math.sign(toY - this.y) };
    this.x = climb.x;
    this.hideBubble();
    this.updatePose();
  }

  finishClimb() {
    this.setFloor(this.climb.targetName);
    this.y = this.climb.toY;
    this.climb = null;
    this.climbReadyAt = this.scene.time.now + CONFIG.motion.climbCooldown;
    this.state = 'walk';
    this.stateTimer = Phaser.Math.Between(1500, 3500);
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.updatePose();
  }

  tick(delta) {
    const m = CONFIG.motion;

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
      if (this.x <= this.minX) {
        this.x = this.minX;
        this.setDir(1);
      } else if (this.x >= this.maxX) {
        this.x = this.maxX;
        this.setDir(-1);
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
