// 관리자 전용 이관 준비 점검: Gist와 DB를 조회만 한다.
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
      const result = await client.query(`
        SELECT game, data, revision
        FROM public.wedding_game_state
        ORDER BY game
      `);

      return result.rows.map((row) => ({
        game: row.game,
        revision: String(row.revision),
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
