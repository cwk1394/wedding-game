# 결혼식 온라인 방명록 (메이플스토리 컨셉)

QR로 접속 → 하객이 캐릭터 + 방명록을 등록 → 맵 위를 네임태그 달고 돌아다님.
기획/설계 문서: `docs/concept.md`(컨셉), `docs/architecture.md`(구성·데이터 흐름), `docs/step.md`(단계별 진행 계획).

## 진행 상황
- [x] 1단계: Phaser 껍데기 (맵, 더미 캐릭터, 이동/네임태그/말풍선, 클릭 팝업)
- [x] 2단계: GitHub Discussions 읽기 (Actions → `guests.json` 방식)
- [x] 3단계: Vercel Serverless Functions로 방명록 쓰기 (`api/guestbook.js`). Cloudflare는 사용 안 함
- [x] 4단계: AI 스프라이트 생성 파이프라인 (`api/character.js`, 폼에서 사진 → 정면 → 걷기 순서로 생성)
- [ ] 5단계: 모바일 최적화, 로딩 UI

## 기술 스택 / 구조
- 순수 HTML/JS + Phaser 3.80.1 (jsDelivr CDN). 빌드 도구·번들러 없음, 스크립트는 전역 변수로 연결.
- `index.html`에서 스크립트 로드 순서가 의존성 순서: `map-data → config → data → npcs → textures → character → api → ui → view → control → scene → dev → main`.

```
index.html              왼쪽 위 메뉴(모드 전환·캐릭터 수정·방명록 목록·웨딩 갤러리·로비로 돌아가기), 로비·모달 DOM + 스크립트 로드
css/style.css           모달(흰 머리글·둥근 카드), 코랄 버튼, 칩, 위저드, 토스트
js/map-data.js          MAP_DATA: 이동 가능 영역(floors 꺾은선, climbs 사다리/로프), spawn 시작점, couple 신랑·신부 자리·고정 여부, npcs NPC 설정(멘트·배치). 개발자 모드 저장 시 API가 통째로 다시 씀
js/config.js            CONFIG: 월드 크기(=배경 이미지 1122x1402, 세로형), 배경 이미지, 층(floors) 꺾은선 좌표 + floorSpan()/floorY(), 속도, 말풍선, API 주소, AI/스프라이트 설정
js/npcs.js              NPCS: NPC 설정(이름, 처음 발판, 키, 속도, 동작, 효과, 팝업 글)
js/data.js              COUPLE(고정), DUMMY_GUESTS(폴백 = 개발 때 테스트 캐릭터 7명, 이미지 img/dummy/<id>/), fetchGuests()
js/textures.js          임시 캐릭터 그리기, lookFromId(), 이미지 스프라이트 처리(removeBackground, buildSpriteCanvases, loadSpriteTextures)
js/character.js         Character(스프라이트+네임태그+말풍선) / CoupleCharacter(고정) / GuestCharacter(층 안에서 랜덤 이동)
js/api.js               resizePhoto(), generateCharacter()(AI 생성), prepareSpriteImages()(업로드용 후처리), submitGuestbook()
js/ui.js                메뉴, 방명록 팝업/목록, 웨딩 갤러리, 4단계 캐릭터 만들기 위저드(1 내 정보 → 2 캐릭터 → 3 한마디·방명록 → 4 비밀번호·등록), 토스트. UI.onGuestCreated 콜백으로 새 하객을 맵에 즉시 추가
js/rps.js               Rps: 이벤트 NPC "가위바위보 머신" 화면(비밀번호 확인 → 가위·바위·보, 효과, 랭킹). ui.js 다음에 로드(`UI.setupModal`)
js/view.js              MapView: 카메라 확대/축소(핀치·휠)와 드래그 이동, DPR 상수
js/scene.js             MapScene: 임시 맵 그리기, 신랑신부/하객 스폰, addGuest(), 60초 주기 재조회
js/control.js           Controller: 캐릭터 직접 조종(방향키/Space, 터치 스틱·점프 버튼, 카메라 따라가기). 일반 방문자·개발자 모드 공용
js/dev.js               DevMode: 개발자 모드(?dev) 이동 가능 영역 편집기 (추가/지우기/되돌리기/저장)
js/main.js              guests.json 로드 후 게임 시작 (실패 시 DUMMY_GUESTS)
scripts/lib/discussions.mjs  방명록 카테고리 Discussion 조회·본문 파싱 공통 코드
scripts/fetch-guests.mjs  Discussions → guests.json 변환 (Actions에서 실행)
scripts/gen-npc.mjs     NPC 이미지 생성 도구(로컬 실행, OPENAI_API_KEY 환경변수). 기준 이미지 → idle/walk/sleep 스트립 → img/npc/<id>/
scripts/build-gallery.mjs  audio/bgm.mp3           배경음악 (넣으면 자동 재생 + 오른쪽 위 ON/OFF 버튼 표시, 없으면 버튼 숨김). 배포 때 audio/ 폴더째 복사
img/gallery/ 사진 → 썸네일(400px)·보기용(1600px) webp + gallery.json (Actions, sharp)
scripts/cleanup-guest-images.mjs  방명록에서 참조하지 않는 img/gallery/            웨딩 갤러리 사진. 파일 이름 순으로 보임(01.jpg, 02.jpg…). 폰에서 보므로 긴 변 1600px 안팎 권장
img/guests/<uuid>/ 폴더 git rm
.github/workflows/deploy.yml  Pages 배포 워크플로
.github/workflows/cleanup-images.yml  매일 03:00 KST 고아 이미지 정리 (수동 실행 시 기본 dry run)
img/npc/<groom|bride>/   신랑신부 스프라이트. 하객과 같은 파일명(front, walk, jump, ladder, rope). 원본 png(각 1MB 안팎)는 보관용, 실제로는 webp(q0.9, 44~146KB) 사용
img/dummy/<dummy-n>/     더미 하객 스프라이트 (DUMMY_GUESTS용, 테스트 캐릭터 이미지 복사본 — img/guests/는 방명록 글을 지우면 정리 작업이 지우므로 따로 보관)
img/guests/<uuid>/       하객 스프라이트 (API가 커밋). front.png + 동작 스트립 walk/jump/ladder/rope/prone.png(투명 배경, 4프레임, 높이 128, 모두 선택)
api/_lib/github.js      GitHub API 공통(GitHub 클래스: 커밋, Discussion 작성)
api/_lib/http.js        API 공통: CORS(ALLOWED_ORIGINS), JSON 응답, HttpError, handlePost(). `_` 접두사라 엔드포인트 아님
api/guestbook.js        Vercel 함수: POST 방명록 등록, GET 상태 확인. named export(GET/POST/OPTIONS) + Web Request/Response
api/character.js        Vercel 함수: POST {type: front|walk|jump|ladder|rope|prone, image} → OpenAI 이미지 편집 API → {image: webp data URL}. 저장 안 함. NPC 추가용 npc-front|npc-idle|npc-walk (+desc, 투명 배경)
api/rps.js              Vercel 함수: 가위바위보 머신. POST start|play|stop, GET 랭킹·내 기록. 판정은 서버, 기록은 GitHub Gist(`RPS_GIST_ID`)의 rps.json
api/map.js              Vercel 함수: POST {password, map: {floors, climbs, spawn, couple, npcs}} → 검증 후 js/map-data.js 커밋 (DEV_PASSWORD 필요)
package.json            "type": "module" (api/ 함수 ESM용). 의존성 없음
vercel.json             functions: api/character.js maxDuration 300초 + prompt/** 포함. ignoreCommand: img/guests/만 바뀐 커밋은 Vercel 재배포 생략. redirects: /api/ 외 경로는 GitHub Pages로 이동 (Vercel은 API 전용)
prompt/                 캐릭터/걷기 스프라이트 생성용 프롬프트 (4단계 AI 파이프라인에서 사용). npc-*.txt = 개발자 모드 NPC 추가용({{DESC}} = NPC 설명)
```

