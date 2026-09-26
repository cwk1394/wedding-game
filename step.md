# 1단계: 껍데기부터 만들기 (UI & 게임 엔진 세팅)

1) Phaser.js 세팅: GitHub Pages에 HTML/JS 올리고 맵 이미지 깔기.
2) 더미 데이터로 캐릭터 띄우기: 서버에서 데이터 받아왔다고 치고, 그냥 코드에 JSON 임의로 박아 넣어. 신랑/신부 가운데 고정하고, 하객 캐릭터 2~3개 맵에 띄워봐.
3) 애니메이션 & 이동: 애들이 맵 안 벗어나고 랜덤으로 뽈뽈거리고 돌아다니게 만들어. 하단에 네임태그 붙이는 거랑, 말풍선 5초 떴다 사라지는 것도 이때 다 구현해 놔.
4) 클릭 이벤트: 캐릭터 누르면 화면 가운데에 방명록 팝업(모달) 예쁘게 뜨는지 확인하고.

# 2단계: 데이터 읽어오기 (GitHub Discussions 연동)

1) 내 GitHub 저장소에 Discussions에 수동으로 글을 쓰고 프론트엔드 코드에서 GitHub GraphQL API(또는 REST API) 호출해서 긁어오기.
2) 읽어온 JSON 파싱해서 1단계에서 만든 맵 위에 캐릭터로 짜잔 하고 나타나게 연결해. (이게 성공하면 '조회' 기능 끝난 거다.)

# 3단계: 중간 다리 놓기 (Vercel Serverless Functions 뼈대)

1) Vercel 계정 파고 이 GitHub 저장소(kobe-KANG/guestbook)를 Import 해. 프레임워크는 Other, 빌드 명령 없음. 저장소 루트 `api/` 폴더에 있는 파일이 알아서 함수(`/api/...`)가 된다.
2) Vercel 프로젝트 환경변수에 GitHub Token 짱박아. (이 저장소 전용 fine-grained PAT, 권한: Contents 읽기/쓰기 + Discussions 읽기/쓰기) 허용 출처 `ALLOWED_ORIGINS`(github.io 주소)도 같이 넣어. 사이트랑 도메인이 달라서 CORS 처리 필수.
3) `worker/src/index.js`에 만들어 둔 로직을 `api/guestbook.js`로 옮겨. (입력 검증 → UUID 발급 → 이미지 한 커밋으로 `img/guests/<uuid>/`에 저장 → Discussion 작성) 옮기고 나면 `worker/` 폴더는 삭제.
4) 배포 폭탄 막아놔. 하객 등록할 때마다 이미지 커밋이 생기니까
   - `vercel.json`의 `ignoreCommand`로 `img/guests/`만 바뀐 커밋은 Vercel 재배포 건너뛰게 하고,
   - GitHub Actions 워크플로 push 트리거에 `paths-ignore: img/guests/**` 걸어서 discussion 이벤트 때만 Pages 배포되게 해.
5) 프론트 `js/config.js`의 `apiUrl`에 Vercel 주소 넣고, 작성 폼에서 '이름, 멘트' + 이미지 파일 직접 올려서 등록 테스트해.
6) 글 작성이 성공하면 맵에 캐릭터가 바로 추가되고, 1~2분 뒤 새로고침해도 (guests.json 반영돼서) 그대로 있는지 확인해.

# 4단계: 헬파티 구간 (AI 이미지 생성 파이프라인)

1) 작성 폼에 유저 사진 업로드 UI 만들어. 브라우저에서 긴 변 1024px로 줄여서 보내. (Vercel 요청 본문 4.5MB 제한)
2) Vercel 환경변수에 `OPENAI_API_KEY` 넣어.
3) 함수를 두 개로 쪼개. 한 방에 다 하면 실행 시간 제한에 걸린다. (함수별 `maxDuration` 설정 확인)
   - `api/character/front.js`: 사진 + `prompt/create-character.txt` → OpenAI 이미지 API → 정면 이미지
   - `api/character/walk.js`: 정면 이미지 + `prompt/create-character-walk.txt` → 왼쪽으로 걷는 4프레임 가로 스트립
4) 받은 이미지는 브라우저에서 이미 만들어 둔 후처리(흰 배경 제거, 크롭, 128px 축소) 태워서 미리보기로 보여줘. 마음에 안 들면 '다시 생성' 버튼.
   - 진행 상황 꼭 보여줘. "캐릭터 도트 찍는 중... (1/2)" → "걷는 모션 만드는 중... (2/2)"
5) 확정하면 3단계에서 만든 `/api/guestbook`으로 텍스트 + 후처리된 PNG 보내서 최종 저장. (UUID 발급, 저장소 커밋, Discussion 작성은 3단계 그대로)
6) 돈 새는 거 막아. AI 생성 API는 공개 주소라 아무나 호출 가능하다. 허용 출처 체크는 기본이고, 하객당 재생성 횟수 제한이나 Turnstile(캡차) 붙이는 것도 고려해.

# 5단계: 모바일 최적화 & 마무리

1) 모바일 화면에서 맵 안 잘리고 잘 나오는지 뷰포트 조절해. (캔버스 리사이징 빡세게 해라.)
2) 방명록 작성하는 UI 폼이 모바일 키보드 올라올 때 안 깨지나 확인하고.
3) 로딩 바 꼭 넣어. 4단계에서 AI가 이미지 그리는 데 몇 초 걸리니까, 그때 화면 멈춰있으면 사람들 다 뒤로 가기 누른다. "캐릭터 도트 찍는 중..." 이런 거 꼭 띄워놔.