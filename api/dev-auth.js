// 개발자 모드 진입용 비밀번호 확인 API.
// 기존 DEV_PASSWORD를 서버에서 확인한다.
// DB·Gist·GitHub에 접근하지 않으며 자료를 변경하지 않는다.
// 비밀번호나 비밀키를 응답에 포함하지 않는다.

import {
  checkDevPassword,
  handlePost,
  preflight,
} from './_lib/http.js';

export const OPTIONS = preflight;

export async function POST(request) {
  const response = await handlePost(request, async (body) => {
    // 비밀번호가 틀리거나 설정되지 않았으면 여기서 중단한다.
    checkDevPassword(body?.password);

    return {
      status: 200,
      body: {
        ok: true,
        verified: true,
      },
    };
  });

  // 인증 성공과 실패 응답 모두 캐시에 저장하지 않는다.
  response.headers.set('Cache-Control', 'no-store');

  return response;
}
