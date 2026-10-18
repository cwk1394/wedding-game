// 이벤트 게임 공통 서버.
// 운영 게임은 DB용 메서드를 사용한다.
// 일반 기록·경품 기록·연락처는 게임별로 분리한다.
// 관리자 초기화는 해당 게임의 DB 행 잠금 안에서 수행한다.
// 초기화 버전을 증가시켜 이전 도전의 기록 재저장을 차단한다.
// 기존 Gist 관련 메서드는 유지하되, Gist 초기화는 계속 차단한다.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { GITHUB_ENV, GitHub } from './github.js';
import {
  HttpError,
  checkDevPassword,
  corsHeaders,
  json,
} from './http.js';
import { findGuest, secret } from '../guestbook.js';
import { readGameState, updateGameState } from './board-db.js';

const GIST_ID =
  (process.env.RPS_GIST_ID || '').match(/[0-9a-f]{20,}/i)?.[0];

const RANKING_SIZE = 10;
const CONTACT_MAX = 50;
const PRIZE_DEADLINE = Date.parse('2026-12-13T00:00:00+09:00');
const PRIZE_SIZE = 3;

// 초기화한 적 없는 기존 DB 자료와 기존 토큰은 버전 0으로 취급한다.
// 잘못된 버전 값은 임의로 보정하지 않고 중단한다.
function resetVersion(value) {
  if (value === undefined) return 0;

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HttpError(
      503,
      '게임 초기화 버전을 확인해야 해요.'
    );
  }

  return value;
}

export class Board {
  // 게임별 파일 구분·점수 필드·토큰 서명 구분·유효 시간.
  constructor({ file, score, tokenKey, ttl }) {
    Object.assign(this, { file, score, tokenKey, ttl });
  }

  // ---------- 운영 DB ----------

  dbGame() {
    if (this.file === 'rps.json' && this.score === 'streak') {
      return 'rps';
    }

    if (this.file === 'chase.json' && this.score === 'ms') {
      return 'chase';
    }

    throw new HttpError(
      503,
      '게임 DB 구분을 확인해야 해요.'
    );
  }

  async readDb() {
    return readGameState(this.dbGame());
  }

  // 연락처 저장·관리자 조회·초기화를 처리한다.
  async commonDb(body) {
    if (body.action === 'contact') {
      return {
        status: 200,
        body: await this.saveContactDb(body),
      };
    }

        if (body.action === 'adminRecords') {
      return {
        status: 200,
        body: await this.adminRecordsDb(body),
      };
    }

    if (body.action === 'deleteRecord') {
      return {
        status: 200,
        body: await this.deleteRecordDb(body),
      };
    }

    if (body.action !== 'admin' && body.action !== 'reset') {
      return null;
    }

    // DB 조회·연락처 복호화·초기화 전에 관리자 인증을 수행한다.
    checkDevPassword(body.password);

    if (body.action === 'reset') {
      return {
        status: 200,
        body: await this.resetDb(body),
      };
    }

    const data = await this.readDb();
    const { records, contacts, prizeRecords } = data;

    const top = this.ranking(records).map((r) => ({
      ...r,
      contact: contacts[r.id]
        ? decrypt(contacts[r.id].c)
        : null,
    }));

    const prizeTop = this.prizeRanking([
      ...prizeRecords,
      ...records,
    ]).map((r) => ({
      ...r,
      contact: contacts[r.id]
        ? decrypt(contacts[r.id].c)
        : null,
    }));

    return {
      status: 200,
      body: {
        ranking: top,
        total: records.length,
        prize: {
          ...this.result(null, data).prize,
          ranking: prizeTop,
        },
      },
    };
  }
  // 이름이 바뀌어도 같은 도전을 식별하도록 이름은 키에서 제외한다.
  // 게임과 초기화 버전을 포함해 다른 게임·초기화 전 기록과 구분한다.
  recordKeyDb(record, version) {
    return createHash('sha256')
      .update(JSON.stringify([
        this.dbGame(),
        version,
        record.id,
        record[this.score],
        record.at,
        record.end,
      ]))
      .digest('hex');
  }

