// DB 최초 복사 도구 비활성화: 이전 완료 후 재실행 방지.
// DB·Gist에 접속하지 않으며, 기존 기록·연락처를 변경하지 않는다.
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
      'DB 이전이 완료되어 최초 복사 기능을 사용하지 않아요. 기존 기록은 변경하지 않았어요.'
    );
  });
}
