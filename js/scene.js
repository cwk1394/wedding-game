class MapScene extends Phaser.Scene {
  constructor() {
    super('MapScene');
  }

  preload() {
    // 진행률 단위: 배경 1칸 + 캐릭터 1명당 1칸. 배경 몫은 로드 진행에 맞춰 0~1로 채운다
    const { onProgress } = this.sys.settings.data ?? {};
    this.load.on('progress', (value) => onProgress?.(value));
    if (CONFIG.mapImage) this.load.image('map', CONFIG.mapImage);
    const wg = CONFIG.warpgate;
    if (wg) this.load.spritesheet('warpgate', wg.image, { frameWidth: wg.frameWidth, frameHeight: wg.frameHeight });
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
    this.addPetals();
    this.addWarpgate();

    // ?dev = 이동 가능 영역 편집기, ?debug = 발판 위치만 선으로 표시
    this.control = new Controller(this); // 캐릭터 직접 조종 (방명록 팝업 "조종하기", 등록 직후, 개발자 모드)
    const params = new URLSearchParams(location.search);
    if (params.has('dev')) this.dev = new DevMode(this);
    else if (params.has('debug')) this.drawFloorGuides();

    this.onSelect = (character) => {
      if (this.dev && character instanceof NpcCharacter) return this.dev.openNpcSettings(character); // 개발자 모드: NPC 설정 창
      const isCouple = character instanceof CoupleCharacter;
      // 조종: 하객은 누구나, 신랑·신부는 개발자 모드에서만, NPC는 불가
      const canControl = !character.info.npc && (!isCouple || this.dev);
      // 수정/삭제: 등록된 하객만 (방명록 번호가 있을 때). 개발자 모드에선 신랑·신부 멘트·소개 글 수정
      const canManage = !character.info.npc && !isCouple && character.info.number;
      const coupleEdit = isCouple && this.dev ? { onEdit: () => this.dev.openCoupleSettings(character) } : null;
      UI.openGuestbook(
        { ...character.info, avatarUrl: character.getAvatarUrl() },
        canControl
          ? {
              controlling: this.control.controlled === character,
              onControl: () => this.control.take(character, { zoom: true }),
              // 조종 끝내기 = 기본 모드: 캐릭터는 스스로 돌아다니고 화면은 처음 보기로
              onRelease: () => {
                this.control.release();
                this.view.touched = false;
                this.view.reset();
                if (matchMedia('(pointer: coarse)').matches) UI.showToast('두 손가락으로 확대,\n드래그로 이동할 수 있어요', 3000);
              },
            }
          : null,
        coupleEdit ??
        (canManage
          ? {
              info: character.info,
              onUpdated: (guest) => character.updateInfo(guest),
              onDeleted: () => this.removeGuest(character),
            }
          : null)
      );
    };

    // 신랑/신부: 제자리 고정 (CONFIG.couple, 기본은 무대 가운데)
    this.couple = COUPLE.map((info) => new CoupleCharacter(this, { ...info, ...coupleTexts(info.id) }, { onSelect: this.onSelect }));

    this.guests = [];
    this.guestIds = new Set();
    guests.forEach((info) => this.addGuest(info));

    // NPC (js/npcs.js): 토끼 푸딩, 얼룩말, 고양이 4마리, 강아지 에쏘, 택시
    // 개발자 모드에서 삭제한 기본 NPC(CONFIG.npcs[id].deleted)는 빼고
    this.npcs = NPCS.filter((npc) => !CONFIG.npcs[npc.id]?.deleted).map((npc) => new NpcCharacter(this, npc, { onSelect: this.onSelect }));

    // 처음 스폰한 캐릭터들의 이미지가 모두 적용되면 로딩 화면을 걷는다
    const initial = [...this.couple, ...this.guests, ...this.npcs];
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

  /** 하객 한 명을 스폰 (atSpawn이면 시작점, 아니면 랜덤 층). 이미 있는 id면 무시. */
  addGuest(info, { atSpawn = false } = {}) {
    if (this.guestIds.has(info.id)) return null;
    this.guestIds.add(info.id);
    const spawn = atSpawn ? spawnPoint() : null;
    const floor = spawn ? CONFIG.floors[spawn.floor] : pickGuestFloor();
    const guest = new GuestCharacter(this, floor, info, { onSelect: this.onSelect, x: spawn?.x });
    this.guests.push(guest);
    return guest;
  }

  /** 하객 삭제: 맵에서 지운다 (id는 guestIds에 남겨 재조회 때 다시 생기지 않게) */
  removeGuest(character) {
    if (this.control.controlled === character) this.control.release();
    this.guests = this.guests.filter((g) => g !== character);
    character.destroy();
  }

  /** 맵 전체에 꽃잎이 조금씩 흩날리는 효과 (위에서 천천히 떨어지며 좌우로 흔들림) */
  addPetals() {
    // 꽃잎 텍스처 2종 (진분홍 / 연분홍), 확대해도 선명하게 2배로 그림
    const colors = [[0xff9fb8, 0xffd3de], [0xffc4d4, 0xfff0f4]];
    colors.forEach(([base, light], i) => {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(base, 1).fillEllipse(8, 5, 16, 10);
      g.fillStyle(light, 1).fillEllipse(6, 4, 7, 4);
      g.generateTexture(`petal${i}`, 16, 10);
      g.destroy();
    });
    const c = CONFIG.petals;
    const common = {
      x: { min: -40, max: CONFIG.width + 40 },
      y: -20,
      lifespan: ((CONFIG.height + 60) / c.fallSpeed.min) * 1000, // 가장 느린 꽃잎도 바닥까지
      speedY: c.fallSpeed,
      speedX: c.drift,
      scale: { min: 0.35, max: 0.7 },
      rotate: { start: 0, end: 360 },
      alpha: { start: c.alpha, end: c.alpha * 0.6 },
      frequency: c.frequency * 2, // 두 종류가 반씩
      advance: 60000, // 처음부터 화면 곳곳에 꽃잎이 있게 미리 흘려 둠
    };
    this.petals = ['petal0', 'petal1'].map((key) => {
      const emitter = this.add.particles(0, 0, key, common).setDepth(15000);
      // 좌우로 살랑살랑: 꽃잎마다 다른 주기로 가로 속도를 흔든다
      emitter.addParticleProcessor({
        active: true,
        update: (particle, delta) => {
          particle.sway ??= Math.random() * Math.PI * 2;
          particle.sway += delta * 0.0015;
          particle.x += Math.sin(particle.sway) * 0.25 * (delta / 16);
        },
      });
      return emitter;
    });
  }

  /** 개발자 모드에서 발판/사다리를 바꾸면 하객들을 새 지도에 맞춘다 */
  refreshMap() {
    for (const guest of this.guests) guest.onMapChanged();
    for (const n of this.npcs) n.onMapChanged();
    for (const c of this.couple) if (!c.controlled) c.onMapChanged(); // 자리(CONFIG.couple)가 바뀌었을 수 있음
    this.placeWarpgate();
  }

  /** 시작점(CONFIG.spawn)에 워프게이트 애니메이션 (이미지 로드 실패 시 생략) */
  addWarpgate() {
    const wg = CONFIG.warpgate;
    if (!wg || !this.textures.exists('warpgate')) return;
    this.anims.create({
      key: 'warpgate',
      frames: this.anims.generateFrameNumbers('warpgate', { start: 0, end: wg.frames - 1 }),
      frameRate: wg.fps,
      repeat: -1,
    });
    const scale = wg.height / wg.frameHeight;
    this.warpgate = this.add.sprite(0, 0, 'warpgate').setOrigin(0.5, wg.originY).setScale(scale).play('warpgate');
    this.placeWarpgate();
  }

  /** 시작점이 바뀌면(개발자 모드 편집·되돌리기) 따라 옮기고, 시작점이 없으면 숨김 */
  placeWarpgate() {
    if (!this.warpgate) return;
    const spawn = spawnPoint();
    this.warpgate.setVisible(!!spawn);
    // depth는 발 높이 바로 아래 → 시작점에 선 캐릭터가 게이트 앞에 보임
    if (spawn) this.warpgate.setPosition(spawn.x, spawn.y).setDepth(spawn.y - 1);
  }

  update(_time, delta) {
    this.control.update();
    for (const guest of this.guests) guest.tick(delta);
    for (const c of this.couple) c.tick(delta); // 신랑/신부는 개발자 모드에서 조종할 때만 움직임
    for (const n of this.npcs) n.tick(delta);
  }

  // ---------- 임시 맵 그리기 (맵 이미지 준비되면 CONFIG.mapImage로 대체) ----------

  drawFloorGuides() {
    const g = this.add.graphics().setDepth(10000);
    for (const [name, f] of Object.entries(CONFIG.floors)) {
      g.lineStyle(3, isStage(name) ? 0xffd700 : 0xff0000, 0.9);
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
      const { top, bottom } = climbEnds(c);
      g.lineStyle(4, c.type === 'ladder' ? 0x00c853 : 0x2979ff, 0.9).lineBetween(c.x, top.y, c.x, bottom.y);
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
    const stage = CONFIG.floors[mainStageName()];
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

/** 하객 층을 길이에 비례한 확률로 고른다 (긴 층에 더 많이, 짧은 층은 덜 붐비게) */
function pickGuestFloor() {
  const floors = Object.values(CONFIG.floors);
  const length = (f) => floorSpan(f).x2 - floorSpan(f).x1;
  let r = Math.random() * floors.reduce((sum, f) => sum + length(f), 0);
  for (const f of floors) {
    r -= length(f);
    if (r <= 0) return f;
  }
  return floors[floors.length - 1];
}
