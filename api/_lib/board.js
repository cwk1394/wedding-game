// 이벤트 게임 공통 (가위바위보 api/rps.js, 도둑 잡기 api/chase.js): 서명 토큰, GitHub Gist 기록·랭킹, 랭킹 연락처(암호화), 개발자 관리
// 게임마다 gist 안의 파일이 다르다 (rps.json, chase.json). 기록 { id, name, <score>: 점수, at(시작), end } — 점수가 클수록 높은 순위
//
// POST { action: 'contact', number, id, password, contact } → 랭킹에 든 캐릭터의 연락처 저장 (쿠폰 연락용)
// POST { action: 'admin', password(DEV_PASSWORD) } → 랭킹 + 연락처 · { action: 'reset', password } → 기록·연락처 초기화
// GET  [?id=<하객 id>] → { ranking: 캐릭터별 최고 점수 TOP 10, mine: 그 캐릭터의 최근 도전, hasContact }
//
// 환경변수(Vercel): GIST_TOKEN(gist 쓰기 권한 토큰, 없으면 GITHUB_TOKEN). 선택: RPS_GIST_ID(기본은 아래 gist)

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { GITHUB_ENV, GitHub } from './github.js';
import { HttpError, checkDevPassword, corsHeaders, json } from './http.js';
import { findGuest, secret } from '../guestbook.js';

// gist.github.com/kobe-KANG/<id> (비밀 gist, 파일이 없으면 첫 기록 때 만듦). gist 주소(…/<id>.js)를 넣어도 id만
const GIST_ID = (process.env.RPS_GIST_ID || '').match(/[0-9a-f]{20,}/i)?.[0];

const RANKING_SIZE = 10;
const CONTACT_MAX = 50;
const PRIZE_DEADLINE = Date.parse('2026-12-13T00:00:00+09:00');
const PRIZE_SIZE = 3;

export class Board {
  /** file: gist 파일 이름, score: 기록의 점수 필드, tokenKey: 토큰 서명 구분(게임끼리 토큰을 못 섞게), ttl: 토큰 유효 시간 */
  constructor({ file, score, tokenKey, ttl }) {
    Object.assign(this, { file, score, tokenKey, ttl });
  }

  // ---------- 토큰 ----------

  sign(payload) {
    const data = Buffer.from(JSON.stringify({ ...payload, n: randomBytes(9).toString('base64url'), e: Date.now() + this.ttl })).toString('base64url');
    return `${data}.${this.mac(data)}`;
  }

  mac(data) {
    return createHmac('sha256', `${this.tokenKey}:${secret()}`).update(data).digest('base64url');
  }

