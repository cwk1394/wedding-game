# 결혼식 온라인 방명록 (메이플스토리 컨셉)

QR로 접속 → 하객이 캐릭터 + 방명록을 등록 → 맵 위를 네임태그 달고 돌아다님.
기획/설계 원문: `concept.md`(컨셉), `architecture.md`(구성·데이터 흐름), `step.md`(단계별 진행 계획).

## 진행 상황
- [x] 1단계: Phaser 껍데기 (맵, 더미 캐릭터, 이동/네임태그/말풍선, 클릭 팝업)
- [x] 2단계: GitHub Discussions 읽기 (Actions → `guests.json` 방식)
- [ ] 3단계: Cloudflare Worker로 방명록 쓰기
- [ ] 4단계: AI 스프라이트 생성 파이프라인
- [ ] 5단계: 모바일 최적화, 로딩 UI

## 기술 스택 / 구조
- 순수 HTML/JS + Phaser 3.80.1 (jsDelivr CDN). 빌드 도구·번들러 없음, 스크립트는 전역 변수로 연결.
- `index.html`에서 스크립트 로드 순서가 의존성 순서: `config → data → textures → character → ui → scene → main`.

```
index.html              모달/버튼 DOM + 스크립트 로드
css/style.css           메이플 UI 창 스타일 모달, 버튼, 토스트
js/config.js            CONFIG: 월드 크기(1280x720), 층(floors) 좌표, 속도, 말풍선 타이밍, 재조회 주기
js/data.js              COUPLE(고정), DUMMY_GUESTS(폴백), fetchGuests()
js/textures.js          임시 캐릭터를 Graphics로 그려 텍스처 생성 (프레임 0=서기, 1=걷기), lookFromId()
js/character.js         Character(스프라이트+네임태그+말풍선) / CoupleCharacter(고정) / GuestCharacter(층 안에서 랜덤 이동)
js/ui.js                UI.openGuestbook(), UI.showToast()
js/scene.js             MapScene: 임시 맵 그리기, 신랑신부/하객 스폰, addGuest(), 60초 주기 재조회
js/main.js              guests.json 로드 후 게임 시작 (실패 시 DUMMY_GUESTS)
scripts/fetch-guests.mjs  Discussions → guests.json 변환 (Actions에서 실행)
.github/workflows/deploy.yml  Pages 배포 워크플로
img/characters/         캐릭터 스프라이트 (groom/bride = 신랑신부, character1 = 예시 하객). *_move.png = 걷기 4프레임
prompt/                 캐릭터/걷기 스프라이트 생성용 프롬프트 (4단계 AI 파이프라인에서 사용)
```

## 데이터 흐름 (읽기)
- 프론트에 토큰을 두지 않기 위해 **GraphQL을 브라우저에서 직접 호출하지 않는다.**
- Discussion 생성/수정/삭제 또는 main push → GitHub Actions가 `GITHUB_TOKEN`으로 `방명록` 카테고리 글을 전부 읽음 → `_site/data/guests.json` 생성 → Pages 배포 (반영까지 1~2분).
- `guests.json`은 빌드 산출물이라 저장소에 커밋하지 않는다.
- Discussion 본문 형식 (```json 코드블록으로 감싸도 됨):
  ```json
  { "name": "이름", "shortMsg": "10자 이하", "longMsg": "방명록 내용", "spriteUrl": null }
  ```
- `guests.json` 항목: `{ id: "d<discussion번호>", name, shortMsg, longMsg, spriteUrl, createdAt }`. name 없거나 JSON 파싱 실패 글은 건너뜀.

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

## 배포 / GitHub 설정
- 저장소: https://github.com/kobe-KANG/guestbook (브랜치 `main`)
- 사이트: https://kobe-kang.github.io/guestbook/
- 필요한 저장소 설정: Discussions 활성화, `방명록` 카테고리(Announcement 형식 권장), Pages Source = GitHub Actions.

## 규칙
- 사용자와는 항상 한국어로 대화한다.
- 비밀값(GitHub PAT, OpenAI 키 등)은 절대 프론트엔드 코드/저장소에 넣지 않는다 → Worker 환경변수로.