  // 일반 기록과 경품 보존 기록에 있는 같은 도전을 묶는다.
  // 한 배열 안에 완전히 같은 기록이 여러 건 있으면 삭제를 허용하지 않는다.
  recordEntriesDb(data) {
    const version = resetVersion(data.resetVersion);
    const entries = new Map();

    const add = (records, field) => {
      for (const r of records) {
        if (
          !r ||
          typeof r !== 'object' ||
          typeof r.id !== 'string' ||
          !r.id ||
          !Number.isFinite(r[this.score]) ||
          r[this.score] < 0 ||
          typeof r.at !== 'string' ||
          !Number.isFinite(Date.parse(r.at)) ||
          typeof r.end !== 'string' ||
          !Number.isFinite(Date.parse(r.end))
        ) {
          throw new HttpError(
            503,
            '도전 기록 형식을 확인해야 해요. 기록을 변경하지 않았어요.'
          );
        }

        const key = this.recordKeyDb(r, version);

        if (!entries.has(key)) {
          entries.set(key, {
            recordKey: key,
            record: {
              id: r.id,
              name: typeof r.name === 'string' ? r.name : '',
              [this.score]: r[this.score],
              at: r.at,
              end: r.end,
            },
            generalCount: 0,
            prizeCount: 0,
          });
        }

        entries.get(key)[field]++;
      }
    };

    add(data.records, 'generalCount');
    add(data.prizeRecords, 'prizeCount');

    return [...entries.values()];
  }

  // 관리자 전용 도전 기록 조회.
  // 캐릭터 목록과 선택한 캐릭터의 기록을 한 번에 최대 20건 반환한다.
  // 연락처·비밀번호·서명 토큰은 응답에 포함하지 않는다.
  async adminRecordsDb(body) {
    checkDevPassword(body.password);

    const game = this.dbGame();

    if (body.game !== game) {
      throw new HttpError(
        400,
        '조회할 게임을 확인할 수 없어요.'
      );
    }

    const guestId = body.guestId ?? '';
    const page = body.page ?? 0;

    if (
      typeof guestId !== 'string' ||
      guestId.length > 200 ||
      !Number.isSafeInteger(page) ||
      page < 0 ||
      page > 1000000
    ) {
      throw new HttpError(
        400,
        '기록 조회 조건이 잘못됐어요.'
      );
    }

    const data = await this.readDb();
    const entries = this.recordEntriesDb(data);
    const guests = new Map();

    for (const entry of entries) {
      const r = entry.record;
      const guest = guests.get(r.id);

      if (!guest) {
        guests.set(r.id, {
          id: r.id,
          name: r.name,
          count: 1,
          lastEnd: r.end,
        });
      } else {
        guest.count++;

        if (r.end > guest.lastEnd) {
          guest.name = r.name;
          guest.lastEnd = r.end;
        }
      }
    }

    // 최고 기록부터 표시하고 동점이면 종료 시각 순으로 표시한다.
    const selected = guestId
      ? entries
          .filter((entry) => entry.record.id === guestId)
          .sort(
            (a, b) =>
              b.record[this.score] - a.record[this.score] ||
              a.record.end.localeCompare(b.record.end) ||
              a.recordKey.localeCompare(b.recordKey)
          )
      : [];

    const start = page * 20;

    return {
      ok: true,
      game,
      guests: [...guests.values()],
      page,
      total: selected.length,
      hasMore: start + 20 < selected.length,
      records: selected.slice(start, start + 20).map((entry) => ({
        ...entry.record,
        recordKey: entry.recordKey,
        inGeneral: entry.generalCount > 0,
        inPrize: entry.prizeCount > 0,
        canDelete:
          entry.generalCount <= 1 &&
          entry.prizeCount <= 1,
      })),
    };
  }

