// 초기 DB 접속 확인 도구 비활성화.
// DB에 접속하지 않으며, 게임 기록·연락처를 읽거나 변경하지 않는다.
import {
  HttpError,
  checkDevPassword,
  handlePost,
  preflight,
} from './_lib/http.js';

export const OPTIONS = preflight;

export function POST(request) {
  return handlePost(request, async (body) => {
    checkDevPassword(body?.password);

    throw new HttpError(
      403,
      '초기 DB 접속 확인이 완료되어 이 검사 기능을 사용하지 않아요. DB에 접속하거나 기록을 변경하지 않았어요.'
    );
  });
}
