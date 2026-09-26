// 게임 전역 설정
const CONFIG = {
  // 월드 크기 = 배경 이미지 원본 크기 (좌표를 이미지 픽셀 기준으로 맞추기 위함)
  width: 1122,
  height: 1402,

  // 맵 배경 이미지 (원본: img/background/background.png, 용량 때문에 webp로 변환해서 사용)
  // 로드 실패 시 코드로 그린 임시 맵으로 대체된다.
  mapImage: 'img/background/background.webp',

  // 발판(층) 정의 — 배경 이미지 픽셀 좌표 기준.
  // path = 캐릭터 발이 지나가는 꺾은선 [[x, y], ...] (x 오름차순). 점 사이는 직선 보간이라
  // 계단·출렁다리처럼 기울어진 구간도 점을 찍어 표현한다. 하늘을 나는 웨딩 비행선(오른쪽 위)은 제외.
  floors: {
    balloon: { path: [[118, 276], [294, 276]] }, // 왼쪽 위 열기구 바구니
    welcome: { path: [[545, 322], [1068, 322]] }, // 웰컴 아치 무대 (가운데에 신랑/신부)
    // 왼쪽 위 테라스 → 비탈 → 왼쪽 섬 → 계단 내려감 → 가운데 → 나무다리 → 오른쪽 테라스
    upperRoute: {
      path: [[8, 362], [150, 362], [182, 392], [382, 392], [440, 460], [650, 462], [700, 480], [800, 484], [860, 496], [1040, 496]],
    },
    rightStairs: { path: [[792, 500], [872, 612], [1100, 618]] }, // 오른쪽 흰 계단 → 아래 테라스
    cherry: { path: [[168, 553], [320, 553]] }, // 벚꽃나무 옆 작은 발판
    // 가운데 긴 길 → 나무 계단 올라감 → 오른쪽 섬
    middleRoute: { path: [[12, 692], [560, 692], [615, 638], [828, 632]] },
    gazebo: { path: [[845, 842], [1108, 842]] }, // 오른쪽 정자 테라스
    // 왼쪽 난간 → 다리 → 폭포 위 길 → 출렁다리 → 오른쪽 섬
    lowerRoute: {
      path: [[72, 862], [165, 864], [180, 877], [255, 881], [322, 893], [640, 897], [700, 925], [745, 935], [790, 931], [1008, 940]],
    },
    heartBridge: { path: [[612, 1090], [850, 1085], [1110, 1066]] }, // 하트 발코니 → 다리 → 오른쪽 섬
    boat: { path: [[150, 1176], [410, 1180], [452, 1202], [660, 1206]] }, // 왼쪽 아래 배 갑판 → 선착장
    plaza: { path: [[692, 1290], [1100, 1300]] }, // 오른쪽 아래 광장
    stage: { path: [[742, 318], [808, 318]] }, // 웰컴 아치 아래 (신랑/신부 전용)
  },

  // 하객이 스폰될 수 있는 층 (층 길이에 비례해서 랜덤 배치)
  guestFloors: ['balloon', 'welcome', 'upperRoute', 'rightStairs', 'cherry', 'middleRoute', 'gazebo', 'lowerRoute', 'heartBridge', 'boat', 'plaza'],

  // 사다리/로프: x 위치에서 두 층을 세로로 잇는다. 하객이 걷다가 지나가면 가끔 타고 오르내림
  climbs: [
    { type: 'ladder', x: 767, floors: ['welcome', 'upperRoute'] }, // 웰컴 무대 ↔ 나무다리
    { type: 'ladder', x: 767, floors: ['upperRoute', 'middleRoute'] }, // 나무다리 ↔ 가운데 오른쪽 섬
    { type: 'ladder', x: 439, floors: ['upperRoute', 'middleRoute'] }, // 가운데 섬 ↔ 가운데 긴 길
    { type: 'ladder', x: 406, floors: ['middleRoute', 'lowerRoute'] }, // 가운데 긴 길 ↔ 아랫길
    { type: 'ladder', x: 1033, floors: ['gazebo', 'heartBridge'] }, // 정자 ↔ 하트 다리 오른쪽 섬
    { type: 'ladder', x: 618, floors: ['heartBridge', 'boat'] }, // 하트 발코니 ↔ 선착장
    { type: 'rope', x: 289, floors: ['balloon', 'upperRoute'] }, // 열기구 밧줄
    { type: 'rope', x: 316, floors: ['upperRoute', 'cherry'] }, // 왼쪽 섬 ↔ 벚꽃 발판 (덩굴)
    { type: 'rope', x: 280, floors: ['cherry', 'middleRoute'] }, // 벚꽃 발판 ↔ 가운데 긴 길 (덩굴)
  ],

  // 하객 움직임
  motion: {
    jumpChance: 0.12, // 걷는 중 1초당 점프할 확률
    jumpHeight: 26, // px
    jumpDuration: 620, // ms
    climbChance: 0.45, // 사다리/로프를 지나갈 때 타는 확률
    climbSpeed: 45, // px/s
    climbCooldown: 4000, // 한 번 타고 난 뒤 이 시간 동안은 다시 안 탐 (ms)
  },

  // 화면 확대/축소
  view: {
    focus: { x: 700, y: 701 }, // 처음 화면 가운데에 올 지점 (세로 화면에서 웰컴 아치와 맵 가운데가 함께 보이게)
    maxZoom: 2.5, // 최대 확대: 맵 1px = 화면 2.5px (CSS 픽셀 기준)
    dragThreshold: 8, // 이만큼(CSS px) 움직여야 드래그로 인식 (그보다 작으면 탭)
  },

  // 방명록 API (Vercel Serverless Functions) 주소
  // 로컬 테스트 시 ?api=http://127.0.0.1:8787 쿼리로 덮어쓸 수 있다.
  apiUrl: new URLSearchParams(location.search).get('api') || 'https://guestbook-nine-drab.vercel.app',

  // AI 캐릭터 생성
  ai: {
    photoMaxSize: 1024, // 서버로 보낼 사진의 긴 변 (px)
    maxGenerations: 3, // 한 번 접속에서 생성 가능한 횟수 (비용 보호)
  },

  // 이미지 스프라이트 처리
  sprite: {
    height: 72, // 화면에 표시할 캐릭터 높이 (월드 px)
    textureScale: 2, // 확대해도 선명하도록 텍스처는 표시 크기의 2배로 만들어 축소 표시
    uploadHeight: 128, // 업로드 시 저장할 높이 (고해상도 화면 대비 2배)
    frames: 4, // 동작 스트립(walkUrl 등) 한 장의 가로 프레임 수
    // 정면 외 동작 스트립. 데이터 필드는 `${motion}Url`, 업로드 파일은 `${motion}.png`
    //   walk/jump: 왼쪽을 바라봄, ladder/rope: 뒷모습
    motions: ['walk', 'jump', 'ladder', 'rope'],
    bgThreshold: 235, // RGB가 모두 이 값 이상이면 흰 배경으로 간주
  },

  refreshInterval: 60000, // guests.json 재조회 주기 (ms)

  walkSpeed: { min: 35, max: 70 }, // px/s
  bubble: {
    duration: 5000, // 말풍선 표시 시간 (ms)
    minGap: 3000, // 다음 말풍선까지 최소 대기 (ms)
    maxGap: 15000, // 다음 말풍선까지 최대 대기 (ms)
  },

  fontFamily: '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
};

/** 발판 꺾은선의 x 범위 */
function floorSpan(floor) {
  const { path } = floor;
  return { x1: path[0][0], x2: path[path.length - 1][0] };
}

/** 발판 위 x 지점의 발 높이 (점 사이 직선 보간) */
function floorY(floor, x) {
  const { path } = floor;
  if (x <= path[0][0]) return path[0][1];
  for (let i = 1; i < path.length; i++) {
    const [x1, y1] = path[i - 1];
    const [x2, y2] = path[i];
    if (x <= x2) return x2 === x1 ? y2 : y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
  }
  return path[path.length - 1][1];
}