## 데이터 흐름 (읽기)
- 프론트에 토큰을 두지 않기 위해 **GraphQL을 브라우저에서 직접 호출하지 않는다.**
- Discussion 생성/수정/삭제 또는 main push → GitHub Actions가 `GITHUB_TOKEN`으로 `방명록` 카테고리 글을 전부 읽음 → `_site/data/guests.json` 생성 → Pages 배포 (반영까지 1~2분).
- `guests.json`은 빌드 산출물이라 저장소에 커밋하지 않는다.
- Discussion 본문 형식 (```json 코드블록으로 감싸도 됨):
  ```json
  { "id": "<uuid>", "name": "이름", "shortMsg": "20자 이하", "longMsg": "방명록 내용",
    "side": "groom", "relation": "friend", "personality": "dancer", "title": "칭호(없으면 null)", "stats": { "str": 6, "dex": 8, "int": 5, "luk": 6 },
    "spriteUrl": "img/guests/<uuid>/front.png", "walkUrl": "img/guests/<uuid>/walk.png",
    "jumpUrl": "…/jump.png", "ladderUrl": "…/ladder.png", "ropeUrl": "…/rope.png" }
  ```
- 본문에 없는 동작 이미지도 `img/guests/<uuid>/<동작>.png` 파일이 저장소에 있으면 `fetch-guests`가 채움 → 나중에 추가한 동작(예: 기존 하객 엎드리기)은 이미지만 커밋하면 됨.
- `guests.json` 항목: `{ id, name, shortMsg, longMsg, side, relation, personality, title, stats, spriteUrl, walkUrl, jumpUrl, ladderUrl, ropeUrl, createdAt }` (옛 글은 relation 등이 null). name 없거나 JSON 파싱 실패 글은 건너뜀.
- **id**: 본문의 UUID. UUID가 없는 옛 수동 글은 `d<discussion번호>`. 이름은 중복 가능하므로 식별·이미지 매핑은 항상 id로 한다.
- 이미지 주소는 https URL 또는 저장소 내부 경로(`img/...png`, `..` 금지)만 허용.

## 데이터 흐름 (쓰기)
0. (선택) AI 캐릭터 생성: 사진을 긴 변 1024px JPEG로 축소 → `POST /api/character {type:'front'}` → 정면 webp (사진 없이 누르면 image 없이 보내고, 서버가 `prompt/create-character-noref.txt` + 무작위 특징(성별 느낌·헤어·머리색·의상·액세서리)으로 글만 가지고 생성 — images/generations는 JSON 요청) → 그걸 기준으로 `walk`(왼쪽 걷기), `jump`(왼쪽 점프 포즈, 제자리), `ladder`/`rope`(뒷모습 오르기), `prone`(엎드리기 2프레임)을 **모두 동시에(병렬)** 생성.
   - 방향: 정면(front)·걷기·점프 프롬프트 모두 "이미지 왼쪽을 바라보고 왼쪽으로 이동"을 강제(`[DIRECTION — ALWAYS LEFT]`). 게임은 왼쪽 기준 이미지를 코드로 뒤집어 오른쪽 이동을 표현하므로, 동작마다 방향이 섞이면 걷기/점프 방향이 어긋남.
   - 모든 캐릭터 프롬프트에 "소지품 금지" 섹션: 몸에 착용하는 것(액세서리·모자·안경 등)만 그리고, 손에 들거나 메는 물건(풍선·꽃다발·가방·캐리어·방망이·무기 등)은 사진에 있어도 빼게 함 — 소지품이 실루엣 밖으로 나오면 크기 계산(머리 폭·키)이 틀어져 캐릭터가 작아 보임.
   - 동작 하나가 실패해도 나머지로 등록 가능. 프롬프트는 `prompt/create-character-{walk,jump,ladder-climbing,rope-climbing,prone}.txt`.
   - 프레임 수는 동작마다 `CONFIG.sprite.motionFrames`(prone만 2), 표시 높이 비율 `motionHeight`(prone 0.5 — 엎드리면 낮고 길어서).
   - 각 호출 최대 ~2분. 모델은 `OPENAI_IMAGE_MODEL`(쉼표 구분, 기본 gpt-image-2 → 1.5 → 1 순으로 시도, 없는 모델이면 다음으로), 품질 `OPENAI_IMAGE_QUALITY`(기본 medium).
   - 걷기 생성만 실패하면 정면만으로 등록 가능. 한 접속당 생성 3회 제한(`CONFIG.ai.maxGenerations`, 클라이언트 측).
   - 동작 스트립 프레임 분할(`splitFrames`): 열 무게 k-means로 프레임 중심 4개 → 붙어 있는 픽셀 덩어리 단위로 가까운 중심에 배정(두 프레임에 걸친 덩어리는 픽셀별). 긴 머리·치마가 옆 프레임에 닿아도 조각이 섞이지 않음.
   - 프레임은 각자 영역만 잘라 **발(아래)을 맞춤**(AI가 점프 프레임을 위아래로 띄워 그려도 무시). 크기는 사람형 캐릭터면 **정면 이미지의 머리 폭**(`measureHead`: 위쪽 40% 안 가장 넓은 줄)에 동작 프레임 머리 폭 중간값을 맞춤 → 웅크린 점프도 서 있을 때와 같은 크기. 누운 자세(`lyingMotions`: prone, sleep)와 네발 동물 NPC는 가장 키 큰 프레임 = 키 × `motionHeight`.
   - 자른 프레임은 좌우에 `CONFIG.sprite.framePadding`(12%) 여유를 둔다. 프롬프트에도 프레임 사이 빈 간격(셀 폭 15% 이상)·좌우 여백을 요구하는 `[FRAME SPACING / SAFE MARGIN]` 섹션이 있음.
1. 브라우저: 폼 입력 + 이미지 파일 → 배경 제거·크롭·높이 128로 축소 → PNG data URL (한 장 수십 KB)
2. API `POST /api/guestbook` (Vercel 함수): 입력 검증(이름 15자, 멘트 20자, 방명록 500자, PNG 서명, 512KB 상한), 허용 출처(CORS) 확인
3. API가 `crypto.randomUUID()`로 id 발급 → Git Data API로 이미지 2장을 **한 커밋**으로 `img/guests/<uuid>/`에 올림 (브랜치가 앞서가면 최대 3회 재시도)
4. Discussion 작성 → push/discussion 이벤트로 Actions가 재배포 (1~2분)
5. 브라우저는 배포를 기다리지 않고 방금 처리한 data URL 이미지로 즉시 맵에 추가. 이후 재조회 때 같은 UUID라 중복 생성 안 됨.

## 구현 메모
- 캐릭터 컨테이너 원점(0,0) = 발 위치. 스프라이트 origin (0.5, 1).
- 이름표는 텍스트 + 뒤에 그린 반투명 검정 둥근 사각형(반지름 3, `drawTagBg`).
- 누르는 영역은 스프라이트가 아니라 컨테이너에 발 기준 고정 사각형(`updateHitArea`, 정면 폭×1.3 + 네임태그). 스프라이트에 걸면 걷기·사다리 프레임 크기마다 영역이 달라져 잘 안 눌림.
- 임시 캐릭터는 오른쪽을 바라보게 그림 → 왼쪽 이동 시 `setFlipX(true)`.
- `look`이 없는 데이터는 `lookFromId(id)`로 id 해시 기반 고정 랜덤 색상.
- 배경: `img/background/background.png`(원본 3MB, 세로형 공중섬 맵) → `background.webp`(495KB)로 변환해서 사용. 월드 크기 = 이미지 원본 크기라 `CONFIG.floors`는 **이미지 픽셀 좌표 그대로**.
  - 발판은 `path: [[x, y], ...]` 꺾은선(x 오름차순). 점 사이는 직선 보간이라 계단·출렁다리 같은 기울어진 길도 표현. 하객은 걸을 때마다 `floorY()`로 발 높이와 depth를 갱신.
  - 층 13개(열기구 바구니, 배 갑판~선착장, 웰컴 무대 좌우, 윗길/가운데길/아랫길, 정자, 하트 다리, 광장 등) + 무대(`stage`, `stage1`… 이름이 stage로 시작하는 발판 = `isStage()`, 웰컴 아치 아래. 하객·NPC도 올라갈 수 있음. 신랑·신부가 고정이 아니면 무대 조각들 안에서만 다님 — 이어진 발판·점프 대상·착지를 `canStandOn`으로 거름). 오른쪽 위 웨딩 비행선은 제외. 하객은 층 가로 길이에 비례한 확률로 배치(`pickGuestFloor`).
  - 페이지를 `?debug`로 열면 발판 위치가 빨간 선으로 표시됨 → 배경을 바꾸면 이걸 보며 floors 조정.
  - 배경 이미지 로드 실패 시에만 코드로 그린 임시 맵(하늘/발판/꽃 아치) 사용.
- 첫 로딩 화면(`#loading`): 배경 이미지 + 처음 스폰한 모든 캐릭터의 이미지 적용(`Character.ready`)이 끝나면 사라짐 → 임시 캐릭터가 먼저 보이는 문제 방지.
  - 진행률 = 배경 1칸 + 캐릭터 1명당 1칸(막대 + %). 로비와 같은 제목·하트·3단계 설명(`.lobby-intro`: 캐릭터 만들기 → 축하 한마디 → 맵을 돌아다님, 게임인지 방명록인지 헷갈리지 않게) 배치이고 진행 막대 칸(`.loading-progress`)이 로비 버튼 칸(버튼 두 개 + 안내 말풍선, 171px)과 같은 크기라, 로딩이 걷히면 그 자리에 버튼만 나타남. 20초가 지나면 로딩이 덜 끝나도 메인 화면을 보여준다. 이후 재조회로 추가되는 하객은 기다리지 않음.
- 팝업은 닫기 버튼(×)·ESC로만 닫힘 (바깥 맵을 눌러도 안 닫힘). 캐릭터 터치 직후 따라오는 click이 닫기 버튼에 맞지 않게 모달 오픈 후 400ms 동안 클릭 무시.
- 신랑신부 스프라이트 원본(`img/npc/*/walk.png` 등): 가로 4프레임, **왼쪽을 바라봄**, **흰 배경(투명 아님)** → 로드 시 배경 제거 + 프레임 분할 필요. 기존 임시 캐릭터와 방향이 반대인 점 주의.

## 방명록 수정/삭제 (비밀번호)
- 등록 위저드 4단계에 비밀번호(4~30자). 서버는 Discussion 본문에 `pw: "salt:HMAC-SHA256(비밀키, salt:비밀번호)"`만 저장(본문은 공개라 평문 금지). 비밀키 = Vercel `GUEST_PASSWORD_SECRET`(없으면 `DEV_PASSWORD`) — 바꾸면 기존 비밀번호 전부 무효.
- guests.json에는 `number`(Discussion 번호)가 들어가고 pw는 빠짐. `POST /api/guestbook {action: verify|update|delete, number, id, password, ...}` → 번호로 글을 읽고 카테고리·id 확인 후 비밀번호 검사.
- `DEV_PASSWORD`는 관리자 비밀번호로 모든 방명록(비밀번호 없는 옛 글 포함)을 수정/삭제 가능.
- 팝업: 하객이면 조종하기 왼쪽에 "수정" → 비밀번호 확인 → 이름·멘트·방명록 수정 폼 + "캐릭터 삭제". 수정하면 맵의 이름표/멘트 즉시 갱신, 삭제하면 맵에서 제거(`scene.removeGuest`). 이미지 폴더는 매일 정리 작업이 지움.

## 하객 프로필: 관계·성향·칭호·능력치
- 위저드 1단계에 신랑·신부와의 관계(필수, 칩 두 줄: 어느 쪽 `side` 신랑측·신부측·양측 + 어떤 관계 `relation` 친척·직장·친구·기타. 예전 글은 relation에 groom/bride/both → fetch-guests·화면이 side로 읽음), 2단계(캐릭터)에 성향(필수, 칩)·칭호(선택, 12자)·능력치 주사위·사진으로 AI 생성. 수정 폼에서 관계·성향·칭호는 바꿀 수 있고 능력치는 그대로.
- 목록 키는 `CONFIG.sides`/`CONFIG.relations`/`CONFIG.personalities`(한글 이름·움직임)와 `api/guestbook.js` `SIDES`/`RELATIONS`/`PERSONALITIES`가 같아야 함. 선택 칸은 `ui.js`가 CONFIG로 채움.
- 능력치 STR/DEX/INT/LUK: 각 4에서 시작해 남은 9점을 한 점씩 무작위로(`rollStats`) → 합 25, 4~13, 6 근처가 잘 나오고 끝값은 드묾. API가 범위·합 검사. 팝업에 표시만(움직임엔 영향 없음).
- 칭호: 캐릭터 머리 위 메달(`setTitle`, `CONFIG.titleStyle`). 말풍선·조종 표시는 `headY()`(칭호 위)에.
- 성향(`GuestCharacter.setPersonality`, `CONFIG.personalities`): 걷는 속도·걷기 비율·걷기/서기 시간·점프/사다리/발판 건너뛰기 확률·말풍선 간격 배율과 가끔 하는 말(`lines`). 서 있을 때 특별 동작 `idle`: sleep(엎드리기 이미지로 자기 + 얼굴 쪽에서 z 글자가 옆으로 떠오르고 가끔 콧방울 `startSleepFx`, 이미지 없으면 정면), eat(먹보: 머리 위 음식 이모지 → 입으로 쏙 → 냠! `eatSnack`), heart(얌전이: 작은 하트/꽃이 둥실), photo(카메라 플래시 + 몸 둘레 반짝이 별 6개 + 찰칵, `photoFlash`), dance(반반 랜덤: 제자리에서 방향 바꾸며 통통 / 셔플 스텝 — 한 방향으로 천천히 가며 걷기 모션만 0.24초마다 좌우로 뒤집기 `tickShuffle`), 춤추는 동안 발밑에서 음표 `tickNotes`). 그 밖에 `typing`(수다쟁이: 말풍선 전 "…" 입력 중 `typingDots`), `dust`(탐험가: 점프 착지 흙먼지 `landDust` + 걷기 시작할 때 가끔 "!"). 글자 효과는 공용 `floatText`.

