// 방명록 쓰기 API (Vercel Serverless Function)
// POST /api/guestbook  { name, shortMsg, longMsg, password, side, relation, personality, title?, stats, images?: { front, walk, jump, ladder, rope, prone } }  (이미지는 PNG base64)
//   side(신랑측·신부측·두 사람 모두)·relation(친척·직장·친구·기타)·personality(성향) = 아래 목록의 키 (한글 이름은 js/config.js), title = 칭호(12자, 선택)
//   stats = { str, dex, int, luk } 각 4~13, 합 25 (브라우저에서 주사위로 굴림)
//   1) UUID 발급
//   2) 이미지를 img/guests/<uuid>/front.png, walk.png, jump.png, ladder.png, rope.png 로 저장소에 한 커밋으로 올림
//   3) GitHub Discussion(방명록 카테고리)에 JSON 본문으로 글 작성
//   4) 생성된 guest 객체 반환
// POST /api/guestbook  { action: 'verify' | 'update' | 'delete', number, id, password, (update) name, shortMsg, longMsg }
//   방명록 수정/삭제. 비밀번호는 등록 때 정한 것, 또는 관리자 비밀번호(DEV_PASSWORD). 수정은 side·relation·personality·title도 (능력치는 그대로)
//
// 비밀번호 저장: Discussion 본문은 공개라 비밀번호 대신 HMAC-SHA256(서버 비밀키, salt + 비밀번호)만 "pw" 필드에 저장.
//   서버 비밀키 = GUEST_PASSWORD_SECRET (없으면 DEV_PASSWORD). 비밀키를 바꾸면 기존 비밀번호는 모두 무효가 된다.
// GET /api/guestbook → 상태 확인용 { ok: true }
//
// 환경변수(Vercel): GITHUB_TOKEN(필수), GUEST_PASSWORD_SECRET(권장, 없으면 DEV_PASSWORD 사용)
//   선택: GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, DISCUSSION_CATEGORY, ALLOWED_ORIGINS(쉼표 구분, _lib/http.js)

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { GITHUB_ENV, GitHub } from './_lib/github.js';
import { HttpError, corsHeaders, handlePost, json, preflight } from './_lib/http.js';

const ENV = GITHUB_ENV;

const LIMITS = {
  name: 15,
  shortMsg: 20,
  longMsg: 500,
  password: { min: 4, max: 30 },
  imageBytes: 512 * 1024, // 브라우저에서 축소해서 보내므로 넉넉한 상한
  title: 12,
};

// 선택 목록 (키). 한글 이름·성향별 움직임은 js/config.js의 CONFIG.sides / CONFIG.relations / CONFIG.personalities
const SIDES = ['groom', 'bride', 'both'];
const RELATIONS = ['family', 'work', 'friend', 'other'];
const PERSONALITIES = ['chatty', 'explorer', 'foodie', 'sleepy', 'photo', 'dancer', 'calm'];
const STATS = { keys: ['str', 'dex', 'int', 'luk'], min: 4, max: 13, total: 25 };

// 정면 외의 동작 스트립 (모두 선택). 파일명 = <motion>.png, 본문 필드 = <motion>Url
const MOTIONS = { walk: '걷기', jump: '점프', ladder: '사다리', rope: '로프', prone: '엎드리기' };

export const OPTIONS = preflight;

export function GET(request) {
  return json({ ok: true, configured: Boolean(ENV.GITHUB_TOKEN) }, 200, corsHeaders(request));
}

