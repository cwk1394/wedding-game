# 1. 시스템 구성 요소 (Tech Stack)

1) Frontend (호스팅 및 렌더링): GitHub Pages (순수 HTML/JS + Phaser.js)
  - 맵 렌더링, 캐릭터 이동 애니메이션, 말풍선, 팝업 UI, 방명록 작성 폼.
  - 캐릭터 이미지 후처리(흰 배경 제거, 크롭, 축소)도 브라우저 Canvas에서 처리.

2) API (보안용 중간 다리): Vercel Serverless Functions (Hobby 무료 티어)
  - 역할: OpenAI API 키 및 GitHub Personal Access Token(PAT) 숨기기.
  - 저장소 루트의 `api/` 폴더 파일이 그대로 엔드포인트가 된다. (예: `api/guestbook.js` → `/api/guestbook`)
  - 비밀값은 Vercel 프로젝트 환경변수로만 관리: `GITHUB_TOKEN`, `OPENAI_API_KEY`.
  - 사이트(github.io)와 도메인이 다르므로 CORS 허용 출처를 환경변수(`ALLOWED_ORIGINS`)로 관리.

3) Database (방명록 및 유저 데이터): GitHub Discussions (`방명록` 카테고리)
  - 게시글 하나가 하객 한 명의 데이터(JSON)가 되는 구조.
  - 하객은 **UUID**로 구분한다. (이름은 중복될 수 있음)

4) Image Storage: GitHub 저장소 (`img/guests/<uuid>/`)
  - Vercel 함수가 이미지를 저장소에 커밋 → GitHub Pages로 같은 도메인에서 서빙.
  - 외부 이미지 호스팅(Imgur 등) 불필요, CORS 문제 없음.

5) Build/Deploy: GitHub Actions
  - Discussion 생성/수정/삭제 또는 main push 시 전체 방명록을 읽어 `data/guests.json`을 만들고 Pages에 배포.
  - 브라우저는 토큰 없이 정적 파일(`guests.json`)만 읽는다.


# 2. 핵심 프로세스 흐름 (Data Flow)

## [Step 1] QR 코드 접속 및 렌더링 (Read)

1) 하객이 QR을 찍으면 GitHub Pages로 접속된다.
2) 프론트엔드가 `data/guests.json`을 불러온다. (GitHub Actions가 Discussions를 긁어 미리 만들어 둔 파일)
   - 브라우저에서 GitHub API를 직접 호출하지 않는다. (GraphQL은 읽기에도 토큰이 필요하고, 토큰을 프론트에 둘 수 없음)
3) 하객 데이터(UUID, 이름, 한줄 멘트, 방명록 내용, 캐릭터 이미지 경로)를 파싱한다.
4) Phaser.js 엔진이 맵 가운데에 신랑/신부 NPC를 고정으로 박고, 하객 캐릭터들을 맵 각 층에 랜덤 좌표로 스폰시킨다.
5) 캐릭터 하단에 네임태그를 달고, 랜덤한 타이밍에 한줄 멘트(10자 이하) 말풍선을 5초간 띄운다.
6) 60초마다 `guests.json`을 다시 읽어 새로 등록된 하객을 추가한다. (UUID로 중복 판별)


## [Step 2] 캐릭터 생성 및 방명록 작성 (Write)

1) 하객이 '방명록 작성' 버튼을 누르면 방명록 작성 창이 오픈된다.
2) 하객이 개인 사진을 업로드하고 '캐릭터 생성' 버튼을 누른다.
   - 브라우저에서 사진을 긴 변 1024px 정도로 줄여서 보낸다. (Vercel 요청 본문 4.5MB 제한)
3) Vercel 함수가 OpenAI 이미지 API를 호출해 메이플 스타일 캐릭터를 만든다. 실행 시간 제한 때문에 두 번에 나눠 호출한다.
   - `POST /api/character/front`: 사진 + `prompt/create-character.txt` → 정면 이미지
   - `POST /api/character/walk`: 정면 이미지 + `prompt/create-character-move.txt` → 왼쪽으로 걷는 4프레임 가로 스트립
4) 브라우저가 받은 이미지를 후처리(흰 배경 제거, 크롭, 높이 128px 축소)해서 미리보기로 보여준다. 마음에 안 들면 다시 생성.
5) 하객이 이름, 한줄 멘트, 방명록 내용을 입력 후 등록 버튼을 누른다.
6) 프론트엔드가 텍스트 + 후처리된 PNG(각 수십 KB)를 `POST /api/guestbook`으로 보낸다.
7) Vercel 함수가 처리한다.
   - 입력 검증 (이름·한줄 멘트 10자, 방명록 500자, PNG 여부, 크기 상한, 허용 출처)
   - `crypto.randomUUID()`로 하객 UUID 발급 (클라이언트가 보낸 값은 쓰지 않음)
   - GitHub Git Data API로 이미지 2장을 **한 커밋**으로 `img/guests/<uuid>/front.png`, `walk.png`에 저장
   - GitHub Discussions API로 새 Discussion 작성
8) 프론트엔드는 배포(1~2분)를 기다리지 않고 방금 만든 이미지로 캐릭터를 즉시 맵에 추가한다.

Discussion 형식

제목: [방명록] 하객 이름

본문 (JSON 형태):
```json
{
  "id": "59b27a0a-2daf-4a28-99c4-ad81162608f3",
  "name": "고정만",
  "shortMsg": "축하한다 어이!",
  "longMsg": "결혼 축하하고, 신혼여행 가서도 업무 연락은 받아라.",
  "spriteUrl": "img/guests/59b27a0a-2daf-4a28-99c4-ad81162608f3/front.png",
  "walkUrl": "img/guests/59b27a0a-2daf-4a28-99c4-ad81162608f3/walk.png"
}
```

## [Step 3] 상호작용 (Interaction)
화면을 뽈뽈거리고 돌아다니는 캐릭터를 터치(클릭)한다.
프론트엔드 메모리에 올라와 있는 해당 캐릭터의 longMsg 데이터를 모달 팝업으로 화면 중앙에 예쁘게 띄워준다.


# 3. 주의사항

- **Vercel 자동 배포 횟수**: Vercel은 저장소 push마다 재배포하는데, 하객 등록마다 이미지 커밋이 생기므로 Hobby 한도(하루 배포 횟수)에 걸릴 수 있다.
  → `vercel.json`의 `ignoreCommand`로 `img/guests/`만 바뀐 커밋은 배포를 건너뛴다.
- **GitHub Actions 중복 배포**: 등록 1건에 push(이미지 커밋) + discussion 이벤트가 둘 다 발생한다.
  → 워크플로 push 트리거에 `paths-ignore: img/guests/**`를 걸어 discussion 이벤트 쪽만 배포하게 한다.
- **함수 실행 시간**: AI 이미지 생성은 수십 초가 걸릴 수 있다. 함수별 `maxDuration` 설정과 요금제 상한을 확인한다.
- **비용/남용 방지**: 쓰기 API는 공개 주소라 누구나 호출할 수 있다. 특히 AI 생성은 호출마다 비용이 든다.
  → 허용 출처 확인 + 필요 시 Turnstile(캡차), 하객당 재생성 횟수 제한.
- **로컬 push 전 `git pull --rebase`**: Vercel 함수가 main에 직접 커밋한다.
