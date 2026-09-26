# 결혼식 온라인 방명록 (메이플스토리 컨셉)

QR로 접속 → 하객이 캐릭터 + 방명록을 등록 → 맵 위를 네임태그 달고 돌아다님.
기획/설계 원문: `concept.md`(컨셉), `architecture.md`(구성·데이터 흐름), `step.md`(단계별 진행 계획).

## 진행 상황
- [x] 1단계: Phaser 껍데기 (맵, 더미 캐릭터, 이동/네임태그/말풍선, 클릭 팝업)
- [x] 2단계: GitHub Discussions 읽기 (Actions → `guests.json` 방식)
- [x] 3단계: Vercel Serverless Functions로 방명록 쓰기 (`api/guestbook.js`). Cloudflare는 사용 안 함
- [x] 4단계: AI 스프라이트 생성 파이프라인 (`api/character.js`, 폼에서 사진 → 정면 → 걷기 순서로 생성)
- [ ] 5단계: 모바일 최적화, 로딩 UI

## 기술 스택 / 구조
- 순수 HTML/JS + Phaser 3.80.1 (jsDelivr CDN). 빌드 도구·번들러 없음, 스크립트는 전역 변수로 연결.
- `index.html`에서 스크립트 로드 순서가 의존성 순서: `map-data → config → data → textures → character → api → ui → view → scene → dev → main`.

```
index.html              오른쪽 아래 메뉴(캐릭터 생성·방명록 목록·웨딩 갤러리), 모달 DOM + 스크립트 로드
css/style.css           메이플 UI 창 스타일 모달, 버튼, 토스트
js/map-data.js          MAP_DATA: 이동 가능 영역(floors 꺾은선, climbs 사다리/로프). 개발자 모드 저장 시 API가 통째로 다시 씀
js/config.js            CONFIG: 월드 크기(=배경 이미지 1122x1402, 세로형), 배경 이미지, 층(floors) 꺾은선 좌표 + floorSpan()/floorY(), 속도, 말풍선, API 주소, AI/스프라이트 설정
js/data.js              COUPLE(고정), DUMMY_GUESTS(폴백), fetchGuests()
js/textures.js          임시 캐릭터 그리기, lookFromId(), 이미지 스프라이트 처리(removeBackground, buildSpriteCanvases, loadSpriteTextures)
js/character.js         Character(스프라이트+네임태그+말풍선) / CoupleCharacter(고정) / GuestCharacter(층 안에서 랜덤 이동)
js/api.js               resizePhoto(), generateCharacter()(AI 생성), prepareSpriteImages()(업로드용 후처리), submitGuestbook()
js/ui.js                메뉴, 방명록 팝업/목록, 웨딩 갤러리, 2단계 작성 폼(1: 이름·멘트·방명록 → 2: 사진 미리보기·AI 캐릭터 생성), 토스트. UI.onGuestCreated 콜백으로 새 하객을 맵에 즉시 추가
js/view.js              MapView: 카메라 확대/축소(핀치·휠)와 드래그 이동, DPR 상수
js/scene.js             MapScene: 임시 맵 그리기, 신랑신부/하객 스폰, addGuest(), 60초 주기 재조회
js/dev.js               DevMode: 개발자 모드(?dev) 이동 가능 영역 편집기 (추가/지우기/되돌리기/저장)
js/main.js              guests.json 로드 후 게임 시작 (실패 시 DUMMY_GUESTS)
scripts/lib/discussions.mjs  방명록 카테고리 Discussion 조회·본문 파싱 공통 코드
scripts/fetch-guests.mjs  Discussions → guests.json 변환 (Actions에서 실행)
scripts/build-gallery.mjs  img/gallery/ 사진 → 썸네일(400px)·보기용(1600px) webp + gallery.json (Actions, sharp)
scripts/cleanup-guest-images.mjs  방명록에서 참조하지 않는 img/gallery/            웨딩 갤러리 사진. 파일 이름 순으로 보임(01.jpg, 02.jpg…). 폰에서 보므로 긴 변 1600px 안팎 권장
img/guests/<uuid>/ 폴더 git rm
.github/workflows/deploy.yml  Pages 배포 워크플로
.github/workflows/cleanup-images.yml  매일 03:00 KST 고아 이미지 정리 (수동 실행 시 기본 dry run)
img/npc/<groom|bride>/   신랑신부 스프라이트. 하객과 같은 파일명(front, walk, jump, ladder, rope). 원본 png(각 1MB 안팎)는 보관용, 실제로는 webp(q0.9, 44~146KB) 사용
img/guests/<uuid>/       하객 스프라이트 (API가 커밋). front.png + 동작 스트립 walk/jump/ladder/rope.png(투명 배경, 4프레임, 높이 128, 모두 선택)
api/_lib/github.js      GitHub API 공통(GitHub 클래스: 커밋, Discussion 작성)
api/_lib/http.js        API 공통: CORS(ALLOWED_ORIGINS), JSON 응답, HttpError, handlePost(). `_` 접두사라 엔드포인트 아님
api/guestbook.js        Vercel 함수: POST 방명록 등록, GET 상태 확인. named export(GET/POST/OPTIONS) + Web Request/Response
api/character.js        Vercel 함수: POST {type: front|walk|jump|ladder|rope, image} → OpenAI 이미지 편집 API → {image: webp data URL}. 저장 안 함
api/map.js              Vercel 함수: POST {password, map} → 검증 후 js/map-data.js 커밋 (DEV_PASSWORD 필요)
package.json            "type": "module" (api/ 함수 ESM용). 의존성 없음
vercel.json             functions: api/character.js maxDuration 300초 + prompt/** 포함. ignoreCommand: img/guests/만 바뀐 커밋은 Vercel 재배포 생략. redirects: /api/ 외 경로는 GitHub Pages로 이동 (Vercel은 API 전용)
prompt/                 캐릭터/걷기 스프라이트 생성용 프롬프트 (4단계 AI 파이프라인에서 사용)
```

