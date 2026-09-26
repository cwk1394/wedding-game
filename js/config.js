// 게임 전역 설정
const CONFIG = {
  // 월드 크기 = 배경 이미지 원본 크기 (좌표를 이미지 픽셀 기준으로 맞추기 위함)
  width: 1774,
  height: 887,

  // 맵 배경 이미지 (원본: img/background/background.png, 용량 때문에 webp로 변환해서 사용)
  // 로드 실패 시 코드로 그린 임시 맵으로 대체된다.
  mapImage: 'img/background/background.webp',

  // 발판(층) 정의 — 배경 이미지 픽셀 좌표 기준
  // y = 발판 윗면(캐릭터 발 위치), x1~x2 = 걸어다닐 수 있는 범위
  floors: {
    topLeft: { x1: 465, x2: 790, y: 150 }, // 위쪽 공중 테라스 (왼쪽)
    topRight: { x1: 965, x2: 1300, y: 150 }, // 위쪽 공중 테라스 (오른쪽)
    upperLeft: { x1: 200, x2: 470, y: 205 }, // 왼쪽 윗층
    upperRight: { x1: 1350, x2: 1600, y: 205 }, // 오른쪽 윗층
    midLeft: { x1: 60, x2: 590, y: 370 }, // 왼쪽 중간층
    midRight: { x1: 1185, x2: 1715, y: 370 }, // 오른쪽 중간층
    mainLeft: { x1: 60, x2: 790, y: 545 }, // 본당 테라스 (제단 왼쪽)
    mainRight: { x1: 995, x2: 1715, y: 545 }, // 본당 테라스 (제단 오른쪽)
    bottomLeft: { x1: 130, x2: 680, y: 735 }, // 아래 산책로 (계단 왼쪽)
    bottomRight: { x1: 1100, x2: 1620, y: 735 }, // 아래 산책로 (계단 오른쪽)
    stage: { x1: 800, x2: 975, y: 548 }, // 제단 (신랑/신부 전용)
  },

  // 하객이 스폰될 수 있는 층 (층 길이에 비례해서 랜덤 배치)
  guestFloors: ['topLeft', 'topRight', 'upperLeft', 'upperRight', 'midLeft', 'midRight', 'mainLeft', 'mainRight', 'bottomLeft', 'bottomRight'],

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
    uploadHeight: 128, // 업로드 시 저장할 높이 (고해상도 화면 대비 2배)
    walkFrames: 4, // walkUrl 이미지의 가로 프레임 수
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
