// API 함수 공통: CORS, JSON 응답, 에러 처리
// (api/ 아래 _로 시작하는 파일은 Vercel이 엔드포인트로 만들지 않는다)

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS || 'https://kobe-kang.github.io,http://localhost:8765,http://127.0.0.1:8765'
)
  .split(',')
  .map((s) => s.trim());

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
  if (ALLOWED_ORIGINS.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

export function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, '잘못된 요청 형식입니다.');
  }
}

export function preflight(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

/** 허용 출처 확인 + 에러를 JSON 응답으로 바꿔주는 POST 핸들러 래퍼. handler는 { status, body }를 반환. */
export async function handlePost(request, handler) {
  const cors = corsHeaders(request);
  try {
    if (!cors['Access-Control-Allow-Origin']) throw new HttpError(403, '허용되지 않은 출처입니다.');
    const { status, body } = await handler(await readJson(request));
    return json(body, status, cors);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    return json({ error: status === 500 ? '서버 오류가 발생했습니다.' : err.message }, status, cors);
  }
}