export function POST(request) {
  return handlePost(request, async (body) => {
    if (!ENV.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN 환경변수가 설정되지 않았습니다.');
    if (body.action) return { status: 200, body: await manageGuest(body, ENV) };
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

function choice(value, list, field) {
  if (!list.includes(value)) throw new HttpError(400, `${field}: 목록에서 하나를 골라 주세요.`);
  return value;
}

/** 능력치 { str, dex, int, luk }: 각 4~13 정수, 합 25 */
function stats(value) {
  const out = {};
  for (const k of STATS.keys) {
    const v = value?.[k];
    if (!Number.isInteger(v) || v < STATS.min || v > STATS.max) throw new HttpError(400, '능력치: 주사위를 다시 굴려 주세요.');
    out[k] = v;
  }
  if (Object.values(out).reduce((a, b) => a + b, 0) !== STATS.total) throw new HttpError(400, '능력치: 주사위를 다시 굴려 주세요.');
  return out;
}

/** 관계(어느 쪽·어떤 관계)·성향·칭호 (등록·수정 공통). 칭호는 비우면 없음 */
function profile(body) {
  const title = text(body.title, '칭호', LIMITS.title, { required: false });
  return {
    side: choice(body.side, SIDES, '신랑측·신부측'),
    relation: choice(body.relation, RELATIONS, '관계(친척·직장·친구·기타)'),
    personality: choice(body.personality, PERSONALITIES, '캐릭터 성향'),
    title: title || null,
  };
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
  const extra = { ...profile(body), stats: stats(body.stats) };
  const pw = hashPassword(checkPassword(body.password));
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
  const guest = { id, name, shortMsg, longMsg, ...extra, spriteUrl: null };
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
  const discussion = await github.createDiscussion(`[방명록] ${name}`, discussionBody({ ...guest, pw }));

  return { ...guest, number: discussion.number };
}

const discussionBody = (data) => '```json\n' + JSON.stringify(data, null, 2) + '\n```';

// ---------- 비밀번호 ----------

function secret() {
  const key = process.env.GUEST_PASSWORD_SECRET || process.env.DEV_PASSWORD;
  if (!key) throw new HttpError(503, '비밀번호 기능이 설정되지 않았어요. (GUEST_PASSWORD_SECRET)');
  return key;
}

function checkPassword(value) {
  const v = typeof value === 'string' ? value : '';
  const { min, max } = LIMITS.password;
  if ([...v].length < min || [...v].length > max) throw new HttpError(400, `비밀번호: ${min}~${max}자로 입력해 주세요.`);
  return v;
}

/** "salt:hmac" (hex) */
function hashPassword(password, salt = randomBytes(12).toString('hex')) {
  const mac = createHmac('sha256', secret()).update(`${salt}:${password}`).digest('hex');
  return `${salt}:${mac}`;
}

const sameText = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** 방명록 비밀번호 또는 관리자 비밀번호(DEV_PASSWORD)가 맞는지 */
function passwordMatches(stored, password) {
  if (process.env.DEV_PASSWORD && sameText(password, process.env.DEV_PASSWORD)) return true;
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  return sameText(hashPassword(password, stored.split(':')[0]), stored);
}

// ---------- 방명록 수정/삭제 ----------

/** 본문에서 JSON 부분만 파싱 (fetch-guests와 같은 방식) */
function parseBody(body) {
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  try {
    return start >= 0 && end > start ? JSON.parse(body.slice(start, end + 1)) : null;
  } catch {
    return null;
  }
}

async function manageGuest(body, env) {
  const number = Number(body.number);
  if (!Number.isInteger(number) || number <= 0) throw new HttpError(400, '방명록 번호가 없어요. 새로고침 후 다시 시도해 주세요.');
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) throw new HttpError(400, '비밀번호를 입력해 주세요.');

  const github = new GitHub(env);
  const discussion = await github.getDiscussion(number).catch(() => null);
  const data = discussion && parseBody(discussion.body);
  const id = data && (typeof data.id === 'string' ? data.id.toLowerCase() : `d${number}`);
  // 다른 카테고리 글이나, 다른 하객 id로 요청한 경우는 없는 글로 취급
  if (!data || discussion.category?.name !== env.DISCUSSION_CATEGORY || (body.id && id !== String(body.id).toLowerCase() && body.id !== `d${number}`)) {
    throw new HttpError(404, '방명록을 찾을 수 없어요. 이미 삭제되었을 수 있어요.');
  }
  if (!passwordMatches(data.pw, password)) {
    throw new HttpError(403, data.pw ? '비밀번호가 맞지 않아요.' : '비밀번호가 없는 방명록이라 수정할 수 없어요.');
  }

  if (body.action === 'verify') return { ok: true };

  if (body.action === 'delete') {
    await github.deleteDiscussion(discussion.id); // 이미지는 매일 정리 작업(cleanup-images)이 지운다
    return { ok: true, deleted: true };
  }

  if (body.action === 'update') {
    const next = {
      ...data,
      name: text(body.name, '이름', LIMITS.name),
      shortMsg: text(body.shortMsg, '한줄 멘트', LIMITS.shortMsg),
      longMsg: text(body.longMsg, '방명록', LIMITS.longMsg),
      ...profile(body),
    };
    await github.updateDiscussion(discussion.id, `[방명록] ${next.name}`, discussionBody(next));
    const { pw: _pw, ...guest } = next;
    return { ok: true, guest: { ...guest, number } };
  }

  throw new HttpError(400, '알 수 없는 요청이에요.');
}
