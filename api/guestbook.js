// 방명록 쓰기 API (Vercel Serverless Function)
// POST /api/guestbook  { name, shortMsg, longMsg, images?: { front, walk, jump, ladder, rope } }  (이미지는 PNG base64)
//   1) UUID 발급
//   2) 이미지를 img/guests/<uuid>/front.png, walk.png, jump.png, ladder.png, rope.png 로 저장소에 한 커밋으로 올림
//   3) GitHub Discussion(방명록 카테고리)에 JSON 본문으로 글 작성
//   4) 생성된 guest 객체 반환
// GET /api/guestbook → 상태 확인용 { ok: true }
//
// 환경변수(Vercel): GITHUB_TOKEN(필수)
//   선택: GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, DISCUSSION_CATEGORY, ALLOWED_ORIGINS(쉼표 구분, _lib/http.js)

import { GITHUB_ENV, GitHub } from './_lib/github.js';
import { HttpError, corsHeaders, handlePost, json, preflight } from './_lib/http.js';

const ENV = GITHUB_ENV;

const LIMITS = {
  name: 15,
  shortMsg: 10,
  longMsg: 500,
  imageBytes: 512 * 1024, // 브라우저에서 축소해서 보내므로 넉넉한 상한
};

// 정면 외의 동작 스트립 (모두 선택). 파일명 = <motion>.png, 본문 필드 = <motion>Url
const MOTIONS = { walk: '걷기', jump: '점프', ladder: '사다리', rope: '로프' };

export const OPTIONS = preflight;

export function GET(request) {
  return json({ ok: true, configured: Boolean(ENV.GITHUB_TOKEN) }, 200, corsHeaders(request));
}

export function POST(request) {
  return handlePost(request, async (body) => {
    if (!ENV.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN 환경변수가 설정되지 않았습니다.');
    return { status: 201, body: { guest: await createGuest(body, ENV) } };
  });
}

// ---------- 입력 검증 ----------

function text(value, field, max, { required = true } = {}) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (required && !v) throw new HttpError(400, `${field}: 꼭 입력해 주세요.`);
  if ([...v].length > max) throw new HttpError(400, `${field}: ${max}자 이하로 입력해 주세요.`);
  return v;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** data URL 또는 순수 base64 → 검증된 순수 base64 (없으면 null) */
function pngBase64(value, field) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(400, `${field} 이미지 형식이 잘못되었습니다.`);
  const b64 = value.replace(/^data:image\/png;base64,/, '');
  let head;
  try {
    head = atob(b64.slice(0, 12));
  } catch {
    throw new HttpError(400, `${field} 이미지 형식이 잘못되었습니다.`);
  }
  if (!PNG_SIGNATURE.every((byte, i) => head.charCodeAt(i) === byte)) {
    throw new HttpError(400, `${field} 이미지는 PNG여야 합니다.`);
  }
  if ((b64.length * 3) / 4 > LIMITS.imageBytes) throw new HttpError(413, `${field} 이미지가 너무 큽니다.`);
  return b64;
}

// ---------- 방명록 생성 ----------

async function createGuest(body, env) {
  const name = text(body.name, '이름', LIMITS.name);
  const shortMsg = text(body.shortMsg, '한줄 멘트', LIMITS.shortMsg);
  const longMsg = text(body.longMsg, '방명록', LIMITS.longMsg);
  const front = pngBase64(body.images?.front, '정면');
  const motions = Object.fromEntries(
    Object.entries(MOTIONS).map(([motion, label]) => [motion, pngBase64(body.images?.[motion], label)])
  );
  if (!front && Object.values(motions).some(Boolean)) {
    throw new HttpError(400, '동작 이미지만 올릴 수는 없습니다. 정면 이미지도 함께 올려 주세요.');
  }

  const id = crypto.randomUUID();
  const dir = `img/guests/${id}`;
  const files = [];
  const guest = { id, name, shortMsg, longMsg, spriteUrl: null };
  if (front) {
    files.push({ path: `${dir}/front.png`, content: front });
    guest.spriteUrl = `${dir}/front.png`;
  }
  for (const [motion, content] of Object.entries(motions)) {
    guest[`${motion}Url`] = content ? `${dir}/${motion}.png` : null;
    if (content) files.push({ path: `${dir}/${motion}.png`, content });
  }

  const github = new GitHub(env);
  if (files.length) await github.commitFiles(files, `Add guest sprite ${id} (${name})`);
  const discussion = await github.createDiscussion(
    `[방명록] ${name}`,
    '```json\n' + JSON.stringify(guest, null, 2) + '\n```'
  );

  return { ...guest, discussionNumber: discussion.number };
}
