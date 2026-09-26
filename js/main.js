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
  game.scene.add('MapScene', MapScene, true, { guests, live: fetched !== null });
  const scene = () => game.scene.getScene('MapScene');

  window.addEventListener('resize', () => {
    const size = viewportSize();
    game.scale.resize(size.w, size.h);
    game.scale.setZoom(1 / DPR);
  });

  // 확대/축소 버튼
  document.querySelector('.zoom-controls').addEventListener('click', (e) => {
    const action = e.target.closest('[data-zoom]')?.dataset.zoom;
    const view = scene()?.view;
    if (!view) return;
    if (action === 'in') view.zoomBy(1.4);
    if (action === 'out') view.zoomBy(1 / 1.4);
    if (action === 'reset') {
      view.touched = false;
      view.reset();
    }
  });

  // 브라우저 자체 확대(핀치)가 게임 조작과 겹치지 않게 막기 (iOS Safari)
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // 터치 기기에서 처음 한 번 조작 방법 안내
  if (matchMedia('(pointer: coarse)').matches) {
    setTimeout(() => UI.showToast('두 손가락으로 확대, 드래그로 이동할 수 있어요', 3500), 1200);
  }

  // 팝업이 떠 있는 동안은 맵 입력을 끈다.
  // Phaser는 손을 뗄 때(mouseup/touchend)를 window에서도 받아서, 팝업 안을 눌러도 뒤의 캐릭터가 클릭되기 때문.
  UI.onModalChange = (open) => {
    const s = scene();
    if (s?.input) s.input.enabled = !open;
  };

  // 방금 등록한 하객은 배포를 기다리지 않고 바로 맵에 등장시킨다
  UI.onGuestCreated = (info) => {
    const guest = scene().addGuest(info);
    guest?.say(info.shortMsg);
  };
})();
