// 이 사이트에서는 유료 AI 이미지 생성을 사용하지 않습니다.
import {
  corsHeaders,
  json,
  preflight,
} from './_lib/http.js';

export const OPTIONS = preflight;

export function GET(request) {
  return json(
    { ok: true, configured: false, mode: 'no-ai' },
    200,
    corsHeaders(request)
  );
}

export function POST(request) {
  return json(
    { error: 'AI 이미지 생성은 사용하지 않습니다.' },
    410,
    corsHeaders(request)
  );
}
