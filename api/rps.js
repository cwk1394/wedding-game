// 가위바위보 머신 API (Vercel Serverless Function) — 이벤트 NPC "가위바위보 머신"
// POST /api/rps { action: 'start', number, id, password } → 내 캐릭터(방명록) 비밀번호 확인 → { token, name, streak: 0 }
// POST /api/rps { action: 'play', token, choice: rock|scissors|paper } → 서버가 무작위로 내고 판정
//   이김 → { result: 'win', cpu, streak, token(연승 +1) } · 비김 → { result: 'draw', …, token } · 짐 → 기록 저장 { result: 'lose', ended: true, rank }
// POST /api/rps { action: 'stop', token } → 지금 연승으로 기록 저장 { ended: true, rank }
// POST /api/rps { action: 'contact', number, id, password, contact } → 랭킹에 든 캐릭터의 연락처 저장 (쿠폰 연락용, 암호화해서 gist에)
// POST /api/rps { action: 'admin', password(DEV_PASSWORD) } → 랭킹 + 연락처 · { action: 'reset', password } → 기록·연락처 초기화
// GET  /api/rps[?id=<하객 id>] → { ranking: 캐릭터별 최고 연승 TOP 10, mine: 그 캐릭터의 최근 도전, hasContact }
//
// 판정은 서버가 한다(브라우저가 결과를 정하지 않음). 진행 중인 연승은 서명한 토큰(HMAC, 방명록 비밀번호와 같은 비밀키)에 들어 있어 저장 없이 이어가고,
// 도전이 끝날 때(짐·그만하기)만 GitHub Gist의 rps.json에 기록 + 그 토큰을 "끝남"으로 표시 → 진 토큰으로 다시 내기 불가.
// ponytail: 한 토큰으로 동시에 여러 번 요청하면 끝남 표시 전에 결과를 골라낼 수 있음 — 막으려면 라운드마다 저장해야 해서 안 함
//
// 환경변수(Vercel): GIST_TOKEN(gist 쓰기 권한 토큰, 없으면 GITHUB_TOKEN). 선택: RPS_GIST_ID(기본은 아래 gist)

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { GITHUB_ENV, GitHub } from './_lib/github.js';
import { HttpError, checkDevPassword, corsHeaders, handlePost, json, preflight } from './_lib/http.js';
import { findGuest, secret } from './guestbook.js';

const GIST_ID = (process.env.RPS_GIST_ID || '54d5f2cf56f9e6eb09864d4c3e4ae684').match(/[0-9a-f]{20,}/i)?.[0]; // gist 주소(…/<id>.js)를 넣어도 id만 // gist.github.com/kobe-KANG/<id> (비밀 gist, 파일이 없으면 첫 기록 때 rps.json을 만듦)
const GIST_FILE = 'rps.json';
const HANDS = ['rock', 'scissors', 'paper']; // 앞이 뒤를 이김 (바위 > 가위 > 보 > 바위)
const TOKEN_TTL = 6 * 60 * 60 * 1000; // 도전 하나를 이어갈 수 있는 시간
const RANKING_SIZE = 10;
const CONTACT_MAX = 50;

export const OPTIONS = preflight;

export async function GET(request) {
  const cors = corsHeaders(request);
  try {
    const id = new URL(request.url).searchParams.get('id');
    const { records, contacts } = await readFile(gist());
    const mine = id ? records.filter((r) => r.id === id).slice(-10).reverse() : [];
    return json({ ranking: ranking(records), mine, total: records.length, hasContact: Boolean(id && contacts[id]) }, 200, cors);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof HttpError ? err.message : '기록을 불러오지 못했어요.' }, err.status || 500, cors);
  }
}