## 캐릭터 만들기 위저드 (`#write-form.wizard`)
- 전체 화면 4단계: 1 이름·관계(side/relation 칩) → 2 성향 칩·칭호·능력치·사진 → AI 캐릭터 → 3 한줄 멘트·방명록(글자 수) → 4 입력 내용 확인 카드 + 비밀번호 → 등록. 위: "로비" 버튼, "n / 4", 4칸 진행 막대.
- 단계 이동은 `showStep(n)`(앞으로 = 오른쪽에서, 뒤로 = 왼쪽에서 밀려 들어옴 `slide-fwd/back`, reduced-motion이면 없음), 필수 확인은 `checkStep(n)`. 등록할 때 앞 단계에 빠진 게 있으면 그 단계로 돌아가 안내.
- 관계·성향은 선택 칸 대신 라디오 칩(`fillChips`, `data-chips`) — 캐릭터 수정 폼도 같은 칩.
- AI 생성 중에도 다음 단계로 넘어갈 수 있음 → 등록 버튼만 생성이 끝날 때까지 "캐릭터 완성 기다리는 중...".
- 글꼴: 사이트 전체 Pretendard(jsDelivr, dynamic subset). 팝업·버튼·입력칸·메뉴·토스트도 위저드와 같은 스타일(흰 머리글, 납작한 코랄 버튼, 둥근 입력칸).

