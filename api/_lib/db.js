// 서버 전용 DB 연결 도우미.
// 이 파일을 추가하는 것만으로 게임 저장소가 바뀌지는 않는다.
import pg from 'pg';
import { HttpError } from './http.js';

const { Client } = pg;

export async function withDbClient(work) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new HttpError(503, 'DB 연결 설정이 없어요. (DATABASE_URL)');
  }

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10000,
    query_timeout: 15000,
    statement_timeout: 15000,
  });

  try {
    await client.connect();
    return await work(client);
  } catch (error) {
    if (error instanceof HttpError) throw error;

    // DB 원본 오류에는 연결 정보나 데이터가 포함될 수 있어
    // 응답과 로그로 그대로 전달하지 않는다.
    throw new HttpError(
      503,
      'DB 작업을 완료하지 못했어요. 연결 상태와 설정을 확인해 주세요.'
    );
  } finally {
    await client.end().catch(() => {});
  }
}
