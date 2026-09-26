# 1. 시스템 구성 요소 (Tech Stack)

1) Frontend (호스팅 및 렌더링): GitHub Pages (순수 HTML/JS + Phaser 3.80.1, 빌드 도구 없음)
  - 맵 렌더링, 캐릭터 이동·조종, 말풍선, 팝업 UI, 방명록 작성 폼, 웨딩 갤러리.
  - AI가 그린 이미지 후처리(배경 제거, 프레임 분할, 크기 맞춤, 높이 128px 축소)도 브라우저 Canvas에서 처리.

2) API (보안용 중간 다리): Vercel Serverless Functions (Hobby 무료 티어)
  - 역할: OpenAI API 키, GitHub Personal Access Token(PAT), 비밀번호 비밀키 숨기기.
  - 저장소 루트의 `api/` 폴더 파일이 그대로 엔드포인트가 된다. (`_lib/`처럼 `_` 접두사는 엔드포인트 아님)
    - `api/character.js` → `/api/character`: AI 캐릭터 이미지 생성 (저장 안 함)
    - `api/guestbook.js` → `/api/guestbook`: 방명록 등록·확인·수정·삭제, GET은 상태 확인
    - `api/map.js` → `/api/map`: 개발자 모드에서 편집한 이동 가능 영역(`js/map-data.js`) 저장
  - 비밀값은 Vercel 프로젝트 환경변수로만 관리: `GITHUB_TOKEN`, `OPENAI_API_KEY`, `DEV_PASSWORD`, `GUEST_PASSWORD_SECRET`.
  - 사이트(github.io)와 도메인이 다르므로 CORS 허용 출처를 환경변수(`ALLOWED_ORIGINS`)로 관리.
  - Vercel은 API 전용이라 `/api/` 외 경로는 GitHub Pages로 리다이렉트한다.

3) Database (방명록 및 유저 데이터): GitHub Discussions (`방명록` 카테고리)
  - 게시글 하나가 하객 한 명의 데이터(JSON)가 되는 구조.
  - 하객은 **UUID**로 구분한다. (이름은 중복될 수 있음)

4) Image Storage: GitHub 저장소 (`img/guests/<uuid>/`)
  - Vercel 함수가 이미지를 저장소에 커밋 → GitHub Pages로 같은 도메인에서 서빙.
  - 외부 이미지 호스팅(Imgur 등) 불필요, CORS 문제 없음.
  - 방명록에서 참조하지 않는 폴더는 매일 정리 작업(`cleanup-images.yml`)이 지운다.

5) Build/Deploy: GitHub Actions (`deploy.yml`)
  - Discussion 생성/수정/삭제 또는 main push 시 전체 방명록을 읽어 `data/guests.json`을 만들고 Pages에 배포.
  - 웨딩 갤러리 사진(`img/gallery/`)은 sharp로 썸네일·보기용 webp와 `data/gallery.json`을 만든다.
  - 브라우저는 토큰 없이 정적 파일(`guests.json`, `gallery.json`)만 읽는다.


# 2. 핵심 프로세스 흐름 (Data Flow)

## [Step 1] QR 코드 접속 및 렌더링 (Read)

1) 하객이 QR을 찍으면 GitHub Pages로 접속된다.
2) 프론트엔드가 `data/guests.json`을 불러온다. (GitHub Actions가 Discussions를 긁어 미리 만들어 둔 파일, 실패하면 더미 데이터)
   - 브라우저에서 GitHub API를 직접 호출하지 않는다. (GraphQL은 읽기에도 토큰이 필요하고, 토큰을 프론트에 둘 수 없음)
3) 하객 데이터(UUID, Discussion 번호, 이름, 한줄 멘트, 방명록 내용, 정면·동작 이미지 경로)를 파싱한다.
4) Phaser가 배경 맵을 깔고, 웰컴 무대에 신랑/신부를 두고(개발자 모드 고정 체크박스: Y면 제자리, N이면 무대 안에서만 돌아다님), 하객 캐릭터들을 층(발판) 가로 길이에 비례한 확률로 랜덤 배치한다. NPC도 정해진 발판에 배치한다.
5) 배경과 처음 캐릭터들의 이미지가 모두 적용되면 로딩 화면을 걷는다. (최대 20초)
6) 캐릭터 하단에 네임태그를 달고, 랜덤한 타이밍에 한줄 멘트 말풍선을 5초간 띄운다.
7) 60초마다 `guests.json`을 다시 읽어 새로 등록된 하객을 추가한다. (UUID로 중복 판별)


## [Step 2] 캐릭터 생성 및 방명록 작성 (Write)

1) 하객이 메뉴 → '캐릭터 생성'을 누르면 2단계 작성 폼이 열린다.
   - 1단계: 이름(15자), 한줄 멘트(10자), 방명록(500자), 비밀번호(4~30자)
   - 2단계: 사진 선택(선택 사항) → 'AI 캐릭터 생성'
2) 브라우저가 사진을 긴 변 1024px JPEG로 줄여서 보낸다. (Vercel 요청 본문 4.5MB 제한)
3) Vercel 함수 `POST /api/character {type, image}`가 OpenAI 이미지 API를 호출한다. 호출마다 최대 ~2분이라 나눠서 부른다.
   - `front`: 사진 + `prompt/create-character.txt` → 정면 이미지 (사진이 없으면 `create-character-noref.txt` + 무작위 특징)
   - 정면 이미지를 기준으로 `walk`, `jump`, `ladder`, `rope`, `prone`을 **동시에** 생성 → 동작별 가로 프레임 스트립
   - 모든 프롬프트는 "왼쪽을 바라보고 왼쪽으로 이동"과 "손에 드는 소지품 금지"를 강제한다.
   - 동작 하나가 실패해도 나머지로 등록할 수 있다. 한 접속당 생성 3회 제한.
