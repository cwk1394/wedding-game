(async () => {
  const fetched = await fetchGuests();
  // 로컬에서 파일로 열었거나 아직 배포 전이면 더미 데이터로 표시
  const guests = fetched ?? DUMMY_GUESTS;

  // 캔버스를 화면 전체 × 기기 픽셀 비율로 만들고 CSS로 축소 표시 (고해상도 화면에서도 선명하게)
  const container = document.getElementById('game');
  const viewportSize = () => ({ w: container.clientWidth * DPR, h: container.clientHeight * DPR });
  const { w, h } = viewportSize();

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#f3e6ee',
    scale: { mode: Phaser.Scale.NONE, width: w, height: h, zoom: 1 / DPR },
    input: { activePointers: 3 }, // 마우스 포인터 포함 개수라 3이어야 터치 두 손가락(핀치)이 잡힘
  });
  // 첫 로딩 화면: 배경 1칸 + 캐릭터 1명당 1칸 기준 진행률
  const loading = document.getElementById('loading');
  const bar = loading.querySelector('.loading-bar span');
  const total = 1 + COUPLE.length + new Set(guests.map((g) => g.id)).size + NPCS.length;
  let shown = false;
  const showMain = () => {
    if (shown) return;
    shown = true;
    bar.style.width = '100%';
    loading.classList.add('done');
    setTimeout(() => loading.remove(), 500);
    // 처음 접속: 캐릭터 생성부터 ("이미 생성한 캐릭터가 있어요"면 선택). 개발자 모드는 바로 편집
    if (!new URLSearchParams(location.search).has('dev')) setTimeout(() => UI.openStart(), 500);
  };
  setTimeout(showMain, 20000); // 이미지 서버가 느려도 무한정 기다리지 않게

  game.scene.add('MapScene', MapScene, true, {
    guests,
    live: fetched !== null,
    onProgress: (units) => (bar.style.width = `${Math.min(100, (units / total) * 100)}%`),
    onReady: showMain,
  });
  const scene = () => game.scene.getScene('MapScene');

  window.addEventListener('resize', () => {
    const size = viewportSize();
    game.scale.resize(size.w, size.h);
    game.scale.setZoom(1 / DPR);
  });

  // 브라우저 자체 확대(핀치)가 게임 조작과 겹치지 않게 막기 (iOS Safari)
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // 팝업이 떠 있는 동안은 맵 입력을 끈다.
  // Phaser는 손을 뗄 때(mouseup/touchend)를 window에서도 받아서, 팝업 안을 눌러도 뒤의 캐릭터가 클릭되기 때문.
  UI.onModalChange = (open) => {
    const s = scene();
    if (s?.input) s.input.enabled = !open;
  };

  // 방명록 목록용: 맵 위 하객 (방금 등록한 하객 포함)
  UI.getGuests = () => (scene()?.guests ?? []).map((g) => ({ info: g.info, avatarUrl: () => g.getAvatarUrl() }));

  // 방금 등록한 하객은 배포를 기다리지 않고 바로 맵에 등장시킨다
  // 등록한 캐릭터는 시작점(개발자 모드에서 지정)에 나타나고 바로 조종 모드 + 확대
  UI.onGuestCreated = (info) => {
    const s = scene();
    const guest = s.addGuest(info, { atSpawn: true });
    if (!guest) return;
    s.control.take(guest, { zoom: true });
    guest.say(info.shortMsg);
  };

  // "이미 생성한 캐릭터가 있어요"에서 고른 캐릭터: 시작점으로 옮겨서 바로 조종 모드 + 확대
  UI.onGuestPicked = (info) => {
    const s = scene();
    const guest = s.guests.find((g) => g.info.id === info.id);
    if (!guest) return;
    const spawn = spawnPoint();
    s.control.release();
    if (spawn) guest.dropAt(spawn.floor, spawn.x);
    s.control.take(guest, { zoom: true });
    guest.say(guest.info.shortMsg);
    UI.showToast(
      matchMedia('(pointer: coarse)').matches ? `${guest.info.name}(으)로 시작해요!\n스틱과 점프 버튼으로 움직여 보세요` : `${guest.info.name}(으)로 시작해요!\n방향키와 Space(점프)로 움직여 보세요`,
      3000
    );
  };
})();
