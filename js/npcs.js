// NPC 설정. 이미지는 scripts/gen-npc.mjs로 만든 img/npc/<id>/{front,idle,walk,sleep}.webp
// - floor: 처음 서 있을 발판 (없어졌으면 랜덤), x: 처음 위치(없으면 랜덤)
// - NPC는 점프·사다리·로프를 쓰지 않고 자기 발판(이어진 발판 포함) 위만 돌아다닌다. 조종 불가
// - popup: 팝업에 보일 한줄 멘트/소개 글 (미정 — 정해지면 여기서 수정)
// - effect: petals(꽃가루 뿌리기) | bubbles(서 있으면 비눗방울, 걸으면 파티 블로어 음표)
// - states: 걷기(walk)·특수 동작(sleep, scratch 등) 비율과 지속 시간(<동작>Time, ms). 나머지 확률은 서기(idle)

const NPC_POPUP_TBD = '소개 글을 준비하고 있어요.';

const NPCS = [
  {
    id: 'pudding',
    name: '푸딩',
    floor: 'middleRoute',
    height: 50,
    speed: [22, 36],
    effect: 'petals',
    motions: ['idle', 'walk'],
    popup: { shortMsg: '', longMsg: NPC_POPUP_TBD },
  },
  {
    id: 'zebra',
    name: '얼룩말',
    floor: 'upperRoute_1',
    height: 66,
    speed: [24, 38],
    effect: 'bubbles',
    motions: ['idle', 'walk'],
    popup: { shortMsg: '', longMsg: NPC_POPUP_TBD },
  },
  ...[
    ['cat-mimi', '미미', 'lowerRoute'],
    ['cat-ongi', '옹이', 'heartBridge'],
    ['cat-boksil', '복실이', 'gazebo'],
    ['cat-byeol', '별이', 'f2'],
  ].map(([id, name, floor]) => ({
    id,
    name,
    floor,
    height: 30,
    speed: [12, 22], // 어슬렁어슬렁
    motions: ['idle', 'walk', 'sleep'], // idle = 그루밍
    motionHeight: { sleep: 0.6 },
    motionFrames: { sleep: 2 },
    states: { walk: 0.35, idle: 0.3, sleep: 0.35, walkTime: [3000, 7000], idleTime: [3000, 6000], sleepTime: [7000, 15000] },
    popup: { shortMsg: '', longMsg: NPC_POPUP_TBD },
  })),
  {
    id: 'esso',
    name: '에쏘',
    floor: 'f9', // 웰컴 무대: 신랑·신부 주변을 뛰어다님
    range: 170, // 신랑·신부(무대 가운데)에서 좌우 이만큼 안에서만
    height: 36,
    speed: [75, 100],
    motions: ['idle', 'walk', 'scratch'], // scratch = 앉아서 뒷다리로 머리 긁기
    states: { walk: 0.6, scratch: 0.15, idle: 0.25, walkTime: [800, 2200], idleTime: [1500, 3500], scratchTime: [1800, 3000] },
    popup: { shortMsg: '', longMsg: NPC_POPUP_TBD },
  },
  {
    id: 'taxi',
    name: '택시',
    floor: 'f7', // 오른쪽 아래 광장
    x: 1000,
    fixed: true, // 움직이지 않음
    height: 58,
    motions: [],
    popup: { shortMsg: '', longMsg: NPC_POPUP_TBD },
  },
];
