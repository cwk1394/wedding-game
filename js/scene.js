class MapScene extends Phaser.Scene {
  constructor() {
    super('MapScene');
  }

  preload() {
    // 진행률 단위: 배경 1칸 + 캐릭터 1명당 1칸. 배경 몫은 로드 진행에 맞춰 0~1로 채운다
    const { onProgress } = this.sys.settings.data ?? {};
    this.load.on('progress', (value) => onProgress?.(value));
    if (CONFIG.mapImage) this.load.image('map', CONFIG.mapImage);
  }

  create({ guests = [], live = false, onProgress, onReady } = {}) {
    if (this.textures.exists('map')) {
      this.add.image(0, 0, 'map').setOrigin(0).setDisplaySize(CONFIG.width, CONFIG.height);
    } else {
      // 배경 이미지가 없거나 로드 실패 시 임시 맵
      this.drawBackground();
      this.drawPlatforms();
      this.drawWeddingArch();
    }

    this.view = new MapView(this);

    // ?dev = 이동 가능 영역 편집기, ?debug = 발판 위치만 선으로 표시
    const params = new URLSearchParams(location.search);
    if (params.has('dev')) this.dev = new DevMode(this);
    else if (params.has('debug')) this.drawFloorGuides();

    this.onSelect = (character) =>
      UI.openGuestbook({ ...character.info, avatarUrl: character.getAvatarUrl() });

    // 신랑/신부: 무대 가운데 고정
    const stage = CONFIG.floors.stage;
    const { x1, x2 } = floorSpan(stage);
    const centerX = (x1 + x2) / 2;
    this.couple = COUPLE.map((info, i) => {
      const x = centerX + (i === 0 ? -30 : 30);
      return new CoupleCharacter(this, x, floorY(stage, x), info, { onSelect: this.onSelect });
    });

    this.guests = [];
    this.guestIds = new Set();
    guests.forEach((info) => this.addGuest(info));

    // 처음 스폰한 캐릭터들의 이미지가 모두 적용되면 로딩 화면을 걷는다
    const initial = [...this.couple, ...this.guests];
    let done = 0;
    const report = () => onProgress?.(1 + done);
    report();
    Promise.all(
      initial.map((c) =>
        c.ready.then(() => {
          done++;
          report();
        })
      )
    ).then(() => onReady?.());

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

  /** 개발자 모드에서 발판/사다리를 바꾸면 하객들을 새 지도에 맞춘다 */
  refreshMap() {
    for (const guest of this.guests) guest.onMapChanged();
  }

  update(_time, delta) {
    this.dev?.update();
    for (const guest of this.guests) guest.tick(delta);
  }

  // ---------- 임시 맵 그리기 (맵 이미지 준비되면 CONFIG.mapImage로 대체) ----------

  drawFloorGuides() {
    const g = this.add.graphics().setDepth(10000);
    for (const [name, f] of Object.entries(CONFIG.floors)) {
      g.lineStyle(3, name === 'stage' ? 0xffd700 : 0xff0000, 0.9);
      g.strokePoints(f.path.map(([x, y]) => ({ x, y })));
      g.fillStyle(0xff0000, 1);
      f.path.forEach(([x, y]) => g.fillCircle(x, y, 4));
      const [x, y] = f.path[0];
      this.add
        .text(x, y + 4, name, { fontSize: '12px', color: '#fff', backgroundColor: '#c00' })
        .setDepth(10000);
    }
    // 사다리(초록) / 로프(파랑)
    for (const c of CONFIG.climbs) {
      const [a, b] = c.floors.map((name) => floorY(CONFIG.floors[name], c.x));
      g.lineStyle(4, c.type === 'ladder' ? 0x00c853 : 0x2979ff, 0.9).lineBetween(c.x, a, c.x, b);
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
    // 발판 꺾은선을 따라 흙 + 잔디 띠를 그린다
    for (const f of Object.values(CONFIG.floors)) {
      const points = f.path.map(([x, y]) => ({ x, y }));
      g.lineStyle(22, 0x8b5a2b, 1).strokePoints(points.map((p) => ({ x: p.x, y: p.y + 11 })));
      g.lineStyle(8, 0x5cb85c, 1).strokePoints(points.map((p) => ({ x: p.x, y: p.y + 2 })));
    }
  }

  drawWeddingArch() {
    const stage = CONFIG.floors.stage;
    const { x1, x2 } = floorSpan(stage);
    const cx = (x1 + x2) / 2;
    const baseY = floorY(stage, cx);
    const r = 75;
    const g = this.add.graphics().setDepth(baseY - 1);

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
      .setDepth(baseY - 1);
    this.tweens.add({ targets: heart, scale: 1.2, duration: 500, yoyo: true, repeat: -1 });
  }
}

/** 하객 층(stage 제외)을 길이에 비례한 확률로 고른다 (긴 층에 더 많이, 짧은 층은 덜 붐비게) */
function pickGuestFloor() {
  const floors = Object.entries(CONFIG.floors)
    .filter(([name]) => name !== 'stage')
    .map(([, f]) => f);
  if (!floors.length) return CONFIG.floors.stage; // 발판을 다 지운 경우 (개발자 모드)
  const length = (f) => floorSpan(f).x2 - floorSpan(f).x1;
  let r = Math.random() * floors.reduce((sum, f) => sum + length(f), 0);
  for (const f of floors) {
    r -= length(f);
    if (r <= 0) return f;
  }
  return floors[floors.length - 1];
}
