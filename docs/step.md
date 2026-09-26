# 단계별 진행 계획

처음 세운 계획에서 실제 구현이 달라진 부분은 **→ 실제**로 적어 둔다.

# 1단계: 껍데기부터 만들기 (UI & 게임 엔진 세팅) ✅

1) Phaser.js 세팅: GitHub Pages에 HTML/JS 올리고 맵 이미지 깔기.
   - → 실제: 세로형 공중섬 배경 이미지(1122x1402)를 월드 크기로 쓰고, 발판을 이미지 픽셀 좌표 꺾은선으로 정의.
2) 더미 데이터로 캐릭터 띄우기: 신랑/신부 가운데 고정, 하객 캐릭터 몇 명 맵에 띄우기.
3) 애니메이션 & 이동: 맵 안 벗어나고 랜덤으로 돌아다니기, 하단 네임태그, 말풍선 5초.
   - → 실제: 점프, 발판 사이 건너뛰기, 사다리·로프 타기까지 추가.
4) 클릭 이벤트: 캐릭터 누르면 화면 가운데에 방명록 팝업(모달).

# 2단계: 데이터 읽어오기 (GitHub Discussions 연동) ✅

1) Discussions `방명록` 카테고리에 글을 쓰고 읽어오기.
   - → 실제: 브라우저에서 GraphQL을 직접 부르면 토큰이 노출되므로, GitHub Actions가 Discussions를 읽어 `data/guests.json`을 만들고 Pages에 배포하는 방식으로 변경.
2) 읽어온 JSON을 파싱해서 맵 위에 캐릭터로 띄우기. 60초마다 재조회.

# 3단계: 중간 다리 놓기 (Vercel Serverless Functions) ✅

1) Vercel에서 저장소(kobe-KANG/guestbook) Import. 프레임워크 Other, 빌드 명령 없음. `api/` 폴더 파일이 함수가 된다.
   - → 실제: Cloudflare Worker로 먼저 만들었다가 Vercel로 옮김(`worker/` 삭제).
2) Vercel 환경변수: `GITHUB_TOKEN`(fine-grained PAT, Contents·Discussions 읽기/쓰기), `ALLOWED_ORIGINS`.
3) `api/guestbook.js`: 입력 검증 → UUID 발급 → 이미지 한 커밋으로 `img/guests/<uuid>/` 저장 → Discussion 작성.
4) 배포 폭탄 막기: `vercel.json` `ignoreCommand`, Actions push 트리거 `paths-ignore: img/guests/**`.
5) `js/config.js` `apiUrl`에 Vercel 주소 설정 후 등록 테스트.
6) 등록하면 맵에 바로 추가되고, 1~2분 뒤 새로고침해도(guests.json 반영) 그대로 있는지 확인.

# 4단계: AI 이미지 생성 파이프라인 ✅

1) 작성 폼에 사진 업로드 UI. 브라우저에서 긴 변 1024px로 줄여서 보냄. (Vercel 요청 본문 4.5MB 제한)
2) Vercel 환경변수 `OPENAI_API_KEY`.
3) 실행 시간 제한 때문에 호출을 나눔.
   - → 실제: 함수 하나(`api/character.js`)에 `type`으로 구분. `front` 먼저, 그다음 `walk`·`jump`·`ladder`·`rope`·`prone`을 동시에 생성.
   - 사진 없이도 무작위 특징으로 생성 가능.
4) 받은 이미지는 브라우저에서 후처리(배경 제거, 프레임 분할, 크기 맞춤, 128px 축소) 후 미리보기.
   - 진행 문구: "캐릭터 도트 찍는 중... (1/2)" → "움직임 만드는 중... (2/2)" + 경과 시간
5) 확정하면 `/api/guestbook`으로 텍스트 + 후처리된 PNG 보내서 저장.
6) 비용 보호: 허용 출처 체크 + 접속당 생성 3회 제한. (Turnstile은 아직 안 붙임)

# 추가로 한 것 (계획 밖)

- 캐릭터 직접 조종 (PC 방향키/Space, 폰 스틱·점프 버튼), 등록 직후 시작점 워프게이트에서 바로 조종
- 방명록 비밀번호로 수정·삭제, 관리자 비밀번호(`DEV_PASSWORD`)
- 개발자 모드(`?dev`): 발판·사다리·로프·시작점 편집 후 `api/map.js`로 저장
- NPC: 반려동물·동물·웨딩 택시 (`scripts/gen-npc.mjs`로 이미지 생성)
- 꽃잎 효과, 배경음악, 메뉴(캐릭터 생성·방명록 목록·웨딩 갤러리)
- 매일 고아 하객 이미지 정리 워크플로

# 5단계: 모바일 최적화 & 마무리 (진행 중)

1) 모바일 화면에서 맵이 잘리지 않게 뷰포트 조절.
   - ✅ 캔버스 = 화면 × DPR(최대 3), 핀치/휠 확대·축소, 드래그 이동, 세로 화면은 제단 중심 기본 보기.
2) 방명록 작성 폼이 모바일 키보드가 올라올 때 깨지지 않는지 확인.
3) 로딩 UI.
   - ✅ 첫 로딩 화면(배경 + 처음 캐릭터 이미지 진행률, 최대 20초), AI 생성 진행 문구.
4) 결혼식 전 최종 점검: 실제 폰(iOS/Android)에서 등록·조종·갤러리 흐름, QR 코드 출력.
