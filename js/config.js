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

  walkSpeed: { min: 35, max: 70 }, // px/s
  bubble: {
    duration: 5000, // 말풍선 표시 시간 (ms)
    minGap: 3000, // 다음 말풍선까지 최소 대기 (ms)
    maxGap: 15000, // 다음 말풍선까지 최대 대기 (ms)
  },

  fontFamily: '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
};
