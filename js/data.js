// 신랑·신부 기본 정보
const COUPLE = [
  {
    id: 'groom',
    name: '신랑',
    title: '신랑',
    titleStyle: 'gold',
    shortMsg: '와줘서 고마워!',
    longMsg: '저희 결혼을 축하해 주셔서 감사합니다.\n행복하게 잘 살겠습니다!',
    spriteUrl: 'img/npc/groom/front.webp',
    walkUrl: 'img/npc/groom/walk.webp',
    look: { type: 'groom', hair: 0x2b1d0e },
  },
  {
    id: 'bride',
    name: '신부',
    title: '신부',
    titleStyle: 'gold',
    shortMsg: '행복하게 살게요',
    longMsg: '함께해 주셔서 감사합니다.\n따뜻한 축하 오래 간직할게요!',
    spriteUrl: 'img/npc/bride/front.webp',
    walkUrl: 'img/npc/bride/walk.webp',
    look: { type: 'bride', hair: 0x6b3e1f },
  },
];

// 개발자 모드에서 사용하는 동작 이미지
if (new URLSearchParams(location.search).has('dev')) {
  for (const c of COUPLE) {
    for (const m of ['jump', 'ladder', 'rope', 'prone']) {
      c[`${m}Url`] = `img/npc/${c.id}/${m}.webp`;
    }
  }
}

// 원본 테스트 하객은 사용하지 않음
const DUMMY_GUESTS = [];

// 이 사이트의 하객 목록
const GUESTS_URL = '/api/guests';

async function fetchGuests() {
  try {
    const res = await fetch(
      `${GUESTS_URL}?t=${Date.now()}`,
      { cache: 'no-store' }
    );

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await res.json();
    return Array.isArray(json.guests) ? json.guests : [];
  } catch (err) {
    console.warn('guests.json 로드 실패:', err);
    return null;
  }
}