## 데이터 흐름 (읽기)
- 프론트에 토큰을 두지 않기 위해 **GraphQL을 브라우저에서 직접 호출하지 않는다.**
- Discussion 생성/수정/삭제 또는 main push → GitHub Actions가 `GITHUB_TOKEN`으로 `방명록` 카테고리 글을 전부 읽음 → `_site/data/guests.json` 생성 → Pages 배포 (반영까지 1~2분).
- `guests.json`은 빌드 산출물이라 저장소에 커밋하지 않는다.
- Discussion 본문 형식 (```json 코드블록으로 감싸도 됨):
  ```json
  { "id": "<uuid>", "name": "이름", "shortMsg": "10자 이하", "longMsg": "방명록 내용",
    "spriteUrl": "img/guests/<uuid>/front.png", "walkUrl": "img/guests/<uuid>/walk.png",
    "jumpUrl": "…/jump.png", "ladderUrl": "…/ladder.png", "ropeUrl": "…/rope.png" }
  ```
- `guests.json` 항목: `{ id, name, shortMsg, longMsg, spriteUrl, walkUrl, jumpUrl, ladderUrl, ropeUrl, createdAt }`. name 없거나 JSON 파싱 실패 글은 건너뜀.
- **id**: 본문의 UUID. UUID가 없는 옛 수동 글은 `d<discussion번호>`. 이름은 중복 가능하므로 식별·이미지 매핑은 항상 id로 한다.
- 이미지 주소는 https URL 또는 저장소 내부 경로(`img/...png`, `..` 금지)만 허용.

## 데이터 흐름 (쓰기)
0. (선택) AI 캐릭터 생성: 사진을 긴 변 1024px JPEG로 축소 → `POST /api/character {type:'front'}` → 정면 webp → 그걸 기준으로 `walk`(왼쪽 걷기), `jump`(왼쪽 점프 포즈, 제자리), `ladder`/`rope`(뒷모습 오르기)를 **모두 동시에(병렬)** 생성.
   - 동작 하나가 실패해도 나머지로 등록 가능. 프롬프트는 `prompt/create-character-{walk,jump,ladder-climbing,rope-climbing}.txt`.
   - 각 호출 최대 ~2분. 모델은 `OPENAI_IMAGE_MODEL`(쉼표 구분, 기본 gpt-image-2 → 1.5 → 1 순으로 시도, 없는 모델이면 다음으로), 품질 `OPENAI_IMAGE_QUALITY`(기본 medium).
   - 걷기 생성만 실패하면 정면만으로 등록 가능. 한 접속당 생성 3회 제한(`CONFIG.ai.maxGenerations`, 클라이언트 측).
   - 동작 스트립 프레임 분할(`splitFrames`): 열 무게 k-means로 프레임 중심 4개 → 붙어 있는 픽셀 덩어리 단위로 가까운 중심에 배정(두 프레임에 걸친 덩어리는 픽셀별). 긴 머리·치마가 옆 프레임에 닿아도 조각이 섞이지 않음.
   - 자른 프레임은 좌우에 `CONFIG.sprite.framePadding`(12%) 여유를 둔다. 프롬프트에도 프레임 사이 빈 간격(셀 폭 15% 이상)·좌우 여백을 요구하는 `[FRAME SPACING / SAFE MARGIN]` 섹션이 있음.
1. 브라우저: 폼 입력 + 이미지 파일 → 배경 제거·크롭·높이 128로 축소 → PNG data URL (한 장 수십 KB)
2. API `POST /api/guestbook` (Vercel 함수): 입력 검증(이름 15자, 멘트 10자, 방명록 500자, PNG 서명, 512KB 상한), 허용 출처(CORS) 확인
3. API가 `crypto.randomUUID()`로 id 발급 → Git Data API로 이미지 2장을 **한 커밋**으로 `img/guests/<uuid>/`에 올림 (브랜치가 앞서가면 최대 3회 재시도)
4. Discussion 작성 → push/discussion 이벤트로 Actions가 재배포 (1~2분)
5. 브라우저는 배포를 기다리지 않고 방금 처리한 data URL 이미지로 즉시 맵에 추가. 이후 재조회 때 같은 UUID라 중복 생성 안 됨.

## 구현 메모
- 캐릭터 컨테이너 원점(0,0) = 발 위치. 스프라이트 origin (0.5, 1).
- 누르는 영역은 스프라이트가 아니라 컨테이너에 발 기준 고정 사각형(`updateHitArea`, 정면 폭×1.3 + 네임태그). 스프라이트에 걸면 걷기·사다리 프레임 크기마다 영역이 달라져 잘 안 눌림.
- 임시 캐릭터는 오른쪽을 바라보게 그림 → 왼쪽 이동 시 `setFlipX(true)`.
- `look`이 없는 데이터는 `lookFromId(id)`로 id 해시 기반 고정 랜덤 색상.
- 배경: `img/background/background.png`(원본 3MB, 세로형 공중섬 맵) → `background.webp`(495KB)로 변환해서 사용. 월드 크기 = 이미지 원본 크기라 `CONFIG.floors`는 **이미지 픽셀 좌표 그대로**.
  - 발판은 `path: [[x, y], ...]` 꺾은선(x 오름차순). 점 사이는 직선 보간이라 계단·출렁다리 같은 기울어진 길도 표현. 하객은 걸을 때마다 `floorY()`로 발 높이와 depth를 갱신.
  - 층 13개(열기구 바구니, 배 갑판~선착장, 웰컴 무대 좌우, 윗길/가운데길/아랫길, 정자, 하트 다리, 광장 등) + `stage`(웰컴 아치 아래, 신랑/신부 전용). 오른쪽 위 웨딩 비행선은 제외. 하객은 층 가로 길이에 비례한 확률로 배치(`pickGuestFloor`).
  - 페이지를 `?debug`로 열면 발판 위치가 빨간 선으로 표시됨 → 배경을 바꾸면 이걸 보며 floors 조정.
  - 배경 이미지 로드 실패 시에만 코드로 그린 임시 맵(하늘/발판/꽃 아치) 사용.
- 첫 로딩 화면(`#loading`): 배경 이미지 + 처음 스폰한 모든 캐릭터의 이미지 적용(`Character.ready`)이 끝나면 사라짐 → 임시 캐릭터가 먼저 보이는 문제 방지.
  - 진행률 = 배경 1칸 + 캐릭터 1명당 1칸. 20초가 지나면 로딩이 덜 끝나도 메인 화면을 보여준다. 이후 재조회로 추가되는 하객은 기다리지 않음.
- 모바일에서 캐릭터 터치 직후 click이 모달 배경에 맞아 바로 닫히는 문제 → 모달 오픈 후 400ms 동안 배경 클릭 무시.
- 신랑신부 스프라이트 원본(`img/npc/*/walk.png` 등): 가로 4프레임, **왼쪽을 바라봄**, **흰 배경(투명 아님)** → 로드 시 배경 제거 + 프레임 분할 필요. 기존 임시 캐릭터와 방향이 반대인 점 주의.

## 개발자 모드 (`?dev`)
- 페이지를 `?dev`로 열면 위쪽에 편집 툴바. 발판(빨강)·사다리(초록)·로프(파랑)·stage(노랑)를 불투명 선으로 표시.
- 종류(걷기/사다리/로프) + 도구(이동/추가/지우기) 선택 후 지도 위를 드래그:
  - 걷기 추가: 누른 점과 뗀 점을 직선으로 잇는 새 발판(`f1`, `f2`…). 꺾인 길은 직선 여러 개로 나눠 추가.
  - 사다리/로프 추가: 세로 드래그. 양 끝이 서로 다른 발판 근처(세로 24px)면 두 발판을 잇고, **위쪽 끝만** 발판에 닿으면 아래가 허공에 매달린 사다리/로프(`{floors:[위 발판], end: 아래 끝 y}`, 끝은 가로 눈금으로 표시). 아래만 닿으면 거부.
  - 지우기: 선택한 종류만 지움. 발판 중간을 지우면 조각으로 나뉘고, 걸려 있던 사다리/로프는 x를 덮는 조각에 다시 연결(없으면 삭제). stage는 안 지워짐.
  - 편집 도구가 켜져 있으면 한 손가락 드래그는 편집, 두 손가락/휠은 확대. 이동 도구로 바꾸면 드래그로 지도 이동.
- 조종 도구: 하객을 눌러 선택(▼ 표시, 신랑·신부는 불가). AI가 사다리/점프 중이던 하객은 그 자리에서 이어서 조종 → 직접 조종, 카메라가 따라감. 다른 도구로 바꾸거나 지도를 편집하면 놓아줌(AI로 복귀).
  - PC: ←→ 걷기, ↑↓ 사다리/로프(아래 끝 발판에서 ↑, 위 끝 발판에서 ↓), Space 점프. 모바일: 왼쪽 아래 스틱 + 오른쪽 아래 점프 버튼.
  - 물리(`CONFIG.motion.control`): ground / air(중력, 내려올 때만 발판 착지 → 아래에서 위로는 통과) / climb. 발판 끝에서 걸어 나가면 떨어짐. 점프 중 ↑↓ + 사다리 x 근처(grabRange 14px)이고 손 높이(발 - grabHeight 40px)가 사다리 범위 안이면 매달림 → 발판에서 점프로 약 100px 위 로프 끝까지 잡힘. 매달린 로프는 손이 끝에 걸릴 때까지(발 = end + 40) 내려감. 사다리에서 ←→+Space로 옆으로 뛰어내림.
  - 스틱/버튼의 터치·마우스 이벤트는 stopPropagation → Phaser(window 리스너)가 지도 드래그·핀치로 오인하지 않게.
- 편집은 CONFIG.floors/climbs를 바로 바꾸고 `scene.refreshMap()`으로 하객에게 즉시 적용. 되돌리기 최대 50단계.
- 저장: 비밀번호(처음 한 번 입력, 탭 닫을 때까지 sessionStorage) → `POST /api/map` → `js/map-data.js` 커밋 → Pages 재배포(1~2분). Vercel은 이 파일만 바뀐 커밋은 재배포 생략.
  - Vercel 환경변수 `DEV_PASSWORD` 필요. 저장 후 로컬에서 push 전 `git pull --rebase`.

## 메뉴 / 팝업
- 오른쪽 아래 메뉴 버튼 → 위로 3개 항목: 캐릭터 생성(작성 폼), 방명록 목록(맵 위 하객 최신순, 누르면 방명록 팝업), 웨딩 갤러리(썸네일 → 크게 보기, 좌우 버튼/스와이프/방향키).
- 방명록 목록은 `UI.getGuests()`(main.js에서 scene.guests 연결)로 맵 위 하객을 그대로 사용 → 방금 등록한 하객도 바로 보임.
- 갤러리: 배포 때 `build-gallery.mjs`가 sharp로 `img/gallery/thumb/*.webp`(목록)·`view/*.webp`(크게 보기)를 만들고 `data/gallery.json`(`{thumb, src}` 목록) 생성. 사진이 없으면 "준비하고 있어요" 문구.
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
- 카메라 줌/중심은 `MapView`가 관리. 최소 = 맵 전체가 보이는 줌, 최대 = 맵 1px당 CSS 2.5px(`CONFIG.view.maxZoom`).
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
- API 배포: Vercel에서 이 저장소 Import(프레임워크 Other) → 환경변수 `GITHUB_TOKEN`, `ALLOWED_ORIGINS`, `OPENAI_API_KEY`, `DEV_PASSWORD`(개발자 모드 저장) → 나온 주소를 `js/config.js`의 `apiUrl`에 설정.
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