## 캐릭터 조종 (일반 방문자)
- 로비(`#lobby-modal`, `UI.openLobby`): 버튼 순서 "캐릭터 만들기" → "캐릭터 접속". 이 브라우저에서 만든 캐릭터(`localStorage.myGuestIds`, 없으면 옛 `myGuestId`)가 있으면 접속 버튼, 없으면 만들기 버튼을 강조(`.hl`)하고 그 아래 안내 말풍선(`.lobby-guide`). 한 브라우저 캐릭터 생성은 최대 3개(`localStorage.createdGuests`, 삭제해도 안 줄어듦, `MAX_CREATED`) — 넘으면 작성 폼 대신 토스트. 처음 접속(로딩이 끝나면, `?dev` 제외, 로딩 화면이 걷히기 전에 열림) 때와 메뉴 맨 아래 "로비로 돌아가기"(`UI.onLobby`: 조종 놓고 관람 모드로 바꾼 뒤 로비). 맵을 가리는 전체 화면, 닫기 없음. "캐릭터 접속" → 캐릭터 선택 화면, "캐릭터 만들기" → 작성 폼(`#write-modal`, 항상 전체 화면 `.fullscreen`). 선택·작성 화면도 닫기 버튼·ESC 없이 "← 로비로" 버튼으로만 로비로 돌아감.
- 로비 예시 캐릭터(`canvas.lobby-demo`, `playDemo`): 점프·엎드리기 이미지가 있는 하객 중 무작위(없으면 신랑)의 맵 텍스처 프레임(`UI.getDemoFrames`, main.js)을 캔버스에 그려 걷기 → 점프 → 반대로 걷기 → 점프 → 엎드렸다 일어나기를 반복. 로비가 닫히면 멈춤. 로딩 화면엔 같은 높이 빈 칸(`div.lobby-demo`)이라 자리가 그대로.
- 캐릭터 선택 화면(`#select-modal`, 항상 전체 화면 `.select-screen`, `openSelect`): 처음엔 "내 캐릭터" 3칸(`.my-slots`, 이 브라우저에서 만든 캐릭터 `myCreated` = `localStorage.myGuestIds`, 지워진 캐릭터·남은 칸은 빈 칸 → 누르면 캐릭터 만들기) + "다른 캐릭터로 플레이 해보기" → 내가 만들지 않은 하객 카드 격자(이름 검색, "← 내 캐릭터"로 돌아옴). 카드 = 칭호·모습·이름·관계/성향·능력치(`charCard`). 시작하면 `myGuestId`(지금 쓰는 캐릭터 — 방명록 목록 "내 방명록")로 기억. 카드 고르고 "이 캐릭터로 시작"(또는 두 번 누르기) → `UI.onGuestPicked`가 시작점으로 옮기고(`dropAt`) 조종 + 확대. 메뉴의 방명록 목록은 보기 전용(검색 가능).
- 내 캐릭터 = 로비에서 만들거나 고른 캐릭터(main.js `mine`). 메뉴 맨 위 "모드 전환": 플레이 모드(내 캐릭터 조종, 카메라 따라감) ↔ 관람 모드(AI로 돌아다니고 화면은 처음 보기 `view.reset`, 자유롭게 구경). 글자는 `UI.setMode`로 바뀜.
- 메뉴 "캐릭터 수정": 내 캐릭터만. 등록 때 정한 비밀번호 확인 → 수정 폼(`UI.openEdit`) — 캐릭터 정보(이름·관계·성향·칭호·한줄 멘트)만, 방명록 글은 방명록 목록에서. 삭제하면 맵에서 빼고 로비로.
- 방명록 수정: 방명록 목록 맨 위 "내 방명록"(`localStorage.myGuestId`)의 "수정" → 같은 창을 `openEdit(target, {letter: true})`로 열어 비밀번호 확인 후 방명록 글만. 저장할 땐 나머지 칸도 지금 값 그대로 보냄(API update는 전부 받음) — 관계·성향이 빈 옛 글은 캐릭터 수정부터.
- 일반 방문자 캐릭터창엔 조종·수정 버튼 없음(내 캐릭터는 메뉴로만). 개발자 모드에선 테스트용으로 하객·신랑신부 조종, 하객 수정, 신랑·신부 멘트 수정 버튼이 보임.
- 신랑·신부는 개발자 모드에서만 조종 가능(일반 방문자 팝업엔 조종 버튼 없음), NPC는 불가.
- 조종 시작(`scene.control.take(캐릭터, {zoom})`) → 1배(`CONFIG.view.controlZoom`)로 줌 맞춤 + 카메라 따라감. 일반 방문자는 메뉴 "모드 전환"으로, 개발자 모드는 캐릭터창 "조종하기"로.
- 방명록 등록 직후: 새 캐릭터를 시작점(`CONFIG.spawn` = `MAP_DATA.spawn {floor, x}`, 없으면 랜덤 층)에 만들고 바로 조종 + 확대.
- PC는 방향키/Space, 터치 기기는 화면 스틱 + 점프 버튼(조종 중에만 표시). 조작 규칙은 아래 개발자 모드 조종과 같음(`GuestCharacter.tickControlled`).

