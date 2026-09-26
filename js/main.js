(async () => {
  const fetched = await fetchGuests();
  // 로컬에서 파일로 열었거나 아직 배포 전이면 더미 데이터로 표시
  const guests = fetched ?? DUMMY_GUESTS;

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: CONFIG.width,
    height: CONFIG.height,
    backgroundColor: '#7ec8ff',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  });
  game.scene.add('MapScene', MapScene, true, { guests, live: fetched !== null });

  // 방금 등록한 하객은 배포를 기다리지 않고 바로 맵에 등장시킨다
  UI.onGuestCreated = (info) => {
    const guest = game.scene.getScene('MapScene').addGuest(info);
    guest?.say(info.shortMsg);
  };
})();
