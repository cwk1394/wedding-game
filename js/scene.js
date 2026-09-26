class MapScene extends Phaser.Scene {
  constructor() {
    super('MapScene');
  }

  preload() {
    if (CONFIG.mapImage) this.load.image('map', CONFIG.mapImage);
  }

  create({ guests = [], live = false } = {}) {
    if (this.textures.exists('map')) {
      this.add.image(0, 0, 'map').setOrigin(0).setDisplaySize(CONFIG.width, CONFIG.height);
    } else {
      // 배경 이미지가 없거나 로드 실패 시 임시 맵
      this.drawBackground();
      this.drawPlatforms();
      this.drawWeddingArch();
    }

    this.view = new MapView(this);

    // ?debug 로 열면 발판 위치를 선으로 표시 (배경 이미지에 맞춰 floors 좌표 조정할 때 사용)
    if (new URLSearchParams(location.search).has('debug')) this.drawFloorGuides();

    this.onSelect = (character) =>
      UI.openGuestbook({ ...character.info, avatarUrl: character.getAvatarUrl() });

    // 신랑/신부: 무대 가운데 고정
    const stage = CONFIG.floors.stage;
    const centerX = (stage.x1 + stage.x2) / 2;
    this.couple = COUPLE.map(
      (info, i) =>
        new CoupleCharacter(this, centerX + (i === 0 ? -30 : 30), stage.y, info, { onSelect: this.onSelect })
    );

    this.guests = [];
    this.guestIds = new Set();
    guests.forEach((info) => this.addGuest(info));

    // 새 방명록이 올라오면 주기적으로 반영 (식장 스크린에 켜둘 때용)
    if (live) {
      this.time.addEvent({
        delay: CONFIG.refreshInterval,
        loop: true,
        callback: async () => {
          const latest = await fetchGuests();
          latest?.forEach((info) => this.addGuest(info));
        },
      });
    }
  }

  /** 하객 한 명을 랜덤 층에 스폰. 이미 있는 id면 무시. */
  addGuest(info) {
    if (this.guestIds.has(info.id)) return null;
    this.guestIds.add(info.id);
    const guest = new GuestCharacter(this, pickGuestFloor(), info, { onSelect: this.onSelect });
    this.guests.push(guest);
    return guest;
  }

  update(_time, delta) {
    for (const guest of this.guests) guest.tick(delta);
  }

  // ---------- 임시 맵 그리기 (맵 이미지 준비되면 CONFIG.mapImage로 대체) ----------

  drawFloorGuides() {
    const g = this.add.graphics().setDepth(10000);
    for (const [name, f] of Object.entries(CONFIG.floors)) {
      g.lineStyle(3, name === 'stage' ? 0xffd700 : 0xff0000, 0.9);
      g.lineBetween(f.x1, f.y, f.x2, f.y);
      g.fillStyle(0xff0000, 1).fillCircle(f.x1, f.y, 5).fillCircle(f.x2, f.y, 5);
      this.add
        .text(f.x1, f.y + 4, `${name} y=${f.y}`, { fontSize: '14px', color: '#fff', backgroundColor: '#c00' })
        .setDepth(10000);
    }
  }

  drawBackground() {
    const { width, height } = CONFIG;
    const sky = this.add.graphics();
    sky.fillGradientStyle(0x7ec8ff, 0x7ec8ff, 0xd6f0ff, 0xd6f0ff, 1);
    sky.fillRect(0, 0, width, height);

    // 먼 산
    const hills = this.add.graphics();
    hills.fillStyle(0xa8d8a0, 1);
    hills.fillCircle(150, 720, 320);
    hills.fillCircle(640, 780, 380);
    hills.fillCircle(1150, 720, 330);
    hills.fillStyle(0x8cc98a, 1);
    hills.fillCircle(400, 800, 300);
    hills.fillCircle(950, 820, 320);

    // 흘러가는 구름
    for (let i = 0; i < 6; i++) {
      const cloud = this.add.container(Phaser.Math.Between(0, width), Phaser.Math.Between(40, 220));
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 0.9);
      g.fillEllipse(0, 0, 90, 36);
      g.fillEllipse(-30, 6, 60, 28);
      g.fillEllipse(32, 6, 64, 28);
      g.fillEllipse(8, -12, 56, 34);
      cloud.add(g).setScale(Phaser.Math.FloatBetween(0.7, 1.3));

      const speed = Phaser.Math.Between(8, 20); // px/s
      const drift = () => {
        const distance = width + 200 - cloud.x;
        this.tweens.add({
          targets: cloud,
          x: width + 100,
          duration: (distance / speed) * 1000,
          onComplete: () => {
            cloud.x = -100;
            drift();
          },
        });
      };
      drift();
    }
  }

  drawPlatforms() {
    const g = this.add.graphics();
    for (const [name, f] of Object.entries(CONFIG.floors)) {
      const w = f.x2 - f.x1;
      const thick = name === 'ground' ? CONFIG.height - f.y : 26;
      const radius = name === 'ground' ? 0 : 8;

      g.fillStyle(0x8b5a2b, 1); // 흙
      g.fillRoundedRect(f.x1, f.y, w, thick, radius);
      g.fillStyle(0x6e4420, 1); // 흙 점박이
      for (let x = f.x1 + 14; x < f.x2 - 10; x += 34) {
        g.fillCircle(x, f.y + 16 + ((x / 34) % 2) * 6, 3);
      }
      g.fillStyle(0x5cb85c, 1); // 잔디
      g.fillRoundedRect(f.x1, f.y - 2, w, 10, radius ? 5 : 0);
      g.fillStyle(0x7ed67e, 1);
      g.fillRect(f.x1 + 4, f.y - 2, w - 8, 3);
    }
  }

  drawWeddingArch() {
    const stage = CONFIG.floors.stage;
    const cx = (stage.x1 + stage.x2) / 2;
    const baseY = stage.y;
    const r = 75;
    const g = this.add.graphics().setDepth(stage.y - 1);

    g.lineStyle(8, 0xffffff, 1);
    g.beginPath();
    g.arc(cx, baseY - 40, r, Math.PI, 0);
    g.strokePath();
    g.lineBetween(cx - r, baseY - 40, cx - r, baseY);
    g.lineBetween(cx + r, baseY - 40, cx + r, baseY);

    const colors = [0xff7eb6, 0xffc0da, 0xffffff, 0xffd166];
    for (let a = Math.PI; a <= Math.PI * 2 + 0.01; a += Math.PI / 12) {
      g.fillStyle(Phaser.Utils.Array.GetRandom(colors), 1);
      g.fillCircle(cx + Math.cos(a) * r, baseY - 40 + Math.sin(a) * r, 7);
    }

    // 하트
    const heart = this.add
      .text(cx, baseY - 40 - r - 4, '❤', { fontSize: '26px', color: '#ff4d88', resolution: 2 })
      .setOrigin(0.5)
      .setDepth(stage.y - 1);
    this.tweens.add({ targets: heart, scale: 1.2, duration: 500, yoyo: true, repeat: -1 });
  }
}

/** 하객 층을 길이에 비례한 확률로 고른다 (긴 층에 더 많이, 짧은 층은 덜 붐비게) */
function pickGuestFloor() {
  const floors = CONFIG.guestFloors.map((name) => CONFIG.floors[name]);
  let r = Math.random() * floors.reduce((sum, f) => sum + (f.x2 - f.x1), 0);
  for (const f of floors) {
    r -= f.x2 - f.x1;
    if (r <= 0) return f;
  }
  return floors[floors.length - 1];
}
