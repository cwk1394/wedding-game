// 도둑 잡기 API.
// 캐릭터 인증 후 서명 토큰과 카운트다운 시간을 반환한다.
// 종료 시 서버 접수 시각으로 버틴 시간을 계산하고 DB에 저장한다.
// 시작 토큰에 초기화 버전을 넣어 초기화 전 도전을 구분한다.

import { Board } from './_lib/board.js';
import { HttpError, handlePost, preflight } from './_lib/http.js';
import { findGuest } from './guestbook.js';

const COUNTDOWN = 3000;
const MAX_MS = 10 * 60 * 1000;

const board = new Board({
  file: 'chase.json',
  score: 'ms',
  tokenKey: 'chase',
  ttl: 60 * 60 * 1000,
});

export const OPTIONS = preflight;
export const GET = (request) => board.getDb(request);

// 초기화한 적 없는 기존 DB 자료는 버전 0으로 취급한다.
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

export function POST(request) {
  const receivedAt = Date.now();

  return handlePost(request, async (body) => {
    const common = await board.commonDb(body);
    if (common) return common;

    if (body.action === 'start') {
      // 외부 캐릭터 인증을 완료한 뒤 현재 DB 초기화 버전을 읽는다.
      const { data, id } = await findGuest(body);
      const state = await board.readDb();
      const version = resetVersion(state.resetVersion);

      const token = board.sign({
        id,
        name: data.name,
        t: Date.now(),
        rv: version,
      });

      return {
        status: 200,
        body: {
          token,
          countdown: COUNTDOWN,
        },
      };
    }

    if (body.action === 'end') {
      const run = board.verify(body.token);

      // 기존 시간 계산 유지: 서버 접수 시각 - 시작 시각 - 카운트다운.
      const ms = Math.min(
        MAX_MS,
        Math.max(0, receivedAt - run.t - COUNTDOWN)
      );

      // 종료 저장 시의 초기화 버전 검사는 공통 finishDb에서 수행한다.
      // 해당 검사는 다음 공통 파일 수정 단계에서 추가한다.
      return {
        status: 200,
        body: {
          ms,
          ...(await board.finishDb(run, ms, receivedAt)),
        },
      };
    }

    throw new HttpError(400, '알 수 없는 요청이에요.');
  });
}