  // 관리자가 선택한 게임의 도전 한 건만 삭제한다.
  // 일반 기록과 경품 보존 기록의 동일 도전을 같은 행 잠금 안에서 처리한다.
  async deleteRecordDb(body) {
    checkDevPassword(body.password);

    const game = this.dbGame();
    const key = body.recordKey;

    if (
      body.game !== game ||
      typeof key !== 'string' ||
      !/^[0-9a-f]{64}$/.test(key) ||
      body.confirmation !== `${game}:ONE:${key}`
    ) {
      throw new HttpError(
        400,
        '삭제할 게임과 기록을 확인할 수 없어요.'
      );
    }

    return this.updateDb((data) => {
      // 조회 이후 다른 요청이 기록을 변경했을 수 있으므로
      // 잠금 안에서 최신 자료를 기준으로 삭제 대상을 다시 확인한다.
      const entry = this.recordEntriesDb(data)
        .find((item) => item.recordKey === key);

      if (!entry) {
        throw new HttpError(
          409,
          '이미 삭제되었거나 기록이 변경됐어요. 목록을 다시 조회해 주세요.'
        );
      }

      // 정확히 같은 자료가 한 배열에 여러 건이면 임의로 함께 삭제하지 않는다.
      if (
        entry.generalCount > 1 ||
        entry.prizeCount > 1
      ) {
        throw new HttpError(
          409,
          '완전히 같은 기록이 여러 건 있어 한 건을 구분할 수 없어요. 자동으로 삭제하지 않았어요.'
        );
      }

      const version = resetVersion(data.resetVersion);

      data.records = data.records.filter(
        (r) => this.recordKeyDb(r, version) !== key
      );

      data.prizeRecords = data.prizeRecords.filter(
        (r) => this.recordKeyDb(r, version) !== key
      );

      // 연락처·사용한 토큰 목록·초기화 버전은 변경하지 않는다.
      // 다른 게임·캐릭터·방명록·이미지에도 접근하지 않는다.
      // 이후 조회에서는 기존 순위 계산이 남은 최고 기록을 선택한다.
      return {
        ok: true,
        deleted: true,
        game,
        recordKey: key,
      };
    });
  }
  // 관리자 인증과 게임별 삭제 확인값을 검사한 뒤 초기화한다.
  async resetDb(body) {
    // 다른 위치에서 호출하더라도 관리자 인증을 생략하지 않는다.
    checkDevPassword(body.password);

    const game = this.dbGame();

    if (body.confirmation !== `${game}:ALL`) {
      throw new HttpError(
        400,
        '삭제 범위를 확인할 수 없어요. 화면을 새로고침한 뒤 다시 확인해 주세요.'
      );
    }

    return this.updateDb((data) => {
      const version = resetVersion(data.resetVersion);

      if (version >= Number.MAX_SAFE_INTEGER) {
        throw new HttpError(
          503,
          '게임 초기화 버전을 더 증가시킬 수 없어요.'
        );
      }

      // 해당 게임의 행 잠금 안에서 한 번에 변경한다.
      // 다른 게임·캐릭터·방명록·사진에는 접근하지 않는다.
      data.resetVersion = version + 1;
      data.records = [];
      data.prizeRecords = [];
      data.contacts = {};
      data.burned = {};

      return {
        ok: true,
        reset: true,
        game,
        resetVersion: data.resetVersion,
      };
    });
  }

  // 일반 랭킹과 내 도전 기록을 읽는다.
  async getDb(request) {
    const cors = {
      ...corsHeaders(request),
      'Cache-Control': 'no-store',
    };

    try {
      const id = new URL(request.url).searchParams.get('id');
      const data = await this.readDb();
      const { records, contacts } = data;

      const mine = id
        ? records.filter((r) => r.id === id).slice(-10).reverse()
        : [];

      return json({
        ranking: this.ranking(records),
        mine,
        total: records.length,
        hasContact: Boolean(id && contacts[id]),
        prize: this.result(id, data).prize,
      }, 200, cors);
    } catch (err) {
      return json({
        error: err instanceof HttpError
          ? err.message
          : '기록을 불러오지 못했어요.',
      }, err instanceof HttpError ? err.status : 500, cors);
    }
  }