## 개발자 모드 (`?dev`)
- 페이지를 `?dev`로 열면 위쪽에 편집 툴바(약 650px, 화면 너비 820px 이하면 왼쪽 위 메뉴·오른쪽 위 음악 버튼 아래로 내려감. 펼친 메뉴는 툴바 위). 발판(빨강)·사다리(초록)·로프(파랑)·무대(노랑)를 불투명 선으로 표시. 종류에 '무대'가 있어 걷기처럼 직선으로 추가·지우기(첫 조각은 `stage`, 다음부터 `stage1`…). 끝점을 붙여 그리면 이어진 무대. 무대도 걷기 영역의 일종 → 사다리/로프 끝을 무대에 연결할 수 있고, 일반 발판과 끝을 붙이면 걸어서 이어지며 점프로도 오감(하객·NPC가 따로 걷기 영역 없이 무대에 올라옴).
- 종류(걷기/사다리/로프) + 도구(이동/추가/지우기) 선택 후 지도 위를 드래그:
  - 걷기 추가: 누른 점과 뗀 점을 직선으로 잇는 새 발판(`f1`, `f2`…). 꺾인 길은 직선 여러 개로 나눠 추가.
  - 사다리/로프 추가: 세로 드래그. 양 끝이 서로 다른 발판 근처(세로 24px)면 두 발판을 잇고, **위쪽 끝만** 발판에 닿으면 아래가 허공에 매달린 사다리/로프(`{floors:[위 발판], end: 아래 끝 y}`, 끝은 가로 눈금으로 표시). 아래만 닿으면 거부.
  - 지우기: 선택한 종류만 지움. 발판 중간을 지우면 조각으로 나뉘고, 걸려 있던 사다리/로프는 x를 덮는 조각에 다시 연결(없으면 삭제). 걷기는 일반 발판만, 무대는 무대만 지움. 무대를 전부 지우는 건 막음(API도 무대 1개 이상 필수).
  - 편집 도구가 켜져 있으면 한 손가락 드래그는 편집, 두 손가락/휠은 확대. 이동 도구로 바꾸면 드래그로 지도 이동.
- 시작점 도구: 지도를 눌러 가까운 발판 위를 시작점으로(노란 깃발). 되돌리기·저장에 포함, 발판이 지워지면 그 x를 덮는 발판으로 옮기거나 해제.
- 신랑신부 고정 체크박스(툴바 둘째 줄, `CONFIG.couple.fixed`, 기본 N): Y면 자리에 서 있고, N이면 무조건 무대(stage*) 안에서만 돌아다님 → 자리도 무대 위로 한정(무대 밖으로 지정돼 있으면 무대 가운데 ±30). 되돌리기·저장에 포함.
- 신랑신부 도구: 지도를 누르면 가까운 발판(고정 N이면 무대만) 위에 신랑(누른 x-30)·신부(x+30)를 나란히(`setCouple` → `CONFIG.couple`). 되돌리기·저장에 포함. 한 명씩은 캐릭터 끌기로.
- 캐릭터 끌기(추가/지우기 도구가 아닐 때): 캐릭터를 누르고 끌면 따라오고, 놓으면 그 x를 덮는 발판 중 발 아래(위로 30px 여유) 가장 가까운 발판에 선다(`floorForDrop`, 없으면 원래 자리). 끄는 동안 `character.held`(tick 멈춤, 카메라 고정).
  - 하객·NPC는 그 자리로 옮기기만 하고 저장 안 됨(`dropAt`). 조종 중이면 조종 그대로.
  - 신랑·신부는 자리가 `CONFIG.couple` `{groom:{floor,x}, bride:{floor,x}}`에 들어가 되돌리기·저장 대상(`couplePoint(id)`, 없거나 발판이 사라지면 무대 가운데 ±30, `mainStageName()`). 고정 N이면 무대 위에만 놓을 수 있고 무대 조각들 안에서만 돌아다님(사다리 안 탐), 고정 Y면 어느 발판이든 그 자리에 서 있음.
- NPC 설정 창: 개발자 모드에서 NPC를 누르면 방명록 팝업 대신 설정 창(`UI.openNpcSettings` → `dev.openNpcSettings`). 이름(15자)·디렉토리·한줄 멘트(20자)·소개 글(500자)·배치 방식을 바꾸면 `CONFIG.npcs[id]`(= `MAP_DATA.npcs`, js/npcs.js 값을 덮어씀)에 들어가 되돌리기·저장 대상.
  - 배치(`npcMode`/`npcHome`): 고정(`fixed`, 지금 선 자리 `{floor, x}` 저장 — 끌어서 옮기면 그 자리 저장, 발판이 지워지면 x를 덮는 발판으로 옮기고 없으면 기본으로) / 랜덤(`random`, 접속할 때마다 아무 발판) / 무대에서만(`stage`, 무대 발판 안에서만 — `canStandOn`) / 기본(mode 없음, npcs.js 처음 발판. 택시처럼 `npc.fixed`면 고정).
  - 디렉토리(= NPC id) 바꾸기: `CONFIG.npcs[id].dir`로 들고 있다가 저장 때 `api/map.js`(`npcRenameFiles`)가 같은 커밋에서 `img/npc/<id>/` 파일을 `img/npc/<dir>/`로 옮기고(같은 blob), `js/npcs.js`·`scripts/gen-npc.mjs`의 `'id'` 문자열을 바꾸고, npcs 키도 바꿈. 저장 후 클라이언트도 새 id로 바꾸고 되돌리기 기록은 비움(`applyNpcRenames`). `origin.jpg`는 저장소에 없으니 로컬에서 직접 옮겨야 함.
  - 가만히 있는 NPC(움직임 이미지 없음: 택시, 가만히로 추가한 NPC, `isStaticNpc`)는 끌어 놓으면 발판과 상관없이 놓은 좌표에 고정(공중도 가능) → `{mode: 'fixed', x, y}`(floor 없음, `freeY`). 지도를 편집해도 그 자리 그대로.
  - NPC는 처음 자리가 랜덤일 때 사다리·로프에서 가로 60px(`NPC_CLIMB_CLEARANCE`) 이상 떨어진 x를 고름(`xClearOfClimbs`). 그런 자리가 없거나 걸을 폭이 40px(`NPC_MIN_SPAN`)보다 좁으면 다른 발판(`randomNpcFloor`).
- NPC 추가(툴바 "NPC 추가" → 같은 설정 창의 추가 모드): 사진(선택)·NPC 설명(무엇인지: 강아지, 택시, 탁자 위 앨범 …)·움직임(걸어다님/가만히)·키 → "캐릭터 생성"이 `POST /api/character {type:'npc-front', image?, desc}`(사진 없으면 `npc-front-noref.txt`) → 걸어다니면 정면을 기준으로 `npc-idle`·`npc-walk`를 동시에. 이름·디렉토리(= id, 영문 소문자·숫자·-) 넣고 "추가"하면 화면 가운데에 바로 등장(가만히 = 고정, 화면 가운데 발판).
  - 설정은 `CONFIG.npcs[id] = {name, …, def: {desc, height, motions}}`(되돌리기 가능, 되돌리면 맵에서도 사라짐 `syncNpcs`), 이미지는 `dev.pendingNpcImages`(스냅샷 제외). 저장 때 가로 768px webp로 줄여(`shrinkWebp`) `npcImages`로 보내면 API가 `img/npc/<id>/{front,idle,walk}.webp`로 커밋(이미 있는 폴더면 거부). 저장 전엔 디렉토리 이름 변경 불가.
  - 이미지 교체: NPC 설정 창 "이미지 새로 만들기"(설명·움직임은 지금 값으로 채워짐, 기본 NPC는 키 고정) → 새 이미지로 맵의 NPC를 다시 만들고(`replaceNpcImages`, 텍스처 키에 `imagesRev`) 저장 때 `npcImages[id].replace`로 `img/npc/<id>/`에 덮어씀. 추가한 NPC는 def(desc·height·motions)도 갱신. 기본 NPC의 특수 동작(sleep 등)은 그대로. 되돌리기 기록은 비움.
  - 캐릭터 생성(`npc-*` 타입)은 개발자 비밀번호 필요(`checkDevPassword`, 저장과 같은 sessionStorage 비밀번호 — `devPassword()`).
  - 삭제(설정 창 "NPC 삭제", 되돌리기 가능): 추가 NPC는 `CONFIG.npcs`에서 빼고 저장 때 `npcDeletes`로 보내 API가 `img/npc/<id>/`를 지움. js/npcs.js의 기본 NPC는 코드라 `{deleted: true}`로 숨기기만(이미지 남음, 다시 보이려면 map-data에서 그 항목을 지움). 맵은 `syncNpcs`가 CONFIG.npcs에 맞춰 지우고 되살림.
  - 불러올 때 `js/npcs.js` 끝에서 `def`가 있는 항목을 `customNpc()`로 NPCS에 붙임. 추가 NPC는 npcs.js·gen-npc.mjs에 없으므로 디렉토리 변경 때 폴더만 옮김.
