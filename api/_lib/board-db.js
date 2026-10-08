// 게임 상태 DB 도우미.
// 이 파일 추가만으로 게임 저장소는 전환되지 않는다.
// 기존 게임 행만 사용하며, 누락된 행을 빈 자료로 만들지 않는다.

import { withDbClient } from './db.js';
import { HttpError } from './http.js';

function checkGame(game) {
  if (game !== 'rps' && game !== 'chase') {
    throw new HttpError(503, '게임 저장소 구분을 확인해야 해요.');
  }
}

function isObject(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
}

function checkState(data) {
  if (
    !isObject(data) ||
    !Array.isArray(data.records) ||
    !Array.isArray(data.prizeRecords) ||
    !isObject(data.burned) ||
    !isObject(data.contacts)
  ) {
    throw new HttpError(
      503,
      'DB 기록 구조를 확인해야 해요. 빈 자료로 대체하지 않았어요.'
    );
  }
}

// 일반 조회. 기록을 변경하지 않는다.
export async function readGameState(game) {
  checkGame(game);

  return withDbClient(async (client) => {
    const result = await client.query(
      `SELECT data
       FROM public.wedding_game_state
       WHERE game = $1`,
      [game]
    );

    if (result.rows.length !== 1) {
      throw new HttpError(
        503,
        'DB에 게임 자료가 없어요. 이관 상태를 확인해 주세요.'
      );
    }

    const data = result.rows[0].data;
    checkState(data);
    return data;
  });
}

// 같은 게임 행을 잠근 뒤 최신 자료를 읽고 변경한다.
// change는 전달받은 data를 수정하고 응답에 사용할 값을 반환한다.
// change 안에서는 외부 API 호출이나 별도 DB 연결을 사용하지 않는다.
export async function updateGameState(game, change) {
  checkGame(game);

  return withDbClient(async (client) => {
    await client.query('BEGIN');

    try {
      await client.query("SET LOCAL lock_timeout = '5s'");

      const result = await client.query(
        `SELECT data
         FROM public.wedding_game_state
         WHERE game = $1
         FOR UPDATE`,
        [game]
      );

      if (result.rows.length !== 1) {
        throw new HttpError(
          503,
          'DB에 게임 자료가 없어요. 이관 상태를 확인해 주세요.'
        );
      }

      const data = result.rows[0].data;
      checkState(data);

      const response = await change(data);
      checkState(data);

      const saved = await client.query(
        `UPDATE public.wedding_game_state
         SET data = $2::jsonb,
             revision = revision + 1,
             updated_at = now()
         WHERE game = $1`,
        [game, JSON.stringify(data)]
      );

      if (saved.rowCount !== 1) {
        throw new HttpError(503, 'DB 기록 저장을 확인하지 못했어요.');
      }

      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
}
