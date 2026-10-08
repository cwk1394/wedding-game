// 관리자 전용 이관 준비 점검: Gist와 DB를 조회만 한다.
import { isDeepStrictEqual } from 'node:util';
import { readGistSnapshot } from './_lib/gist-snapshot.js';
import { withDbClient } from './_lib/db.js';
import {
  HttpError,
  checkDevPassword,
  handlePost,
  preflight,
} from './_lib/http.js';

export const OPTIONS = preflight;

function summarize(data) {
  if (
    !data ||
    !Array.isArray(data.records) ||
    !Array.isArray(data.prizeRecords) ||
    !data.contacts ||
    typeof data.contacts !== 'object' ||
    Array.isArray(data.contacts) ||
    !data.burned ||
    typeof data.burned !== 'object' ||
    Array.isArray(data.burned)
  ) {
    throw new HttpError(503, '기록 구조를 확인해야 해요. 복사는 진행하지 않았어요.');
  }

  return {
    records: data.records.length,
    prizeRecords: data.prizeRecords.length,
    contacts: Object.keys(data.contacts).length,
    burned: Object.keys(data.burned).length,
  };
}

export function POST(request) {
  return handlePost(request, async (body) => {
    checkDevPassword(body?.password);

    const games = [
      { game: 'rps', file: 'rps.json', score: 'streak' },
      { game: 'chase', file: 'chase.json', score: 'ms' },
    ];

    const source = [];

        try {
      const snapshot = await readGistSnapshot();

      for (const item of games) {
        source.push({
          game: item.game,
          ...summarize(snapshot[item.game]),
        });
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;

      throw new HttpError(
        503,
        'Gist 기록 조회에 실패했어요. 복사는 진행하지 않았어요.'
      );
    }

        const database = await withDbClient(async (client) => {
      const before = await readGistSnapshot();

      const result = await client.query(`
        SELECT game, data, revision
        FROM public.wedding_game_state
        ORDER BY game
      `);

      const after = await readGistSnapshot();

      if (!isDeepStrictEqual(before, after)) {
        throw new HttpError(
          409,
          '비교 중 Gist 원본이 바뀌었어요. 게임과 연락처 등록을 멈춘 뒤 확인해 주세요.'
        );
      }

      if (result.rows.length !== 2) {
        throw new HttpError(
          409,
          'DB에 두 게임의 자료가 모두 있는지 확인해야 해요.'
        );
      }

      for (const game of ['rps', 'chase']) {
        const row = result.rows.find((item) => item.game === game);

        if (!row || !isDeepStrictEqual(row.data, before[game])) {
          throw new HttpError(
            409,
            `${game}의 Gist 원본과 DB 내용이 달라요. 저장소 전환을 중단해 주세요.`
          );
        }
      }

      return result.rows.map((row) => ({
        game: row.game,
        revision: String(row.revision),
        fullMatch: true,
        ...summarize(row.data),
      }));
    });

    return {
      status: 200,
      body: {
        ok: true,
        readOnly: true,
        source,
        database,
      },
    };
  });
}