  // 캐릭터 인증 후 최신 경품 자격을 확인하고 연락처를 저장한다.
  async saveContactDb(body) {
    const contact = typeof body.contact === 'string'
      ? body.contact.trim()
      : '';

    if (!contact) {
      throw new HttpError(400, '연락처를 입력해 주세요.');
    }

    if (contact.length > CONTACT_MAX) {
      throw new HttpError(
        400,
        `연락처는 ${CONTACT_MAX}자까지 쓸 수 있어요.`
      );
    }

    // 외부 캐릭터 인증은 DB 잠금 전에 완료한다.
    const { id } = await findGuest(body);
    const c = encrypt(contact);

    return this.updateDb((data) => {
      // 초기화와 동일한 행 잠금 안에서 최신 자격을 검사한다.
      const eligible = this.prizeRanking([
        ...data.prizeRecords,
        ...data.records,
      ]).some((r) => r.id === id);

      if (!eligible) {
        throw new HttpError(
          403,
          '마감 전 경품 후보 TOP 3 또는 마감 후 최종 TOP 3만 연락처를 남길 수 있어요.'
        );
      }

      data.contacts[id] = {
        c,
        at: new Date().toISOString(),
      };

      return { ok: true };
    });
  }

  // 도둑잡기 종료·가위바위보 그만하기의 기록을 저장한다.
  async finishDb(run, score, receivedAt) {
    if (
      !Number.isFinite(receivedAt) ||
      !Number.isFinite(score) ||
      score < 0
    ) {
      throw new HttpError(400, '기록 정보가 잘못됐어요.');
    }

    return this.updateDb((data) => {
      const now = Date.now();

      // 반드시 DB 행 잠금 안에서 최신 초기화 버전을 비교한다.
      // 초기화 이전 토큰이면 기록과 사용한 토큰 목록을 변경하지 않는다.
      if (
        resetVersion(run.rv) !== resetVersion(data.resetVersion)
      ) {
        throw new HttpError(
          410,
          '관리자가 이 게임의 기록을 초기화했어요. 게임 창을 닫고 새로 도전해 주세요.'
        );
      }

      // DB 잠금을 기다리는 동안 만료된 경우도 중단한다.
      if (run.e < now) {
        throw new HttpError(
          410,
          '도전 시간이 지났어요. 다시 도전해 주세요.'
        );
      }

      if (data.burned[run.n]) {
        throw new HttpError(409, '이미 끝난 도전이에요.');
      }

      data.burned = Object.fromEntries(
        Object.entries(data.burned).filter(([, e]) => e > now)
      );

      data.burned[run.n] = run.e;

      data.records.push({
        id: run.id,
        name: run.name,
        [this.score]: score,
        at: new Date(run.t).toISOString(),
        end: new Date(receivedAt).toISOString(),
      });

      return this.result(run.id, data);
    });
  }

  async updateDb(change) {
    return updateGameState(this.dbGame(), async (data) => {
      const response = await change(data);

      // 기존 기준대로 마감 전 경품 기록을 중복 없이 보존한다.
      // 초기화에서는 두 기록 배열을 모두 비워 옛 기록이 다시 합쳐지지 않는다.
      const unique = new Map();

      for (const r of [
        ...data.prizeRecords,
        ...data.records,
      ]) {
        const end = Date.parse(r.end);

        if (!Number.isFinite(end) || end >= PRIZE_DEADLINE) {
          continue;
        }

        const key = JSON.stringify([
          r.id,
          r[this.score],
          r.at,
          r.end,
        ]);

        if (!unique.has(key)) {
          unique.set(key, { ...r });
        }
      }

      data.prizeRecords = [...unique.values()];
      return response;
    });
  }