export function POST(request) {
  return handlePost(request, async (body) => {
    if (!GIST_ID) throw new HttpError(503, '가위바위보 기록 저장소가 설정되지 않았어요. (RPS_GIST_ID)');
    if (body.action === 'start') {
      const { data, id } = await findGuest(body);
      const token = sign({ id, name: data.name, s: 0, t: Date.now() });
      return { status: 200, body: { token, name: data.name, streak: 0 } };
    }
    if (body.action === 'contact') return { status: 200, body: await saveContact(body) };
    if (body.action === 'admin' || body.action === 'reset') {
      checkDevPassword(body.password);
      const github = gist();
      if (body.action === 'reset') {
        const { burned } = await readFile(github); // 끝난 토큰 표시는 남김 (초기화로 진 토큰이 되살아나지 않게)
        await writeFile(github, { records: [], burned, contacts: {} });
        return { status: 200, body: { ok: true } };
      }
      const { records, contacts } = await readFile(github);
      const top = ranking(records).map((r) => ({ ...r, contact: contacts[r.id] ? decrypt(contacts[r.id].c) : null }));
      return { status: 200, body: { ranking: top, total: records.length } };
    }
    const run = verify(body.token);
    if (body.action === 'stop') return { status: 200, body: await finish(run) };
    if (body.action === 'play') {
      if (!HANDS.includes(body.choice)) throw new HttpError(400, '가위·바위·보 중에 골라 주세요.');
      const github = gist();
      if ((await readFile(github)).burned[run.n]) throw new HttpError(409, '이미 끝난 도전이에요. 다시 도전해 주세요.');
      const cpu = HANDS[randomInt(3)];
      const result = cpu === body.choice ? 'draw' : HANDS[(HANDS.indexOf(body.choice) + 1) % 3] === cpu ? 'win' : 'lose';
      if (result === 'lose') return { status: 200, body: { result, cpu, ...(await finish(run, github)) } };
      const streak = run.s + (result === 'win' ? 1 : 0);
      return { status: 200, body: { result, cpu, streak, token: sign({ id: run.id, name: run.name, s: streak, t: run.t }) } };
    }
    throw new HttpError(400, '알 수 없는 요청이에요.');
  });
}

// ---------- 토큰 ----------

function sign(payload) {
  const data = Buffer.from(JSON.stringify({ ...payload, n: randomBytes(9).toString('base64url'), e: Date.now() + TOKEN_TTL })).toString('base64url');
  return `${data}.${mac(data)}`;
}

function mac(data) {
  return createHmac('sha256', `rps:${secret()}`).update(data).digest('base64url');
}

