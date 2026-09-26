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
      target.on('pointerup', () => {
        if (scene.view?.dragMoved) return; // 맵을 드래그하다 손을 뗀 경우는 클릭 아님
        onSelect?.(this);
      });
    }

    this.facesLeft = false; // 원본 이미지가 왼쪽을 바라보는지 (걷기 방향 뒤집기용)
    this.setDepth(y);
    this.scheduleBubble(Phaser.Math.Between(500, CONFIG.bubble.maxGap));

    // 이미지 스프라이트가 있으면 로드되는 동안은 임시 캐릭터를 보여주고, 로드되면 교체
    if (info.spriteUrl) {
      loadSpriteTextures(scene, info)
        .then((sprite) => this.active && this.applySprite(sprite))
        .catch((err) => console.warn(`${info.name} 스프라이트 로드 실패:`, err));
    }
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

/** 하객: 자기 층 범위 안에서 랜덤하게 걷다 멈췄다 한다 */
class GuestCharacter extends Character {
  constructor(scene, floor, info, opts) {
    const margin = CHAR_W / 2;
    const x = Phaser.Math.Between(floor.x1 + margin, floor.x2 - margin);
    super(scene, x, floor.y, info, opts);

    this.minX = floor.x1 + margin;
    this.maxX = floor.x2 - margin;
    this.speed = Phaser.Math.Between(CONFIG.walkSpeed.min, CONFIG.walkSpeed.max);
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.walking = false;
    this.stateTimer = 0;
  }

  setDir(dir) {
    this.dir = dir;
    this.sprite.setFlipX(this.facesLeft ? dir > 0 : dir < 0);
  }

  applySprite(sprite) {
    super.applySprite(sprite);
    this.updatePose();
  }

  pickState() {
    this.walking = Math.random() < 0.65;
    this.stateTimer = Phaser.Math.Between(1200, 4000);
    if (this.walking && Math.random() < 0.5) this.dir = -this.dir;
    this.updatePose();
  }

  updatePose() {
    if (this.walking) {
      this.setDir(this.dir);
      this.sprite.play(`${this.texKey}_walk`, true);
    } else {
      this.sprite.stop();
      this.sprite.setTexture(`${this.texKey}_0`);
      if (this.facesLeft) this.sprite.setFlipX(false); // 정면 이미지는 뒤집지 않음
    }
  }

  tick(delta) {
    this.stateTimer -= delta;
    if (this.stateTimer <= 0) this.pickState();
    if (!this.walking) return;

    this.x += (this.dir * this.speed * delta) / 1000;
    if (this.x <= this.minX) {
      this.x = this.minX;
      this.setDir(1);
    } else if (this.x >= this.maxX) {
      this.x = this.maxX;
      this.setDir(-1);
    }
  }
}