  // ---------- 서명 토큰 ----------

  sign(payload) {
    const data = Buffer.from(JSON.stringify({
      ...payload,
      n: randomBytes(9).toString('base64url'),
      e: Date.now() + this.ttl,
    })).toString('base64url');

    return `${data}.${this.mac(data)}`;
  }

  mac(data) {
    return createHmac(
      'sha256',
      `${this.tokenKey}:${secret()}`
    ).update(data).digest('base64url');
  }

  verify(token) {
    const [data, sig] =
      typeof token === 'string' ? token.split('.') : [];

    const a = Buffer.from(sig ?? '');
    const b = Buffer.from(data ? this.mac(data) : '');

    if (
      !data ||
      a.length !== b.length ||
      !timingSafeEqual(a, b)
    ) {
      throw new HttpError(
        400,
        '도전 정보가 잘못됐어요. 다시 도전해 주세요.'
      );
    }

    const run = JSON.parse(
      Buffer.from(data, 'base64url').toString()
    );

    if (run.e < Date.now()) {
      throw new HttpError(
        410,
        '도전 시간이 지났어요. 다시 도전해 주세요.'
      );
    }

    return run;
  }

  // ---------- 기존 Gist 호환 코드 ----------

  gist() {
    if (!GIST_ID) {
      throw new HttpError(
        503,
        '기록 저장소가 설정되지 않았어요. (RPS_GIST_ID)'
      );
    }

    return new GitHub({
      ...GITHUB_ENV,
      GITHUB_TOKEN:
        process.env.GIST_TOKEN || GITHUB_ENV.GITHUB_TOKEN,
    });
  }

  // Gist 접근 오류의 상세 정보는 서버 로그에만 남긴다.
  async request(github, method, body) {
    try {
      return await github.request(
        method,
        `/gists/${GIST_ID}`,
        body
      );
    } catch (err) {
      if ([401, 403, 404].includes(err.status)) {
        console.error(
          `gist ${GIST_ID}, token ${
            process.env.GIST_TOKEN ? 'GIST_TOKEN' : 'GITHUB_TOKEN'
          }`,
          err
        );

        throw new HttpError(
          503,
          `기록 저장소(gist)에 접근하지 못했어요. Vercel GIST_TOKEN을 확인해 주세요. (GitHub ${err.status})`
        );
      }

      throw err;
    }
  }

  async read(github) {
    const g = await this.request(github, 'GET');
    const file = g.files?.[this.file];

    // 잘린 응답으로 기존 기록을 덮어쓰지 않는다.
    if (file?.truncated) {
      throw new HttpError(
        503,
        '기록 파일 전체를 읽지 못했어요. 관리자 확인이 필요해요.'
      );
    }

    const text = file?.content;

    if (
      file &&
      (typeof text !== 'string' || !text.trim())
    ) {
      throw new HttpError(
        503,
        '기록 파일 내용이 비어 있어요. 관리자 확인이 필요해요.'
      );
    }

    const data = file ? JSON.parse(text) : {};

    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      (data.records != null && !Array.isArray(data.records)) ||
      (
        data.prizeRecords != null &&
        !Array.isArray(data.prizeRecords)
      )
    ) {
      throw new HttpError(
        503,
        '기록 파일 형식 확인이 필요해요.'
      );
    }