function verify(token) {
  const [data, sig] = typeof token === 'string' ? token.split('.') : [];
  const a = Buffer.from(sig ?? '');
  const b = Buffer.from(data ? mac(data) : '');
  if (!data || a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(400, '도전 정보가 잘못됐어요. 다시 도전해 주세요.');
  const run = JSON.parse(Buffer.from(data, 'base64url').toString());
  if (run.e < Date.now()) throw new HttpError(410, '도전 시간이 지났어요. 다시 도전해 주세요.');
  return run;
}

// ---------- 기록 (GitHub Gist) ----------

const gist = () => new GitHub({ ...GITHUB_ENV, GITHUB_TOKEN: process.env.GIST_TOKEN || GITHUB_ENV.GITHUB_TOKEN });

/** gist 요청. 토큰에 gist 권한이 없으면(401·403·404) 원인이 보이는 문구로 */
async function gistRequest(github, method, body) {
  try {
    return await github.request(method, `/gists/${GIST_ID}`, body);
  } catch (err) {
    if ([401, 403, 404].includes(err.status)) {
      console.error(`gist ${GIST_ID}, token ${process.env.GIST_TOKEN ? 'GIST_TOKEN' : 'GITHUB_TOKEN'}`, err); // gist id는 비밀이라 응답엔 안 넣고 Vercel 로그에만
      throw new HttpError(503, `가위바위보 기록 저장소(gist)에 접근하지 못했어요. Vercel GIST_TOKEN을 확인해 주세요. (GitHub ${err.status})`);
    }
    throw err;
  }
}

/** gist rps.json { records: [{ id, name, streak, at(시작), end }], burned: { <토큰 nonce>: 만료 시각 }, contacts: { <하객 id>: { c: 암호문, at } } } */
async function readFile(github) {
  const g = await gistRequest(github, 'GET');
  const text = g.files?.[GIST_FILE]?.content;
  const data = text ? JSON.parse(text) : {};
  return { records: data.records ?? [], burned: data.burned ?? {}, contacts: data.contacts ?? {} };
}

const writeFile = (github, data) => gistRequest(github, 'PATCH', { files: { [GIST_FILE]: { content: JSON.stringify(data, null, 1) } } });

// ---------- 연락처 (gist는 id만 알면 읽히므로 AES-256-GCM으로 암호화) ----------

const contactKey = () => createHash('sha256').update(`rps-contact:${secret()}`).digest();

function encrypt(text) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', contactKey(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}

function decrypt(value) {
  try {
    const [iv, tag, enc] = value.split('.').map((s) => Buffer.from(s, 'base64url'));
    const d = createDecipheriv('aes-256-gcm', contactKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch {
    return '(읽을 수 없음 — 비밀키가 바뀜)';
  }
}

/** 내 캐릭터 비밀번호 확인 → 랭킹에 들어 있으면 연락처 저장 (다시 보내면 덮어씀) */
async function saveContact(body) {
  const contact = typeof body.contact === 'string' ? body.contact.trim() : '';
  if (!contact) throw new HttpError(400, '연락처를 입력해 주세요.');
  if (contact.length > CONTACT_MAX) throw new HttpError(400, `연락처는 ${CONTACT_MAX}자까지 쓸 수 있어요.`);
  const { id } = await findGuest(body);
  const github = gist();
  for (let attempt = 0; attempt < 3; attempt++) {
    const data = await readFile(github);
    if (!ranking(data.records).some((r) => r.id === id)) throw new HttpError(403, '랭킹에 든 캐릭터만 연락처를 남길 수 있어요.');
    const c = encrypt(contact);
    data.contacts[id] = { c, at: new Date().toISOString() };
    await writeFile(github, data);
    if ((await readFile(github)).contacts[id]?.c === c) return { ok: true }; // 동시에 쓴 기록에 덮였으면 다시
  }
  throw new HttpError(503, '저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
}

/**
 * 도전 끝: 기록 추가 + 토큰 끝남 표시. 이미 끝난 토큰이면 409.
 * gist는 "읽은 뒤 안 바뀌었을 때만 쓰기"가 없어서, 쓰고 다시 읽어 내 기록이 남았는지 확인 → 동시에 끝난 기록에 덮였으면 다시 합쳐 씀
 */
async function finish(run, github = gist()) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const data = await readFile(github);
    if (data.burned[run.n]) {
      if (attempt === 0) throw new HttpError(409, '이미 끝난 도전이에요.');
      return result(run, data); // 앞에서 쓴 내 기록이 남아 있음
    }
    if (attempt === 3) break; // 세 번 써도 덮이면 포기 (마지막은 확인만)
    const now = Date.now();
    data.burned = Object.fromEntries(Object.entries(data.burned).filter(([, e]) => e > now)); // 만료된 토큰은 어차피 못 씀
    data.burned[run.n] = run.e;
    data.records.push({ id: run.id, name: run.name, streak: run.s, at: new Date(run.t).toISOString(), end: new Date(now).toISOString() });
    await writeFile(github, data);
  }
  throw new HttpError(503, '기록이 몰려서 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
}

function result(run, { records, contacts }) {
  const top = ranking(records);
  const rank = top.findIndex((r) => r.id === run.id) + 1;
  return { ended: true, streak: run.s, rank: rank || null, ranking: top, hasContact: Boolean(contacts[run.id]) };
}

/** 캐릭터별 최고 연승 (같으면 먼저 달성한 사람), 0연승은 제외 */
function ranking(records) {
  const best = new Map();
  for (const r of records) {
    const cur = best.get(r.id);
    if (r.streak > 0 && (!cur || r.streak > cur.streak)) best.set(r.id, r);
  }
  return [...best.values()].sort((a, b) => b.streak - a.streak || a.end.localeCompare(b.end)).slice(0, RANKING_SIZE);
}
