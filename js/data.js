// 신랑/신부는 고정 데이터, 하객은 data/guests.json(GitHub Actions가 Discussions에서 생성)에서 읽는다.
// spriteUrl이 null이면 look 값(없으면 id 기반 랜덤)으로 임시 캐릭터를 코드로 그린다.

const COUPLE = [
  {
    id: 'groom',
    name: '신랑',
    shortMsg: '와줘서 고마워!',
    longMsg: '바쁘신 와중에 저희 결혼식에 와주셔서 진심으로 감사드립니다.\n행복하게 잘 살겠습니다!',
    spriteUrl: 'img/characters/groom.png',
    walkUrl: 'img/characters/groom_move.png',
    look: { type: 'groom', hair: 0x2b1d0e }, // 이미지 로드 전/실패 시 임시 캐릭터
  },
  {
    id: 'bride',
    name: '신부',
    shortMsg: '행복하게 살게요',
    longMsg: '함께해 주셔서 감사합니다.\n오늘 남겨주신 따뜻한 말들 오래오래 간직할게요 :)',
    spriteUrl: 'img/characters/bride.png',
    walkUrl: 'img/characters/bride_move.png',
    look: { type: 'bride', hair: 0x6b3e1f },
  },
];

// guests.json을 못 읽을 때(로컬에서 파일로 열었을 때 등) 쓰는 더미 데이터
const DUMMY_GUESTS = [
  {
    id: 'guest-1',
    name: '고정만',
    shortMsg: '축하한다 어이!',
    longMsg: '결혼 축하하고, 신혼여행 가서도 업무 연락은 받아라.',
    spriteUrl: null,
    look: { hair: 0x222222, top: 0x3d7dd8, bottom: 0x2b3a55 },
  },
  {
    id: 'guest-2',
    name: '김메이플',
    shortMsg: '백년해로 하세요',
    longMsg: '두 분 너무 잘 어울려요! 행복한 가정 꾸리시길 바랄게요.\n집들이 꼭 불러주세요 🎉',
    spriteUrl: null,
    look: { hair: 0xd9a441, top: 0xe85d8a, bottom: 0x4a4a4a },
  },
  {
    id: 'guest-3',
    name: '이슬라임',
    shortMsg: '결혼 축하해~',
    longMsg: '드디어 가는구나! 누구보다 행복하게 살아야 해.\n사랑한다 친구야.',
    spriteUrl: null,
    look: { hair: 0x7a3b12, top: 0x4caf50, bottom: 0x6d4c41 },
  },
];

const GUESTS_URL = 'data/guests.json';

/** 방명록 목록을 불러온다. 실패하면 null. */
async function fetchGuests() {
  try {
    const res = await fetch(`${GUESTS_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return Array.isArray(json.guests) ? json.guests : [];
  } catch (err) {
    console.warn('guests.json 로드 실패:', err);
    return null;
  }
}
