# 1. 시스템 구성 요소 (Tech Stack)

1) Frontend (호스팅 및 렌더링): GitHub Pages (순수 HTML/JS + Phaser.js 또는 Canvas API)
  - 맵 렌더링, 캐릭터 이동 애니메이션, 말풍선, 팝업 UI 처리.

2) API Proxy (보안용 중간 다리): Cloudflare Workers 또는 Vercel Functions (무료 티어)
  - 역할: ChatGPT API 키 및 GitHub Personal Access Token(PAT) 숨기기.

3) Database (방명록 및 유저 데이터): GitHub Discussions (또는 GitHub Issues) API
  - 게시글 하나가 캐릭터 한 명의 데이터(JSON)가 되는 구조.

4) Image Storage: Imgur API (무료) 또는 GitHub Issue 파일 첨부 기능 활용.


# 2. 핵심 프로세스 흐름 (Data Flow)

## [Step 1] QR 코드 접속 및 렌더링 (Read)

1) 하객이 QR을 찍으면 GitHub Pages로 접속된다.
2) 프론트엔드에서 GitHub GraphQL API를 호출해 Discussions에 쌓인 게시글들을 싹 다 긁어온다.
3) 게시글 본문에 있는 JSON 데이터(이름, 한줄 멘트, 방명록 내용, 캐릭터 이미지 URL)를 파싱한다.
4) Phaser.js 엔진이 맵 가운데에 신랑/신부 NPC를 고정으로 박고, 하객 캐릭터들을 맵 각 층에 랜덤 좌표로 스폰시킨다.
5) 캐릭터 하단에 텍스트 렌더링으로 네임태그를 달고, setInterval을 써서 랜덤한 타이밍에 한줄 멘트(10자 이하) 말풍선을 5초간 띄운다.


## [Step 2] 캐릭터 생성 및 방명록 작성 (Write)

1) 하객이 '방명록 작성' 버튼을 누르면 방명록 작성 창이 오픈된다.
2) 하객이 개인 사진을 업로드해서 캐릭터를 생성 버튼을 누르면 Cloudflare Worker(서버리스)로 보낸다.
3) Cloudflare Worker가 사진을 받아 ChatGPT API(Vision/DALL-E)를 호출해서 메이플 스타일의 정면/걷는 프레임 스프라이트 이미지를 생성해서 반환한다.
4) 하객이 추가로 이름, 한줄 멘트, 방명록 내용을 입력 후 등록 버튼을 누른다.
5) 프론트엔드가 이 데이터를 Cloudflare Worker(서버리스)로 보낸다.
6) Worker가 무료 이미지 호스팅(Imgur 등)에 올려 URL을 따온다.
7) 최종적으로 Worker가 GitHub Discussions API를 호출해서 새로운 Discussion을 하나 쓴다.

제목: [방명록] 하객 이름
본문 (JSON 형태):
JSON
{
  "name": "고정만",
  "shortMsg": "축하한다 어이!",
  "longMsg": "결혼 축하하고, 신혼여행 가서도 업무 연락은 받아라.",
  "spriteUrl": "https://imgur.com/..."
}

## [Step 3] 상호작용 (Interaction)
화면을 뽈뽈거리고 돌아다니는 캐릭터를 터치(클릭)한다.
프론트엔드 메모리에 올라와 있는 해당 캐릭터의 longMsg 데이터를 모달 팝업으로 화면 중앙에 예쁘게 띄워준다.