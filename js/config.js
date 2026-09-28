// 게임 전역 설정
const CONFIG = {
  // 월드 크기 = 배경 이미지 원본 크기 (좌표를 이미지 픽셀 기준으로 맞추기 위함)
  width: 1122,
  height: 1402,

  // 맵 배경 이미지 (원본: img/background/background.png, 용량 때문에 webp로 변환해서 사용)
  // 로드 실패 시 코드로 그린 임시 맵으로 대체된다.
  mapImage: 'img/background/background.webp',

  // 발판(층)·사다리·로프 = js/map-data.js (개발자 모드 ?dev 에서 편집·저장)
  // floors: path = 캐릭터 발이 지나가는 꺾은선 [[x, y], ...] (x 오름차순, 점 사이 직선 보간). stage* = 신랑/신부 무대 (isStage, 하객·NPC도 올라갈 수 있음)
  // climbs: x 위치에서 두 층을 세로로 잇는 사다리/로프. 하객이 걷다가 지나가면 가끔 타고 오르내림
  //   floors가 하나 + end(아래 끝 y)면 위쪽만 발판에 걸려 아래가 허공에 매달린 사다리/로프
  floors: MAP_DATA.floors,
  climbs: MAP_DATA.climbs,
  spawn: MAP_DATA.spawn ?? null, // { floor, x } — 방명록 등록 직후 새 캐릭터가 나타나는 곳 (개발자 모드 시작점 도구)
  // { groom: { floor, x }, bride: { floor, x }, fixed } — 없으면 무대 가운데 (개발자 모드 신랑신부 도구·끌기로 지정)
  //   fixed: true = 그 자리에 고정, false(기본) = 무대(stage*) 안에서만 돌아다님 (자리도 무대 위로 한정)
  couple: MAP_DATA.couple ?? null,
  // NPC 설정 { <npc id>: { shortMsg, longMsg, mode, floor, x } } — 개발자 모드에서 NPC를 눌러 수정 (js/npcs.js 값을 덮어씀)
  //   mode: fixed(floor·x 자리에 서 있음) | random(접속할 때마다 아무 발판) | stage(무대 안에서만) | 없으면 npcs.js 처음 발판에서 돌아다님
  npcs: MAP_DATA.npcs ?? {},

  // 하객 움직임
  motion: {
    jumpChance: 0.12, // 걷는 중 1초당 점프할 확률
    jumpHeight: 26, // px
    jumpDuration: 620, // ms
    climbChance: 0.45, // 사다리/로프를 지나갈 때 타는 확률
    climbSpeed: 45, // px/s
    climbCooldown: 4000, // 한 번 타고 난 뒤 이 시간 동안은 다시 안 탐 (ms)
    // 개발자 모드에서 직접 조종할 때
    control: {
      walkSpeed: 95, // px/s
      jumpVelocity: 340, // 점프 시작 속도 (px/s) → 약 58px 높이
      gravity: 1000, // px/s²
      climbSpeed: 75, // px/s
      grabRange: 14, // 사다리/로프를 잡을 수 있는 가로 거리 (px)
      grabHeight: 40, // 잡는 기준점 = 발에서 이만큼 위(손 높이). 매달린 로프는 손이 아래 끝에 닿을 때까지 내려갈 수 있음
    },
    // 발판 끝에서 가까운 다른 발판으로 점프해 건너가기
    gapJump: {
      chance: 0.5, // 발판 끝에 닿았을 때 건너갈 확률 (아니면 돌아섬)
      maxGap: 60, // 두 발판 사이 가로 틈 최대 (px)
      maxUp: 50, // 위로 뛰어오를 수 있는 높이 (px)
      maxDown: 100, // 아래로 뛰어내릴 수 있는 높이 (px)
    },
  },

  // 화면 확대/축소
  view: {
    focus: { x: 700, y: 701 }, // 처음 화면 가운데에 올 지점 (세로 화면에서 웰컴 아치와 맵 가운데가 함께 보이게)
    maxZoom: 2.5, // 최대 확대: 맵 1px = 화면 2.5px (CSS 픽셀 기준)
    controlZoom: 1, // 조종을 시작할 때 이 배율로 맞춤
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
    framePadding: 0.12, // 프레임 좌우 여유 (프레임 폭 대비). 머리카락·치마가 흔들려도 잘리지 않게
    // 정면 외 동작 스트립. 데이터 필드는 `${motion}Url`, 업로드 파일은 `${motion}.png`
    //   walk/jump/prone: 왼쪽을 바라봄, ladder/rope: 뒷모습
    motions: ['walk', 'jump', 'ladder', 'rope', 'prone'],
    motionFrames: { walk: 4, jump: 4, ladder: 4, rope: 4, prone: 2 }, // 동작 스트립 한 장의 가로 프레임 수
    // 동작 이미지 크기: 서 있는 자세(걷기·점프·사다리·로프 등)는 정면 이미지의 머리 폭에 맞추고(measureHead),
    // 누운 자세(lyingMotions)는 서 있는 키 대비 motionHeight 비율로 맞춘다
    headRegion: 0.4, // 머리 폭을 잴 영역 = 캐릭터 위쪽 40%
    lyingMotions: ['prone', 'sleep'],
    motionHeight: { prone: 0.5 }, // 누운 자세에서 가장 키 큰 프레임의 높이 비율 (없으면 1)
    bgThreshold: 235, // RGB가 모두 이 값 이상이면 흰 배경으로 간주
  },

  // 시작점(spawn)에 띄우는 워프게이트: 가로 4프레임 스트립 (원본 img/etc/warpgate.png → 절반 크기 webp)
  warpgate: {
    image: 'img/etc/warpgate.webp',
    frameWidth: 271,
    frameHeight: 362,
    frames: 4,
    height: 130, // 표시 높이 (월드 px, 프레임 전체 기준)
    originY: 0.8, // 발판에 닿는 바닥 고리 위치 (프레임 높이 대비)
    fps: 8,
  },

  refreshInterval: 60000, // guests.json 재조회 주기 (ms)

  // 꽃잎 날리기 효과 (맵 전체에 천천히 떨어지며 흔들림)
  petals: {
    frequency: 450, // ms마다 1장 (작을수록 많이)
    fallSpeed: { min: 18, max: 38 }, // px/s
    drift: { min: -14, max: 14 }, // 가로 px/s
    alpha: 0.85,
  },

  // 배경음악: audio/bgm.mp3 를 넣으면 자동 재생 (브라우저가 막으면 첫 터치/클릭 때 시작). 오른쪽 위 버튼으로 켜고 끔
  bgm: { src: 'audio/bgm.mp3', volume: 0.35 },

  walkSpeed: { min: 35, max: 70 }, // px/s

  // 하객 캐릭터 생성 때 고르는 신랑·신부와의 관계: 어느 쪽(side) + 어떤 관계(relation), 둘 다 필수
  // (키는 api/guestbook.js SIDES / RELATIONS와 같아야 함)
  sides: { groom: '신랑측', bride: '신부측', both: '양측' },
  relations: { family: '친척', work: '직장', friend: '친구', other: '기타' },

  // 캐릭터 성향 (키는 api/guestbook.js PERSONALITIES와 같아야 함) → 하객이 스스로 돌아다니는 방식 (GuestCharacter)
  //   speed: 걷는 속도 배율, walk: 새 상태를 고를 때 걸을 확률, walkTime/idleTime: 걷기/서 있기 시간 [최소, 최대] ms
  //   jump/climb/gap: 점프·사다리 타기·발판 건너뛰기 확률 배율, bubbleGap: 말풍선 간격 배율
  //   lines + lineChance: 말풍선에 한줄 멘트 대신 가끔 하는 말
  //   idle: 서 있을 때 특별 동작 — sleep(엎드려 자기 + z 글자·콧방울), photo(카메라 플래시 + 반짝이 + 찰칵), eat(머리 위 음식 → 냠!), heart(작은 하트가 둥실), dance(통통 점프 또는 셔플 스텝 — 한 방향으로 가며 걷기 모션만 좌우로)
  //   typing: 말하기 전 머리 위에 "…" 입력 중 표시, dust: 점프 착지 때 흙먼지 + 가끔 "!" (댄서는 춤출 때 음표)
  personalities: {
    chatty: { label: '수다쟁이', typing: true, walk: 0.5, bubbleGap: 0.35, lines: ['그거 알아?', '축하해요~!', '있잖아…', '하하하!', '신랑 신부 너무 잘 어울려!', '오늘 날씨 최고다~', '나 어제 뭐 했게?', '대박 대박!', '밥은 먹었어?', '여기 분위기 좋다~', '진짜 진짜 축하해!', '근데 있잖아~'], lineChance: 0.6 },
    explorer: { label: '탐험가', dust: true, speed: 1.4, walk: 0.9, walkTime: [1500, 4000], idleTime: [500, 1200], jump: 5, climb: 2.2, gap: 2, lines: ['저기엔 뭐가 있을까?', '모험이다!', '영차!', '다음은 저쪽!'], lineChance: 0.3 },
    foodie: { label: '먹보', idle: 'eat', speed: 0.8, walk: 0.45, idleTime: [2500, 5000], jump: 0.6, lines: ['냠냠', '배고파…', '뷔페 언제 열려요?'], lineChance: 0.4 },
    sleepy: { label: '잠꾸러기', speed: 0.6, walk: 0.3, idleTime: [5000, 10000], jump: 0.2, climb: 0.4, gap: 0.4, idle: 'sleep', lines: ['하암…'], lineChance: 0.3 },
    photo: { label: '사진광', walk: 0.5, walkTime: [800, 2000], idleTime: [1500, 3000], idle: 'photo', lines: ['김치~', '여기 봐요!'], lineChance: 0.3 },
    dancer: { label: '댄서', speed: 1.1, walk: 0.5, idleTime: [2000, 4000], jump: 2.5, idle: 'dance', lines: ['♪', '렛츠 댄스!'], lineChance: 0.3 },
    calm: { label: '얌전이', idle: 'heart', speed: 0.7, walk: 0.45, jump: 0.15, climb: 0.5, gap: 0.4, bubbleGap: 1.8 },
  },

  // 능력치 (주사위): 각 min부터 시작해서 남은 점수(total - min×4)를 한 점씩 무작위로 나눔 → 가운데 값이 잘 나오고 끝값(4, 13)은 드묾
  stats: { keys: ['str', 'dex', 'int', 'luk'], min: 4, total: 25 },

  // 칭호 (메이플 메달처럼 머리 위)
  titleStyle: { fill: 0x3b2a6e, line: 0xffd76a, text: '#fff3c4' },
  // 신랑·신부 칭호 (js/data.js COUPLE의 titleStyle: 'gold'): 금빛 리본 메달
  goldTitleStyle: {
    fill: 0xe8ac2c, // 금빛 바탕
    shine: 0xffe27a, // 위쪽 광택
    edge: 0x8a5200, // 바깥 테두리
    inner: 0xfff6c8, // 안쪽 밝은 선
    tail: 0xc4860f, // 제비꼬리 리본
    text: '#fffbe8',
    textStroke: '#7a4600',
    edgeText: '#8a5200',
    heart: '#ff5d8f',
    sparkle: '#fff6b0',
  },
  bubble: {
    duration: 5000, // 말풍선 표시 시간 (ms)
    minGap: 3000, // 다음 말풍선까지 최소 대기 (ms)
    maxGap: 15000, // 다음 말풍선까지 최대 대기 (ms)
    // 메이플스토리풍 말풍선 색
    style: {
      fill: 0xf2f9ff, // 아주 옅은 하늘색 바탕
      line: 0xa3bdd3, // 얇고 연한 테두리
      lineWidth: 1.2,
      shade: 0xd3e6f5, // 아래쪽 안쪽 음영
      shadow: 0x5d7f9c, // 아래 그림자
      text: '#3b4a5a',
    },
  },

  fontFamily: '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
};

