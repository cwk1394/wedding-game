// 게임 전역 설정
const CONFIG = {
  width: 1280,
  height: 720,

  // 맵 배경 이미지 경로 (예: 'assets/map.png').
  // null이면 코드로 그린 임시 맵을 사용한다. 이미지를 쓰면 아래 floors 좌표를 이미지 발판에 맞춰 조정할 것.
  mapImage: null,

  // 발판(층) 정의: y = 발판 윗면(캐릭터 발 위치), x1~x2 = 걸어다닐 수 있는 범위
  floors: {
    ground: { x1: 0, x2: 1280, y: 660 },
    midLeft: { x1: 60, x2: 440, y: 490 },
    midRight: { x1: 840, x2: 1220, y: 490 },
    top: { x1: 260, x2: 1020, y: 290 },
    stage: { x1: 510, x2: 770, y: 470 }, // 신랑/신부 전용
  },

  // 하객이 스폰될 수 있는 층
  guestFloors: ['ground', 'midLeft', 'midRight', 'top'],

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
    height: 64, // 화면에 표시할 캐릭터 높이 (px)
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
