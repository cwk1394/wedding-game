// 관리자 전용 최초 복사. Gist는 읽기만 하며 기존 DB 자료는 덮어쓰지 않는다.
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

export function POST(request) {
  return handlePost(request, async (body) => {
    checkDevPassword(body?.password);

    if (body?.confirmation !== 'COPY_GIST_TO_EMPTY_DB') {
      throw new HttpError(400, '복사 확인이 필요해요.');
    }

    const source = await readGistSnapshot();
    const games = ['rps', 'chase'];

    const copied = await withDbClient(async (client) => {
      await client.query('BEGIN');

      try {
        // 복사 요청끼리 충돌하거나 다른 DB 쓰기가 끼어들지 않게 잠근다.
        await client.query(`
          LOCK TABLE public.wedding_game_state
          IN EXCLUSIVE MODE NOWAIT
        `);

        const existing = await client.query(`
          SELECT game FROM public.wedding_game_state
        `);

        if (existing.rows.length > 0) {
          throw new HttpError(
            409,
            'DB에 이미 자료가 있어요. 덮어쓰지 않았어요. 먼저 비교가 필요해요.'
          );
        }

        for (const game of games) {
          await client.query(
            `INSERT INTO public.wedding_game_state (game, data)
             VALUES ($1, $2::jsonb)`,
            [game, JSON.stringify(source[game])]
          );
        }

        const saved = await client.query(`
          SELECT game, data
          FROM public.wedding_game_state
          ORDER BY game
        `);

        if (saved.rows.length !== games.length) {
          throw new HttpError(503, '복사된 게임 수가 달라 작업을 취소했어요.');
        }

        for (const game of games) {
          const row = saved.rows.find((item) => item.game === game);

          if (!row || !isDeepStrictEqual(row.data, source[game])) {
            throw new HttpError(
              503,
              '원본과 DB 내용이 달라 이번 복사 작업을 취소했어요.'
            );
          }
        }

        // 복사하는 동안 Gist 원본이 바뀌었는지도 다시 확인한다.
        const latest = await readGistSnapshot();

        if (!isDeepStrictEqual(latest, source)) {
          throw new HttpError(
            409,
            '복사 중 Gist 기록이 바뀌었어요. 이번 복사 작업을 취소했어요.'
          );
        }

        await client.query('COMMIT');

        return games.map((game) => ({
          game,
          records: source[game].records.length,
          prizeRecords: source[game].prizeRecords.length,
          contacts: Object.keys(source[game].contacts).length,
          burned: Object.keys(source[game].burned).length,
        }));
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
    });

    return {
      status: 200,
      body: {
        ok: true,
        copied: true,
        verifiedBeforeCommit: true,
        games: copied,
        message: 'DB에 복사했어요. 게임 저장소는 아직 Gist예요.',
      },
    };
  });
}