- 앨범 사진 추가(NPC 설정 창, 분류가 앨범일 때): 사진 여러 장 고르고 "사진 올리기" → 브라우저가 긴 변 2000px JPEG로 줄여 3장씩 `POST /api/map {action:'album-photos', album, photos}` → API가 `img/gallery/<album>/<이름>.jpg`로 바로 커밋(개발자 비밀번호, 지도 저장과 별개). Actions 배포로 1~2분 뒤 앨범에 보임. 갤러리 사진만 바뀐 커밋은 Vercel 재배포 생략(`vercel.json` ignoreCommand).
- 앨범 사진 관리(NPC 설정 "사진 관리" → `#album-modal`): 저장소 목록(`album-list`)을 썸네일 격자로(썸네일은 배포된 gallery.json에서 이름으로, 막 올린 건 이름만). ◀ ▶ 순서, ✕ 지우기(다시 누르면 되살림) → 저장 `album-arrange {order, remove}` → API가 순서대로 `001_`·`002_`… 순번 이름으로 바꾸고(같은 blob) 지운 건 삭제, 한 커밋. 목록이 그 사이 바뀌었으면 409.
- NPC 분류(추가·설정 창): 일반 / 앨범. 앨범이면 앨범 디렉토리(`CONFIG.npcs[id].album`, 영문 소문자·숫자·-) → 일반 방문자가 누르면 캐릭터창 대신 그 앨범 사진. 저장 때 `img/gallery/<album>/`이 없으면 API가 `.gitkeep`을 커밋해 폴더를 만듦(사진은 직접 넣어 push). `album-studio` = `studio`.
- 신랑·신부 설정: 개발자 모드에서 신랑·신부 캐릭터창의 "수정" → NPC 설정 창을 이름·한줄 멘트·소개 글만 보이게(`textsOnly`) 열어 `CONFIG.npcs.groom/bride`에 저장(js/data.js COUPLE 값을 덮어씀, `coupleTexts`, 되돌리기·저장 대상).
  - "이미지 새로 만들기"(`regen.couple`): 사진(선택)·설명(선택, `CONFIG.npcs.<id>.desc`) → 하객과 같은 `front`(desc를 붙이면 API가 개발자 비밀번호 확인 후 프롬프트에 추가) → walk/jump/ladder/rope/prone 동시에. `replaceCoupleImages`가 새 텍스처 키(`info.texId`)로 바로 바꾸고, 저장 때 `npcImages[id].replace`로 `img/npc/<groom|bride>/*.webp`에 덮어씀(가로 1536px까지, 못 만든 동작은 기존 파일 유지).
- 조종: 상단 툴바 조종 도구는 없음 → 캐릭터 팝업의 "조종하기"로(▼ 표시, 조종 중엔 툴바 안내가 조작법으로 바뀜). 개발자 모드에선 신랑·신부 팝업에도 조종하기가 있음 — `CoupleCharacter`는 `GuestCharacter`를 상속(통통 튀기 모션). 평소엔 고정이면 제자리, 아니면 무대 위에서만 AI로 돌아다니고, 조종을 놓거나 지도를 편집하면 제자리(`couplePoint`)로 복귀. 신랑·신부의 jump/ladder/rope/prone 이미지는 `?dev`일 때만 불러옴. AI가 사다리/점프 중이던 하객은 그 자리에서 이어서 조종 → 직접 조종, 카메라가 따라감. "조종 끝내기"를 누르거나 지도를 편집하면 놓아줌(AI로 복귀).
  - ↓(잡을 사다리/로프 없을 때) = 엎드리기(↓ 떼거나 ←→면 일어섬), 엎드려서 Space = 지금 발판을 통과해 아래 발판으로 떨어짐(아래 발판이 있을 때만). 엎드리기 이미지가 없으면 점프 첫 프레임으로 대신.
  - PC: ←→ 걷기, ↑↓ 사다리/로프(아래 끝 발판에서 ↑, 위 끝 발판에서 ↓), Space 점프. 모바일: 왼쪽 아래 스틱 + 오른쪽 아래 점프 버튼.
  - 물리(`CONFIG.motion.control`): ground / air(중력, 내려올 때만 발판 착지 → 아래에서 위로는 통과) / climb. 발판 끝에서 걸어 나가면 떨어짐. 점프 중 ↑↓ + 사다리 x 근처(grabRange 14px)이고 손 높이(발 - grabHeight 40px)가 사다리 범위 안이면 매달림 → 발판에서 점프로 약 100px 위 로프 끝까지 잡힘. 매달린 로프는 손이 끝에 걸릴 때까지(발 = end + 40) 내려감. 사다리에서 ←→+Space로 옆으로 뛰어내림.
  - 스틱/버튼의 터치·마우스 이벤트는 stopPropagation → Phaser(window 리스너)가 지도 드래그·핀치로 오인하지 않게.
- 편집은 CONFIG.floors/climbs를 바로 바꾸고 `scene.refreshMap()`으로 하객에게 즉시 적용. 되돌리기 최대 50단계.
- 저장: 비밀번호(처음 한 번 입력, 탭 닫을 때까지 sessionStorage) → `POST /api/map` → `js/map-data.js` 커밋 → Pages 재배포(1~2분). Vercel은 이 파일만 바뀐 커밋은 재배포 생략.
  - Vercel 환경변수 `DEV_PASSWORD` 필요. 저장 후 로컬에서 push 전 `git pull --rebase`.

