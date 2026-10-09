// DB 이전 완료 후 옛 Gist·DB 비교 도구 비활성화.
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
      'DB 이전이 완료되어 옛 Gist·DB 비교 기능을 사용하지 않아요. 전환 이후 두 저장소의 내용이 달라지는 것은 정상이며, 다시 복사하지 마세요.'
    );
  });
}
