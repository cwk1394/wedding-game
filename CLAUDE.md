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
- `index.html`에서 스크립트 로드 순서가 의존성 순서: `config → data → textures → character → api → ui → scene → main`.

```
index.html              모달/버튼 DOM + 스크립트 로드
css/style.css           메이플 UI 창 스타일 모달, 버튼, 토스트
js/config.js            CONFIG: 월드 크기(1280x720), 층(floors) 좌표, 속도, 말풍선 타이밍, 재조회 주기
js/data.js              COUPLE(고정), DUMMY_GUESTS(폴백), fetchGuests()
js/textures.js          임시 캐릭터 그리기, lookFromId(), 이미지 스프라이트 처리(removeBackground, buildSpriteCanvases, loadSpriteTextures)
js/character.js         Character(스프라이트+네임태그+말풍선) / CoupleCharacter(고정) / GuestCharacter(층 안에서 랜덤 이동)
js/api.js               resizePhoto(), generateCharacter()(AI 생성), prepareSpriteImages()(업로드용 후처리), submitGuestbook()
js/ui.js                방명록 팝업, 작성 폼, 토스트. UI.onGuestCreated 콜백으로 새 하객을 맵에 즉시 추가
js/scene.js             MapScene: 임시 맵 그리기, 신랑신부/하객 스폰, addGuest(), 60초 주기 재조회
js/main.js              guests.json 로드 후 게임 시작 (실패 시 DUMMY_GUESTS)
scripts/fetch-guests.mjs  Discussions → guests.json 변환 (Actions에서 실행)
.github/workflows/deploy.yml  Pages 배포 워크플로
img/characters/         캐릭터 스프라이트 (groom/bride = 신랑신부, character1 = 예시 하객). *_move.png = 걷기 4프레임
img/guests/<uuid>/       하객 스프라이트 (API가 커밋). front.png, walk.png(투명 배경, 4프레임 스트립, 높이 128)
api/_lib/http.js        API 공통: CORS(ALLOWED_ORIGINS), JSON 응답, HttpError, handlePost(). `_` 접두사라 엔드포인트 아님
api/guestbook.js        Vercel 함수: POST 방명록 등록, GET 상태 확인. named export(GET/POST/OPTIONS) + Web Request/Response
api/character.js        Vercel 함수: POST {type: front|walk, image} → OpenAI 이미지 편집 API → {image: webp data URL}. 저장 안 함
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
    "spriteUrl": "img/guests/<uuid>/front.png", "walkUrl": "img/guests/<uuid>/walk.png" }
  ```
- `guests.json` 항목: `{ id, name, shortMsg, longMsg, spriteUrl, walkUrl, createdAt }`. name 없거나 JSON 파싱 실패 글은 건너뜀.
- **id**: 본문의 UUID. UUID가 없는 옛 수동 글은 `d<discussion번호>`. 이름은 중복 가능하므로 식별·이미지 매핑은 항상 id로 한다.
- 이미지 주소는 https URL 또는 저장소 내부 경로(`img/...png`, `..` 금지)만 허용.

## 데이터 흐름 (쓰기)
0. (선택) AI 캐릭터 생성: 사진을 긴 변 1024px JPEG로 축소 → `POST /api/character {type:'front'}` → 정면 webp → 그걸로 `{type:'walk'}` → 걷기 스트립.
   - 각 호출 최대 ~2분. 모델은 `OPENAI_IMAGE_MODEL`(쉼표 구분, 기본 gpt-image-2 → 1.5 → 1 순으로 시도, 없는 모델이면 다음으로), 품질 `OPENAI_IMAGE_QUALITY`(기본 medium).
   - 걷기 생성만 실패하면 정면만으로 등록 가능. 한 접속당 생성 3회 제한(`CONFIG.ai.maxGenerations`, 클라이언트 측).
   - 걷기 스트립 프레임 분할: 투명 세로줄 기준으로 캐릭터 덩어리를 찾아 정확히 4개면 사용, 아니면 균등 분할(`findFrameCells`).
1. 브라우저: 폼 입력 + 이미지 파일 → 배경 제거·크롭·높이 128로 축소 → PNG data URL (한 장 수십 KB)
2. API `POST /api/guestbook` (Vercel 함수): 입력 검증(이름·멘트 10자, 방명록 500자, PNG 서명, 512KB 상한), 허용 출처(CORS) 확인
3. API가 `crypto.randomUUID()`로 id 발급 → Git Data API로 이미지 2장을 **한 커밋**으로 `img/guests/<uuid>/`에 올림 (브랜치가 앞서가면 최대 3회 재시도)
4. Discussion 작성 → push/discussion 이벤트로 Actions가 재배포 (1~2분)
5. 브라우저는 배포를 기다리지 않고 방금 처리한 data URL 이미지로 즉시 맵에 추가. 이후 재조회 때 같은 UUID라 중복 생성 안 됨.

## 구현 메모
- 캐릭터 컨테이너 원점(0,0) = 발 위치. 스프라이트 origin (0.5, 1).
- 임시 캐릭터는 오른쪽을 바라보게 그림 → 왼쪽 이동 시 `setFlipX(true)`.
- `look`이 없는 데이터는 `lookFromId(id)`로 id 해시 기반 고정 랜덤 색상.
- 맵 이미지가 생기면 `CONFIG.mapImage`에 경로 지정 + `CONFIG.floors` 좌표를 이미지 발판에 맞춰 수정. `stage` 층은 신랑/신부 전용.
- 모바일에서 캐릭터 터치 직후 click이 모달 배경에 맞아 바로 닫히는 문제 → 모달 오픈 후 400ms 동안 배경 클릭 무시.
- 4단계 스프라이트 예시(`img/characters/*_move.png`): 가로 4프레임, **왼쪽을 바라봄**, **흰 배경(투명 아님)** → 로드 시 배경 제거 + 프레임 분할 필요. 기존 임시 캐릭터와 방향이 반대인 점 주의.

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
- API 배포: Vercel에서 이 저장소 Import(프레임워크 Other) → 환경변수 `GITHUB_TOKEN`, `ALLOWED_ORIGINS`(4단계에 `OPENAI_API_KEY`) → 나온 주소를 `js/config.js`의 `apiUrl`에 설정.
  - 하객 등록마다 이미지 커밋이 생기므로 `vercel.json` `ignoreCommand`로 `img/guests/`만 바뀐 커밋은 재배포 생략, Actions push 트리거엔 `paths-ignore: img/guests/**`.
  - GITHUB_TOKEN은 이 저장소 전용 fine-grained PAT 권장 (권한: Contents 읽기/쓰기, Discussions 읽기/쓰기).
- API가 main에 직접 커밋하므로, 로컬에서 push 전에 `git pull --rebase` 필요.

## 규칙
- 사용자와는 항상 한국어로 대화한다.
- 비밀값(GitHub PAT, OpenAI 키 등)은 절대 프론트엔드 코드/저장소에 넣지 않는다 → Vercel 환경변수로.