## NPC (`js/npcs.js`, `NpcCharacter`)
- 푸딩(흰 토끼, 늘 꽃가루), 얼룩말(하트 선글라스, 서 있으면 비눗방울, 걸으면 파티 블로어 + 음표), 고양이 4마리(미미·옹이·복실이·별이(흰 페르시안): 어슬렁/그루밍/자기), 에쏘(크림색 보더콜리, 랜덤 발판에서 시작해 뛰어다님, 앉아서 뒷다리로 머리 긁기), 몽실이(흰 페키니즈: 천천히 걷기, 올려다보기, 핑크 삑삑이 덤벨 물고 앉기), 택시(고정, 파스텔 웨딩 택시를 앞·옆이 함께 보이는 3/4 입체 각도로. `npc.tilt`를 주면 발판 기울기에 맞춰 기울임 — 입체 이미지라 택시는 안 씀).
- 푸딩·에쏘·고양이 4마리·몽실이는 실제 사진 `img/npc/<id>/origin.jpg` 기반으로 생성(사진은 개인 사진이라 `.gitignore`로 저장소에 안 올림 — 다시 생성하려면 로컬에 있어야 함).
- NPC 이미지는 OpenAI `background: transparent`로 생성. `removeBackground`는 네 귀퉁이가 투명한 이미지면 흰색을 지우지 않음(흰 털이 뚫리던 문제).
- `NpcCharacter extends GuestCharacter`: 점프·사다리·로프 안 씀(canJump/canClimb=false), 조종 불가(팝업에 조종 버튼 없음). 동작은 idle/walk + NPC별 특수 동작(sleep, scratch…, `states`에 비율·`<동작>Time`), NPC별 height·motionFrames·motionHeight.
- 효과는 `NpcEffect`(Phaser 파티클: 꽃잎 재사용, 비눗방울·음표 텍스처는 코드로 생성).
- NPC 디렉토리는 `<종류>-<이름>` (dog-esso, dog-mongsil, rabbit-pudding, cat-*). 한줄 멘트(shortMsg)가 있으면 하객처럼 가끔 말풍선이 뜸. 소개 글(longMsg)은 미정 → `NPC_POPUP_TBD`. 정해지면 npcs.js의 popup 수정. 처음 발판은 map-data 발판 이름이라 지도를 크게 바꾸면 확인.
- 이미지 다시 만들기: `OPENAI_API_KEY=... node scripts/gen-npc.mjs <id>` 또는 `<id>:<motion>` (sharp 필요: `npm i --no-save sharp`).

## 이벤트 NPC: 가위바위보 머신 (`rps-machine`)
- js/npcs.js `event: 'rps'` → 누르면(개발자 모드 제외) `Rps.open()`. 시작점 옆 배 갑판(`f2`, x 285) 고정, 이미지는 gen-npc.mjs `rps-machine`(움직임 없음).
- 도전: 내 캐릭터(`UI.getMine`, main.js `mine`)의 방명록 비밀번호 → `POST /api/rps {action:'start', number, id, password}`(guestbook.js `findGuest`로 확인, 관리자 비밀번호도 통과) → 서명 토큰(HMAC, `secret()`). 방금 만든 캐릭터는 number가 생기는 1~2분 뒤부터.
- `play {token, choice}`: 서버가 무작위로 내고 판정. 이기면 연승+1 새 토큰, 비기면 그대로 새 토큰(저장 안 함). 지거나 `stop`(그만하기·창 닫기)이면 GitHub Gist `rps.json` `{ records: [{id, name, streak, at, end}], burned }`에 기록(시작·끝 시각) + 토큰 nonce를 `burned`에 넣음 → 진 토큰으로 다시 내기 불가(409). gist는 조건부 쓰기가 없어서 쓰고 다시 읽어 내 nonce가 남았는지 확인, 덮였으면 다시 합쳐 씀(최대 3번).
  - 진행 중 토큰은 localStorage `rpsToken`에도 → 새로고침·ESC로 나가도 다음에 열 때 그 연승으로 기록.
  - 알려진 한계: 같은 토큰으로 동시에 여러 번 요청하면 결과를 골라낼 수 있음(라운드마다 커밋해야 막힘).
- 랭킹(`GET /api/rps?id=`): 캐릭터별 최고 연승 TOP 10(0연승 제외, 같으면 먼저 끝낸 사람), 1~3위 "☕ 쿠폰" 표시 + 그 캐릭터 최근 도전 10개. 쿠폰 지급은 수동.
- 효과(css `.rps-*`): 고르면 머신 불빛 깜빡임 + 머신 손이 빠르게 바뀜(최소 1.1초), WIN = 금빛 글자 + 번쩍임 + 색종이·하트·별(연승이 길수록 많이), DRAW = 손 부딪힘, LOSE = 무대 흔들림.
- 설정: 기록 gist = https://gist.github.com/kobe-KANG/54d5f2cf56f9e6eb09864d4c3e4ae684 (비밀 gist, api/rps.js 기본값 — 바꾸려면 Vercel `RPS_GIST_ID`). 첫 기록 때 그 gist에 `rps.json` 파일이 생김. 쓰기 토큰은 `GIST_TOKEN`(Gists 읽기/쓰기 권한), 없으면 `GITHUB_TOKEN`. 기록 정리·쿠폰 대상 확인은 gist에서 직접.

## 효과
- 꽃잎(`scene.addPetals`, `CONFIG.petals`): 코드로 그린 분홍 꽃잎 2종을 Phaser 파티클로 맵 전체 위에서 천천히 떨어뜨림(좌우 흔들림, 회전). `advance`로 시작부터 화면 곳곳에 있음. depth 15000(캐릭터 위, 개발자 모드 선 아래).
- 워프게이트(`scene.addWarpgate`, `CONFIG.warpgate`): 시작점(spawn)에 4프레임 애니메이션. 원본 `img/etc/warpgate.png`(2172x724) → 절반 크기 `warpgate.webp`(프레임 271x362) 사용. depth = 발 높이 - 1(캐릭터 뒤). 개발자 모드에서 시작점을 바꾸면 `refreshMap()`에서 따라 옮김, 시작점이 없으면 숨김.
- 배경음악(`ui.js`, `CONFIG.bgm`): 자동 재생 시도 → 브라우저가 막으면 첫 터치/클릭/키 입력 때 재생. 켜고 끔은 localStorage(`bgm`)에 기억(끄면 다음 방문에도 꺼짐). 파일 로드 실패면 버튼 숨김.

## 메뉴 / 팝업
- 왼쪽 위 메뉴 버튼 → 아래로 항목: 모드 전환, 캐릭터 수정, 방명록 목록(맨 위 "내 방명록" + 수정 버튼, 아래 "다른 하객 방명록" 최신순, 이름 검색, 누르면 방명록 창 `#letter-modal`: 모습·칭호·이름·관계/성향 + 방명록 글, 능력치·버튼 없음), 웨딩 갤러리(썸네일 → 크게 보기: 사진 좌우 가장자리 35% 터치·클릭/스와이프/방향키로 넘김, 사진 영역 높이 62vh 고정), 로비로 돌아가기.
- 방명록 목록은 `UI.getGuests()`(main.js에서 scene.guests 연결)로 맵 위 하객을 그대로 사용 → 방금 등록한 하객도 바로 보임.
- 갤러리: `img/gallery/<앨범>/` 하위 폴더 = 앨범(지금은 `studio`). 배포 때 `build-gallery.mjs`가 sharp로 `img/gallery/thumb/<앨범>/*.webp`(목록)·`view/<앨범>/*.webp`(크게 보기)를 만들고 `data/gallery.json`(`{thumb, src, album}` 목록) 생성. 메뉴 "웨딩 갤러리"는 앨범별 탭(탭 이름 = 그 앨범 NPC 이름, 없으면 폴더 이름, 앨범 1개면 탭 숨김), 앨범 NPC를 누르면 그 앨범만(`UI.openAlbum`, 창 제목 = NPC 이름). 사진이 없으면 "준비하고 있어요" 문구.
  - 원본(장당 수 MB)은 저장소에만 두고 사이트에는 올리지 않음. 변환 결과는 Actions cache(`.cache/gallery`, 이름+파일 크기 기준)라 새 사진만 변환.
