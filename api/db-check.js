// 관리자 전용 DB 접속 확인. 게임 기록은 읽거나 변경하지 않는다.
import pg from 'pg';
import {
  HttpError,
  checkDevPassword,
  handlePost,
  preflight,
} from './_lib/http.js';

const { Client } = pg;

export const OPTIONS = preflight;

export function POST(request) {
  return handlePost(request, async (body) => {
    // DB에 접속하기 전에 기존 개발자 비밀번호부터 확인
    checkDevPassword(body?.password);

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new HttpError(503, 'DB 연결 설정이 없어요. (DATABASE_URL)');
    }

    const client = new Client({
      connectionString,
      connectionTimeoutMillis: 10000,
      query_timeout: 5000,
      statement_timeout: 5000,
    });

    try {
      await client.connect();

      const result = await client.query(`
        SELECT current_database() AS database_name,
               current_schema() AS schema_name,
               1 AS connection_ok
      `);

      return {
        status: 200,
        body: {
          ok: true,
          database: result.rows[0].database_name,
          schema: result.rows[0].schema_name,
          connectionOk: result.rows[0].connection_ok === 1,
        },
      };
    } catch {
      // 연결 주소·비밀번호가 오류 응답이나 로그에 노출되지 않도록 처리
      throw new HttpError(
        503,
        'DB 접속 확인에 실패했어요. 연결 설정과 DB 상태를 확인해 주세요.'
      );
    } finally {
      await client.end().catch(() => {});
    }
  });
}
