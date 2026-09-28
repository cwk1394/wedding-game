// NPC 설정. 이미지는 scripts/gen-npc.mjs로 만든 img/npc/<id>/{front,idle,walk,sleep}.webp
// - floor: 처음 서 있을 발판 (없어졌으면 랜덤), x: 처음 위치(없으면 랜덤)
// - NPC는 점프·사다리·로프를 쓰지 않고 자기 발판(이어진 발판 포함) 위만 돌아다닌다. 조종 불가
// - popup: shortMsg = 말풍선·팝업 한줄 멘트(20자 이하), longMsg = 팝업 소개 글(미정 — 정해지면 여기서 수정)
// - effect: petals(꽃가루 뿌리기) | bubbles(서 있으면 비눗방울, 걸으면 파티 블로어 음표)
// - event: 누르면 캐릭터창 대신 이벤트 화면 (rps = 가위바위보 머신)
// - states: 걷기(walk)·특수 동작(sleep, scratch 등) 비율과 지속 시간(<동작>Time, ms). 나머지 확률은 서기(idle)

const NPC_POPUP_TBD = '소개 글을 준비하고 있어요.';

const NPCS = [
  {
    id: 'rabbit-pudding',
    name: '푸딩',
    floor: 'middleRoute',
    height: 50,
    speed: [22, 36],
    effect: 'petals',
    motions: ['idle', 'walk'],
    popup: { shortMsg: '꽃가루 뿌뿌~', longMsg: NPC_POPUP_TBD },
  },
  {
    id: 'zebra',
    name: '얼룩말',
    floor: 'upperRoute_1',
    height: 66,
    speed: [24, 38],
    effect: 'bubbles',
    motions: ['idle', 'walk'],
    popup: { shortMsg: '뿌우~ 축하해!', longMsg: NPC_POPUP_TBD },
  },
  ...[
    ['cat-mimi', '미미', 'lowerRoute', '냐옹~'],
    ['cat-ongi', '옹이', 'heartBridge', '냥냥! 축하냥'],
    ['cat-boksil', '복실이', 'gazebo', '골골골~'],
    ['cat-byeol', '별이', 'f2', '미야옹~'],
  ].map(([id, name, floor, shortMsg]) => ({
    id,
    name,
    floor,
    height: 30,
    speed: [12, 22], // 어슬렁어슬렁
    motions: ['idle', 'walk', 'sleep'], // idle = 그루밍
    motionHeight: { sleep: 0.6 },
    motionFrames: { sleep: 2 },
    states: { walk: 0.35, idle: 0.3, sleep: 0.35, walkTime: [3000, 7000], idleTime: [3000, 6000], sleepTime: [7000, 15000] },
    popup: { shortMsg, longMsg: NPC_POPUP_TBD },
  })),
  {
    id: 'dog-esso',
    name: '에쏘',
    floor: null, // 처음 발판 없음 → 접속할 때마다 사다리·로프를 피한 랜덤 발판에서 시작
    height: 36,
    speed: [75, 100],
    motions: ['idle', 'walk', 'scratch'], // scratch = 앉아서 뒷다리로 머리 긁기
    states: { walk: 0.6, scratch: 0.15, idle: 0.25, walkTime: [800, 2200], idleTime: [1500, 3500], scratchTime: [1800, 3000] },
    popup: { shortMsg: '멍멍! 헤헤', longMsg: NPC_POPUP_TBD },
  },
  {
    id: 'dog-mongsil',
    name: '몽실이',
    floor: 'upperRoute',
    height: 32,
    speed: [14, 22], // 천천히
    motions: ['idle', 'walk', 'sit'], // idle = 올려다보기, sit = 핑크 삑삑이 덤벨 물고 앉기
    states: { walk: 0.35, sit: 0.3, idle: 0.35, walkTime: [3000, 6000], idleTime: [2500, 5000], sitTime: [4000, 8000] },
    popup: { shortMsg: '왈! 삑삑~', longMsg: NPC_POPUP_TBD },
  },
  {
    id: 'wedding-car',
    name: '택시',
    floor: 'f7', // 오른쪽 아래 광장
    x: 1000,
    fixed: true, // 움직이지 않음
    height: 87,
    motions: [],
    popup: { shortMsg: '빵빵~ 타세요!', longMsg: NPC_POPUP_TBD },
  },
  {
    // 이벤트 NPC: 누르면 가위바위보 게임 (js/rps.js, api/rps.js). 시작점 옆 배 갑판에 고정
    id: 'rps-machine',
    name: '가위바위보 머신',
    floor: 'f2',
    x: 285,
    fixed: true,
    height: 70,
    motions: [],
    event: 'rps',
    popup: { shortMsg: '연승 도전! ☕', longMsg: '' },
  },
];

// 개발자 모드(?dev)에서 추가한 NPC: js/map-data.js npcs[id].def = { desc, height, motions } (이미지는 img/npc/<id>/)
NPCS.push(...Object.entries(CONFIG.npcs).filter(([, s]) => s.def).map(([id, s]) => customNpc(id, s)));

/** 추가한 NPC 설정 → NPCS 항목 (처음 발판 없음 → 배치 방식대로, 기본이면 랜덤) */
function customNpc(id, s) {
  return { id, name: s.name, custom: true, height: s.def.height, speed: [18, 32], motions: s.def.motions, popup: {} };
}