4) 브라우저가 받은 이미지를 후처리해서 미리보기로 보여준다.
   - 배경 제거 → 프레임 분할(k-means + 픽셀 덩어리 단위) → 발 기준 정렬 → 정면 머리 폭에 맞춰 크기 통일 → 높이 128px PNG
5) 등록을 누르면 텍스트 + 후처리된 PNG(각 수십 KB)를 `POST /api/guestbook`으로 보낸다.
6) Vercel 함수가 처리한다.
   - 입력 검증 (글자 수, PNG 서명, 512KB 상한, 허용 출처)
   - `crypto.randomUUID()`로 하객 UUID 발급 (클라이언트가 보낸 값은 쓰지 않음)
   - GitHub Git Data API로 이미지를 **한 커밋**으로 `img/guests/<uuid>/`에 저장 (브랜치가 앞서가면 최대 3회 재시도)
   - 비밀번호는 `salt:HMAC-SHA256(비밀키, salt:비밀번호)`로만 저장
   - GitHub Discussions API로 새 Discussion 작성 → Actions가 1~2분 뒤 재배포
7) 프론트엔드는 배포를 기다리지 않고 방금 만든 이미지로 캐릭터를 시작점(워프게이트)에 즉시 추가하고 바로 조종하게 한다.

Discussion 형식

제목: [방명록] 하객 이름

본문 (JSON 형태, ```json 코드블록으로 감싸도 됨):
```json
{
  "id": "59b27a0a-2daf-4a28-99c4-ad81162608f3",
  "name": "고정만",
  "shortMsg": "축하한다 어이!",
  "longMsg": "결혼 축하하고, 신혼여행 가서도 업무 연락은 받아라.",
  "spriteUrl": "img/guests/59b27a0a-2daf-4a28-99c4-ad81162608f3/front.png",
  "walkUrl": "img/guests/59b27a0a-2daf-4a28-99c4-ad81162608f3/walk.png",
  "jumpUrl": "…/jump.png",
  "ladderUrl": "…/ladder.png",
  "ropeUrl": "…/rope.png",
  "pw": "salt:hash"
}
```
- 본문에 없는 동작 이미지도 `img/guests/<uuid>/<동작>.png`가 저장소에 있으면 Actions가 채운다. (`prone` 등 나중에 추가한 동작)
- `guests.json`에는 Discussion 번호(`number`)가 들어가고 `pw`는 빠진다.


## [Step 3] 상호작용 (Interaction)

1) 돌아다니는 캐릭터를 터치(클릭)하면 그 캐릭터의 방명록을 팝업으로 띄운다.
2) 팝업의 '조종하기'를 누르면 확대되며 카메라가 따라가고, 방향키/Space(폰: 스틱·점프 버튼)로 걷기·점프·사다리·로프·엎드리기를 할 수 있다.
3) 하객 팝업의 '수정'을 누르면 비밀번호 확인 후 이름·멘트·방명록 수정 또는 캐릭터 삭제 → `POST /api/guestbook {action: verify|update|delete}`.
4) 맵은 핀치/휠로 확대·축소, 드래그로 이동한다.
5) 메뉴의 '방명록 목록'은 맵 위 하객을 최신순으로, '웨딩 갤러리'는 사진을 넘겨 본다.


## [Step 4] 개발자 모드 (`?dev`)

1) 이동 가능 영역(발판·사다리·로프)과 시작점을 지도 위에서 그리고 지운다.
2) 신랑·신부를 포함한 캐릭터를 직접 조종해 본다.
3) 저장하면 `POST /api/map`(`DEV_PASSWORD`)이 `js/map-data.js`를 커밋 → Pages 재배포.


# 3. 주의사항

- **Vercel 자동 배포 횟수**: Vercel은 저장소 push마다 재배포하는데, 하객 등록마다 이미지 커밋이 생기므로 Hobby 한도(하루 배포 횟수)에 걸릴 수 있다.
  → `vercel.json`의 `ignoreCommand`로 `img/guests/`, `js/map-data.js`만 바뀐 커밋은 배포를 건너뛴다.
- **GitHub Actions 중복 배포**: 등록 1건에 push(이미지 커밋) + discussion 이벤트가 둘 다 발생한다.
  → 워크플로 push 트리거에 `paths-ignore: img/guests/**`를 걸어 discussion 이벤트 쪽만 배포하게 한다.
- **함수 실행 시간**: AI 이미지 생성은 호출당 최대 ~2분. `api/character.js`는 `maxDuration` 300초.
- **비용/남용 방지**: 쓰기 API는 공개 주소라 누구나 호출할 수 있다. 특히 AI 생성은 호출마다 비용이 든다.
  → 허용 출처 확인 + 접속당 생성 3회 제한(클라이언트 측). 필요하면 Turnstile(캡차) 추가.
- **비밀번호 비밀키**: `GUEST_PASSWORD_SECRET`을 바꾸면 기존 방명록 비밀번호가 전부 무효가 된다.
- **로컬 push 전 `git pull --rebase`**: Vercel 함수가 main에 직접 커밋한다.