/** 신랑·신부 무대 발판인지 (이름이 stage로 시작: stage, stage1, stage_2 …). 신랑·신부는 고정이 아니면 여기서만 돌아다닌다 */
function isStage(name) {
  return name.startsWith('stage');
}

/** 기본 무대 발판 이름 (stage가 있으면 그것, 없으면 첫 무대 조각, 무대가 없으면 첫 발판) */
function mainStageName() {
  const names = Object.keys(CONFIG.floors);
  return CONFIG.floors.stage ? 'stage' : names.find(isStage) ?? names[0];
}

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

/**
 * 사다리/로프의 위·아래 끝 { top: { name, y }, bottom: { name, y } }.
 * floors가 하나뿐이면 위쪽만 발판에 걸린 매달린 사다리/로프 → bottom.name = null, bottom.y = end
 */
function climbEnds(c) {
  const ends = c.floors.map((name) => ({ name, y: floorY(CONFIG.floors[name], c.x) }));
  if (ends.length === 1) ends.push({ name: null, y: c.end });
  ends.sort((a, b) => a.y - b.y);
  return { top: ends[0], bottom: ends[1] };
}

/** 시작점 { floor, x, y } (없거나 발판이 사라졌으면 null) */
function spawnPoint() {
  const sp = CONFIG.spawn;
  const floor = sp && CONFIG.floors[sp.floor];
  if (!floor) return null;
  const { x1, x2 } = floorSpan(floor);
  const x = Math.min(Math.max(sp.x, x1), x2);
  return { floor: sp.floor, x, y: floorY(floor, x) };
}

/** 신랑·신부 고정 여부 (개발자 모드 체크박스). 기본은 고정 아님 = 무대 안에서 돌아다님 */
function coupleFixed() {
  return CONFIG.couple?.fixed === true;
}

/**
 * 신랑(groom)/신부(bride) 자리 { floor, x, y }. 지정이 없거나 발판이 사라졌으면 무대 가운데 ±30.
 * 고정이 아니면 무대 안에서만 다니므로 무대 밖 자리도 무대 가운데로
 */
function couplePoint(id) {
  const p = CONFIG.couple?.[id];
  let name = p && CONFIG.floors[p.floor] && (coupleFixed() || isStage(p.floor)) ? p.floor : null;
  let x = p?.x;
  if (!name) {
    name = mainStageName();
    const { x1, x2 } = floorSpan(CONFIG.floors[name]);
    x = (x1 + x2) / 2 + (id === 'groom' ? -30 : 30);
  }
  const floor = CONFIG.floors[name];
  const { x1, x2 } = floorSpan(floor);
  x = Math.min(Math.max(x, x1), x2);
  return { floor: name, x, y: floorY(floor, x) };
}