- 메뉴·팝업이 떠 있는 동안 맵 입력 off(`UI.onModalChange`). 팝업이 겹치면 ESC는 맨 위 하나만 닫음.

## 하객 움직임 (`GuestCharacter`, `CONFIG.motion`, `CONFIG.climbs`)
- 상태: idle / walk / climb. 걷는 중 1초당 `jumpChance` 확률로 점프 (포물선 높이 `jumpHeight`, 이동은 계속). 점프 스트립은 포즈만 있고 높이는 코드가 준다.
- 이어진 발판(`floorContinuation`): 끝점끼리 가로 6px·세로 10px 이내면 한 길로 보고 끊김 없이 걸어서 넘어감(끝 여유 margin 없음). 개발자 모드에서 직선 여러 개로 그린 길용.
- 발판 끝 점프(`CONFIG.motion.gapJump`): 발판 끝에 닿으면 가로 틈 ≤ maxGap(60)이고 착지 높이 차가 위 maxUp(50)/아래 maxDown(100) 이내인 다른 발판으로 chance(50%) 확률로 포물선 점프해 건너감(`gapJumpTargets`, state `leap`). 겹친 아래층으로 뛰어내리기도 포함. 연결은 좌표로 자동 계산 → 개발자 모드에 보라 곡선으로 표시.
- 매달린 사다리/로프(`climbEnds()`로 위/아래 끝 계산, bottom.name = null): AI는 위 발판에서만 타고 내려가 아래 끝에서 아래 발판이 가까우면(maxDown×1.5 이내) 뛰어내리고 아니면 다시 올라감. 조종 시 아래 끝에서 ↓를 계속 누르면 손 놓고 떨어짐(놓은 뒤 0.4초는 다시 안 잡힘), 점프로 끝에 닿으면 ↑로 잡을 수 있음.
- `CONFIG.climbs`: `{type: ladder|rope, x, floors: [층A, 층B]}` — x에서 두 층을 세로로 잇는다. 걷다가 그 x를 지나가면 `climbChance` 확률로 타고 반대 층으로 이동, 이후 `climbCooldown` 동안은 다시 안 탐.
  - 층 끝 근처 사다리도 닿도록 이동 범위(minX/maxX)를 사다리 x까지 넓힌다.
  - 사다리/로프 이미지가 없으면 서로 대신 쓰고, 둘 다 없으면 정면 이미지로 오른다. 점프 이미지가 없으면 걷기 모습으로 점프.
- `?debug`에서 사다리는 초록, 로프는 파랑 세로선.

## 화면 / 확대·축소
- 캔버스 = 화면 전체 × 기기 픽셀 비율(DPR, 최대 3). `Scale.NONE` + `zoom: 1/DPR`로 CSS 축소 표시 → 고해상도 폰에서도 선명. 창 크기 바뀌면 `game.scale.resize`.
- 카메라 줌/중심은 `MapView`가 관리. 최소 = 맵 전체가 보이는 줌(플레이 모드·조종 중엔 맵 밖 배경이 안 보이게 화면을 꽉 채우는 줌, `minZoom` getter), 최대 = 맵 1px당 CSS 2.5px(`CONFIG.view.maxZoom`).
  - 기본 보기: 세로 화면은 맵 높이를 꽉 채우고 제단(`CONFIG.view.focus`) 중심, 가로 화면은 맵 전체.
  - 맵이 화면보다 작은 방향은 가운데 정렬 (Phaser 카메라 bounds 대신 직접 clamp).
- 드래그가 끝나고 손을 뗀 위치의 캐릭터는 클릭으로 처리하지 않음(`view.dragMoved`).
- Phaser `input.activePointers`는 마우스 포인터 포함 개수라 **3**이어야 두 손가락 핀치가 된다.
- 확대해도 선명하도록 텍스트는 `TEXT_RESOLUTION`(DPR×2), 이미지 스프라이트는 표시 크기의 2배(`CONFIG.sprite.textureScale`)로 만들어 축소 표시.

## 로컬 실행 / 테스트
- `index.html`을 파일로 열면 fetch 실패 → 더미 데이터로 동작.
- 실제 데이터 흐름 확인은 로컬 서버 필요 (`python -m http.server`), 이때 `data/guests.json`을 임의로 만들어 테스트.
- 이미지 에셋을 로드하게 되면 file://로는 안 되므로 로컬 서버 사용.
- API 로컬 테스트: 페이지를 `?api=<API 주소>`로 열면 해당 API 사용 (예: `vercel dev` 주소). 허용 출처에 로컬 페이지 주소가 들어 있어야 CORS 통과.

## 배포 / GitHub 설정
- 저장소: https://github.com/kobe-KANG/guestbook (브랜치 `main`)
- 사이트: https://kobe-kang.github.io/guestbook/
- API: https://guestbook-nine-drab.vercel.app/api/guestbook (Vercel, GET = 상태 확인)
- 필요한 저장소 설정: Discussions 활성화, `방명록` 카테고리(Announcement 형식 권장), Pages Source = GitHub Actions.
- API 배포: Vercel에서 이 저장소 Import(프레임워크 Other) → 환경변수 `GITHUB_TOKEN`, `GIST_TOKEN`(가위바위보 기록 gist 쓰기), `ALLOWED_ORIGINS`, `OPENAI_API_KEY`, `DEV_PASSWORD`(개발자 모드 저장·관리자 비밀번호), `GUEST_PASSWORD_SECRET`(방명록 비밀번호 해시용 비밀키) → 나온 주소를 `js/config.js`의 `apiUrl`에 설정.
  - 하객 등록마다 이미지 커밋이 생기므로 `vercel.json` `ignoreCommand`로 `img/guests/`만 바뀐 커밋은 재배포 생략, Actions push 트리거엔 `paths-ignore: img/guests/**`.
  - GITHUB_TOKEN은 이 저장소 전용 fine-grained PAT 권장 (권한: Contents 읽기/쓰기, Discussions 읽기/쓰기).
- API가 main에 직접 커밋하므로, 로컬에서 push 전에 `git pull --rebase` 필요.
- 이미지 정리(`cleanup-images.yml`): 방명록 글 본문의 id(UUID) 또는 본문에 적힌 `img/guests/<폴더>/` 경로로 참조되지 않는 폴더를 삭제 커밋.
  - API는 이미지 커밋 → Discussion 작성 순서라, 마지막 커밋이 `GRACE_HOURS`(기본 24시간) 이내인 폴더는 남긴다.
  - Discussion 조회 실패/카테고리 없음이면 예외로 끝나 아무것도 지우지 않음. 삭제돼도 git 히스토리에서 복구 가능.
  - 스케줄 워크플로는 저장소에 60일간 활동이 없으면 GitHub가 자동 비활성화함.

## 규칙
- 사용자와는 항상 한국어로 대화한다.
- 비밀값(GitHub PAT, OpenAI 키 등)은 절대 프론트엔드 코드/저장소에 넣지 않는다 → Vercel 환경변수로.
- 수정이 끝나면 묻지 않고 바로 `git commit` + `git push`(main)까지 한다. push 전 `git pull --rebase`(API가 main에 직접 커밋하므로). 커밋 메시지는 한국어로 짧게.