    return {
      ...data,
      records: data.records ?? [],
      burned: data.burned ?? {},
      contacts: data.contacts ?? {},
      prizeRecords: data.prizeRecords ?? [],
    };
  }

  write(github, data) {
    // 기존 Gist 저장 방식의 경품 기록 보존 처리를 유지한다.
    const unique = new Map();

    for (const r of [
      ...(data.prizeRecords ?? []),
      ...(data.records ?? []),
    ]) {
      const end = Date.parse(r.end);

      if (!Number.isFinite(end) || end >= PRIZE_DEADLINE) {
        continue;
      }

      const key = JSON.stringify([
        r.id,
        r[this.score],
        r.at,
        r.end,
      ]);

      if (!unique.has(key)) {
        unique.set(key, { ...r });
      }
    }

    const saved = {
      ...data,
      prizeRecords: [...unique.values()],
    };

    return this.request(github, 'PATCH', {
      files: {
        [this.file]: {
          content: JSON.stringify(saved, null, 1),
        },
      },
    });
  }

  // 기존 Gist 종료 저장 방식. 운영 DB의 종료 처리는 finishDb를 사용한다.
  async finish(
    run,
    score,
    github = this.gist(),
    receivedAt = Date.now()
  ) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const data = await this.read(github);

      if (data.burned[run.n]) {
        if (attempt === 0) {
          throw new HttpError(409, '이미 끝난 도전이에요.');
        }

        return this.result(run.id, data);
      }

      if (attempt === 3) break;

      const now = Date.now();

      data.burned = Object.fromEntries(
        Object.entries(data.burned).filter(([, e]) => e > now)
      );

      data.burned[run.n] = run.e;

      data.records.push({
        id: run.id,
        name: run.name,
        [this.score]: score,
        at: new Date(run.t).toISOString(),
        end: new Date(receivedAt).toISOString(),
      });

      await this.write(github, data);
    }

    throw new HttpError(
      503,
      '기록이 몰려서 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
    );
  }

  // ---------- 공통 순위 계산 ----------

  result(id, { records, contacts, prizeRecords = [] }) {
    const top = this.ranking(records);
    const rank = top.findIndex((r) => r.id === id) + 1;

    const prizeTop = this.prizeRanking([
      ...prizeRecords,
      ...records,
    ]);

    const prizeRank =
      prizeTop.findIndex((r) => r.id === id) + 1;

    const hasContact = Boolean(contacts[id]);

    return {
      ended: true,
      rank: rank || null,
      ranking: top,
      hasContact,
      prize: {
        deadline: new Date(PRIZE_DEADLINE).toISOString(),
        closed: Date.now() >= PRIZE_DEADLINE,
        ranking: prizeTop,
        rank: prizeRank || null,
        canContact: Boolean(id && prizeRank),
        hasContact,
      },
    };
  }

  // 캐릭터별 최고 양수 점수를 선택한다.
  // 캐릭터 간 동점은 기록의 종료 시각 순으로 정렬한다.
  ranking(records) {
    const s = this.score;
    const best = new Map();

    for (const r of records) {
      const cur = best.get(r.id);

      if (r[s] > 0 && (!cur || r[s] > cur[s])) {
        best.set(r.id, r);
      }
    }

    return [...best.values()]
      .sort(
        (a, b) =>
          b[s] - a[s] ||
          a.end.localeCompare(b.end)
      )
      .slice(0, RANKING_SIZE);
  }

  // 마감 전 서버 접수 기록만으로 경품 TOP 3을 계산한다.
  prizeRanking(records) {
    const eligible = records.filter((r) => {
      const end = Date.parse(r.end);

      return (
        Number.isFinite(end) &&
        end < PRIZE_DEADLINE
      );
    });

    return this.ranking(eligible).slice(0, PRIZE_SIZE);
  }

  // ---------- 기존 Gist 공통 요청 ----------

  async get(request) {
    const cors = corsHeaders(request);

    try {
      const id = new URL(request.url).searchParams.get('id');

      const {
        records,
        contacts,
        prizeRecords,
      } = await this.read(this.gist());

      const mine = id
        ? records.filter((r) => r.id === id).slice(-10).reverse()
        : [];

      return json({
        ranking: this.ranking(records),
        mine,
        total: records.length,
        hasContact: Boolean(id && contacts[id]),
        prize: this.result(id, {
          records,
          contacts,
          prizeRecords,
        }).prize,
      }, 200, cors);
    } catch (err) {
      console.error(err);

      return json({
        error: err instanceof HttpError
          ? err.message
          : '기록을 불러오지 못했어요.',
      }, err.status || 500, cors);
    }
  }

  // 기존 Gist 요청용. Gist 초기화는 계속 거절한다.
  async common(body) {
    if (body.action === 'contact') {
      return {
        status: 200,
        body: await this.saveContact(body),
      };
    }

    if (body.action !== 'admin' && body.action !== 'reset') {
      return null;
    }

    checkDevPassword(body.password);

    // 옛 저장소의 초기화 요청은 조회·변경 전에 차단한다.
    if (body.action === 'reset') {
      throw new HttpError(
        403,
        '옛 Gist 저장소의 초기화는 사용하지 않아요.'
      );
    }

    const github = this.gist();

    const {
      records,
      contacts,
      prizeRecords,
    } = await this.read(github);

    const top = this.ranking(records).map((r) => ({
      ...r,
      contact: contacts[r.id]
        ? decrypt(contacts[r.id].c)
        : null,
    }));

    return {
      status: 200,
      body: {
        ranking: top,
        total: records.length,
        prize: {
          ...this.result(null, {
            records,
            contacts,
            prizeRecords,
          }).prize,
          ranking: this.prizeRanking([
            ...prizeRecords,
            ...records,
          ]).map((r) => ({
            ...r,
            contact: contacts[r.id]
              ? decrypt(contacts[r.id].c)
              : null,
          })),
        },
      },
    };
  }

  // 기존 Gist 연락처 저장 방식.
  async saveContact(body) {
    const contact = typeof body.contact === 'string'
      ? body.contact.trim()
      : '';

    if (!contact) {
      throw new HttpError(400, '연락처를 입력해 주세요.');
    }

    if (contact.length > CONTACT_MAX) {
      throw new HttpError(
        400,
        `연락처는 ${CONTACT_MAX}자까지 쓸 수 있어요.`
      );
    }

    const { id } = await findGuest(body);
    const github = this.gist();

    for (let attempt = 0; attempt < 3; attempt++) {
      const data = await this.read(github);

      const eligible = this.prizeRanking([
        ...(data.prizeRecords ?? []),
        ...data.records,
      ]).some((r) => r.id === id);

      if (!eligible) {
        throw new HttpError(
          403,
          '마감 전 경품 후보 TOP 3 또는 마감 후 최종 TOP 3만 연락처를 남길 수 있어요.'
        );
      }

      const c = encrypt(contact);

      data.contacts[id] = {
        c,
        at: new Date().toISOString(),
      };

      await this.write(github, data);

      if ((await this.read(github)).contacts[id]?.c === c) {
        return { ok: true };
      }
    }

    throw new HttpError(
      503,
      '저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
    );
  }
}

// ---------- 연락처 암호화 ----------

// 기존 키 생성 방식을 유지한다.
// 비밀키가 바뀌면 기존 연락처를 복호화하지 못할 수 있다.
const contactKey = () =>
  createHash('sha256')
    .update(`rps-contact:${secret()}`)
    .digest();

function encrypt(text) {
  const iv = randomBytes(12);
  const c = createCipheriv(
    'aes-256-gcm',
    contactKey(),
    iv
  );

  const enc = Buffer.concat([
    c.update(text, 'utf8'),
    c.final(),
  ]);

  return [iv, c.getAuthTag(), enc]
    .map((b) => b.toString('base64url'))
    .join('.');
}

function decrypt(value) {
  try {
    const [iv, tag, enc] = value
      .split('.')
      .map((s) => Buffer.from(s, 'base64url'));

    const d = createDecipheriv(
      'aes-256-gcm',
      contactKey(),
      iv
    );

    d.setAuthTag(tag);

    return Buffer.concat([
      d.update(enc),
      d.final(),
    ]).toString('utf8');
  } catch {
    return '(읽을 수 없음 — 비밀키가 바뀜)';
  }
}
