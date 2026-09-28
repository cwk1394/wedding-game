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
    // 처음 접속: 로비(내 캐릭터로 접속 / 캐릭터 만들기). 개발자 모드는 바로 편집
    // 로딩 화면이 걷히기 전에 열어 두어 맵이 먼저 보이지 않게
    if (!new URLSearchParams(location.search).has('dev')) UI.openLobby();
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

  // ---------- 내 캐릭터 · 모드 ----------
  // 내 캐릭터 = 처음 화면에서 만들거나 고른 캐릭터. 메뉴 "모드 전환"으로
  //   플레이 모드(내 캐릭터를 직접 조종, 화면이 따라감) ↔ 관람 모드(캐릭터는 알아서 돌아다니고 맵을 자유롭게 구경)
  let mine = null;
  const touch = () => matchMedia('(pointer: coarse)').matches;

  function play() {
    scene().control.take(mine, { zoom: true });
    UI.setMode(true);
  }

  function watch() {
    const s = scene();
    s.control.release();
    s.view.touched = false;
    s.view.reset();
    UI.setMode(false);
  }

  UI.onToggleMode = () => {
    if (!mine?.active) return UI.showToast('먼저 캐릭터를 만들거나 골라 주세요');
    if (scene().control.controlled === mine) {
      watch();
      UI.showToast(touch() ? '관람 모드: 두 손가락으로 확대,\n드래그로 맵을 둘러보세요' : '관람 모드: 휠로 확대,\n드래그로 맵을 둘러보세요', 3000);
    } else {
      play();
      UI.showToast(`플레이 모드: ${mine.info.name} 조종 중`, 2000);
    }
  };

  // 캐릭터 수정: 등록할 때 정한 비밀번호 확인 → 수정 폼 (삭제하면 처음 화면으로)
  UI.onEditMine = () => {
    if (!mine?.active) return UI.showToast('먼저 캐릭터를 만들거나 골라 주세요');
    if (!mine.info.number) return UI.showToast('이 캐릭터는 수정할 수 없어요');
    UI.openEdit({
      info: mine.info,
      onUpdated: (guest) => mine.updateInfo(guest),
      onDeleted: () => {
        scene().removeGuest(mine);
        mine = null;
        UI.forgetMyGuest();
        UI.setMode(false);
        UI.openLobby();
      },
    });
  };

  // 메뉴 "로비로 돌아가기": 조종을 놓고 로비로 (내 캐릭터는 맵에 남아 알아서 돌아다님)
  UI.onLobby = () => {
    watch();
    UI.openLobby();
  };

  // 방금 등록한 하객은 배포를 기다리지 않고 바로 맵에 등장시킨다
  // 등록한 캐릭터는 시작점(개발자 모드에서 지정)에 나타나고 바로 플레이 모드 + 확대
  UI.onGuestCreated = (info) => {
    const s = scene();
    const guest = s.addGuest(info, { atSpawn: true });
    if (!guest) return;
    mine = guest;
    play();
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
    mine = guest;
    play();
    guest.say(guest.info.shortMsg);
    UI.showToast(
      touch() ? `${guest.info.name}(으)로 시작해요!\n스틱과 점프 버튼으로 움직여 보세요` : `${guest.info.name}(으)로 시작해요!\n방향키와 Space(점프)로 움직여 보세요`,
      3000
    );
  };
})();