  verify(token) {
    const [data, sig] = typeof token === 'string' ? token.split('.') : [];
    const a = Buffer.from(sig ?? '');
    const b = Buffer.from(data ? this.mac(data) : '');
    if (!data || a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(400, '도전 정보가 잘못됐어요. 다시 도전해 주세요.');
    const run = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (run.e < Date.now()) throw new HttpError(410, '도전 시간이 지났어요. 다시 도전해 주세요.');
    return run;
  }

  // ---------- 기록 (GitHub Gist) ----------

  gist() {
    if (!GIST_ID) throw new HttpError(503, '기록 저장소가 설정되지 않았어요. (RPS_GIST_ID)');
    return new GitHub({ ...GITHUB_ENV, GITHUB_TOKEN: process.env.GIST_TOKEN || GITHUB_ENV.GITHUB_TOKEN });
  }

  /** gist 요청. 토큰에 gist 권한이 없으면(401·403·404) 원인이 보이는 문구로 */
  async request(github, method, body) {
    try {
      return await github.request(method, `/gists/${GIST_ID}`, body);
    } catch (err) {
      if ([401, 403, 404].includes(err.status)) {
        console.error(`gist ${GIST_ID}, token ${process.env.GIST_TOKEN ? 'GIST_TOKEN' : 'GITHUB_TOKEN'}`, err); // gist id는 비밀이라 응답엔 안 넣고 Vercel 로그에만
        throw new HttpError(503, `기록 저장소(gist)에 접근하지 못했어요. Vercel GIST_TOKEN을 확인해 주세요. (GitHub ${err.status})`);
      }
      throw err;
    }
  }

  /** { records: [{ id, name, <score>, at, end }], burned: { <토큰 nonce>: 만료 시각 }, contacts: { <하객 id>: { c: 암호문, at } } } */
  async read(github) {
    const g = await this.request(github, 'GET');
    const text = g.files?.[this.file]?.content;
    const data = text ? JSON.parse(text) : {};
    return { records: data.records ?? [], burned: data.burned ?? {}, contacts: data.contacts ?? {} };
  }

  write(github, data) {
    return this.request(github, 'PATCH', { files: { [this.file]: { content: JSON.stringify(data, null, 1) } } });
  }

  /**
   * 도전 끝: 기록 추가 + 토큰 끝남 표시. 이미 끝난 토큰이면 409.
   * gist는 "읽은 뒤 안 바뀌었을 때만 쓰기"가 없어서, 쓰고 다시 읽어 내 기록이 남았는지 확인 → 동시에 끝난 기록에 덮였으면 다시 합쳐 씀
   */
  async finish(run, score, github = this.gist()) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const data = await this.read(github);
      if (data.burned[run.n]) {
        if (attempt === 0) throw new HttpError(409, '이미 끝난 도전이에요.');
        return this.result(run.id, data); // 앞에서 쓴 내 기록이 남아 있음
      }
      if (attempt === 3) break; // 세 번 써도 덮이면 포기 (마지막은 확인만)
      const now = Date.now();
      data.burned = Object.fromEntries(Object.entries(data.burned).filter(([, e]) => e > now)); // 만료된 토큰은 어차피 못 씀
      data.burned[run.n] = run.e;
      data.records.push({ id: run.id, name: run.name, [this.score]: score, at: new Date(run.t).toISOString(), end: new Date(now).toISOString() });
      await this.write(github, data);
    }
    throw new HttpError(503, '기록이 몰려서 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }

  result(id, { records, contacts }) {
    const top = this.ranking(records);
    const rank = top.findIndex((r) => r.id === id) + 1;
    return { ended: true, rank: rank || null, ranking: top, hasContact: Boolean(contacts[id]) };
  }

  /** 캐릭터별 최고 점수 (같으면 먼저 달성한 사람), 0점은 제외 */
  ranking(records) {
    const s = this.score;
    const best = new Map();
    for (const r of records) {
      const cur = best.get(r.id);
      if (r[s] > 0 && (!cur || r[s] > cur[s])) best.set(r.id, r);
    }
    return [...best.values()].sort((a, b) => b[s] - a[s] || a.end.localeCompare(b.end)).slice(0, RANKING_SIZE);
  }

  // ---------- 공통 요청 ----------

  async get(request) {
    const cors = corsHeaders(request);
    try {
      const id = new URL(request.url).searchParams.get('id');
      const { records, contacts } = await this.read(this.gist());
      const mine = id ? records.filter((r) => r.id === id).slice(-10).reverse() : [];
      return json({ ranking: this.ranking(records), mine, total: records.length, hasContact: Boolean(id && contacts[id]) }, 200, cors);
    } catch (err) {
      console.error(err);
      return json({ error: err instanceof HttpError ? err.message : '기록을 불러오지 못했어요.' }, err.status || 500, cors);
    }
  }

  /** contact·admin·reset이면 처리해서 { status, body }, 아니면 null (게임별 요청) */
  async common(body) {
    if (body.action === 'contact') return { status: 200, body: await this.saveContact(body) };
    if (body.action !== 'admin' && body.action !== 'reset') return null;
    checkDevPassword(body.password);
    const github = this.gist();
    const { records, burned, contacts } = await this.read(github);
    if (body.action === 'reset') {
  throw new HttpError(403, '경품 기록 보존을 위해 랭킹 초기화를 사용하지 않아요.');
}
    const top = this.ranking(records).map((r) => ({ ...r, contact: contacts[r.id] ? decrypt(contacts[r.id].c) : null }));
    return { status: 200, body: { ranking: top, total: records.length } };
  }

  /** 내 캐릭터 비밀번호 확인 → 랭킹에 들어 있으면 연락처 저장 (다시 보내면 덮어씀) */
  async saveContact(body) {
    const contact = typeof body.contact === 'string' ? body.contact.trim() : '';
    if (!contact) throw new HttpError(400, '연락처를 입력해 주세요.');
    if (contact.length > CONTACT_MAX) throw new HttpError(400, `연락처는 ${CONTACT_MAX}자까지 쓸 수 있어요.`);
    const { id } = await findGuest(body);
    const github = this.gist();
    for (let attempt = 0; attempt < 3; attempt++) {
      const data = await this.read(github);
      if (!this.ranking(data.records).some((r) => r.id === id)) throw new HttpError(403, '랭킹에 든 캐릭터만 연락처를 남길 수 있어요.');
      const c = encrypt(contact);
      data.contacts[id] = { c, at: new Date().toISOString() };
      await this.write(github, data);
      if ((await this.read(github)).contacts[id]?.c === c) return { ok: true }; // 동시에 쓴 기록에 덮였으면 다시
    }
    throw new HttpError(503, '저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
}

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
