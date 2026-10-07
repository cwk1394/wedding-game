// 이관용 Gist 원본 조회. Gist와 DB에 쓰지 않는다.
import { Board } from './board.js';
import { HttpError } from './http.js';

function isObject(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
}

export async function readGistSnapshot() {
  const board = new Board({
    file: 'rps.json',
    score: 'streak',
    tokenKey: 'rps',
    ttl: 0,
  });

  let gist;
  try {
    // 한 번의 응답에서 두 게임 파일을 함께 읽는다.
    gist = await board.request(board.gist(), 'GET');
  } catch {
    throw new HttpError(
      503,
      '이관 원본을 읽지 못했어요. 복사는 진행하지 않았어요.'
    );
  }

  const snapshot = {};

  for (const game of ['rps', 'chase']) {
    const filename = `${game}.json`;
    const file = gist?.files?.[filename];

    // 이관 시에는 없는 파일을 빈 데이터로 대신하지 않는다.
    if (
      !file ||
      file.truncated ||
      typeof file.content !== 'string' ||
      !file.content.trim()
    ) {
      throw new HttpError(
        503,
        `${filename} 원본 전체를 확인할 수 없어요. 복사를 중단했어요.`
      );
    }

    let data;
    try {
      data = JSON.parse(file.content);
    } catch {
      throw new HttpError(
        503,
        `${filename}의 JSON 형식을 확인해야 해요.`
      );
    }

    if (
      !isObject(data) ||
      !Array.isArray(data.records) ||
      !Array.isArray(data.prizeRecords) ||
      !isObject(data.burned) ||
      !isObject(data.contacts)
    ) {
      throw new HttpError(
        503,
        `${filename}의 기록 구조를 확인해야 해요.`
      );
    }

    // 추가 필드와 암호화된 연락처도 원본 그대로 보존한다.
    snapshot[game] = data;
  }

  return snapshot;
}
