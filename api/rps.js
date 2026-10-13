// 가위바위보 머신 API.
// 캐릭터 인증 후 도전을 시작하고, 매 라운드는 서버에서 판정한다.
// 기록은 DB에 저장하며, 같은 게임 행 잠금 안에서 토큰을 소모한다.
// 초기화 버전을 토큰에 유지하여 초기화 전 도전의 재사용을 막는다.

import { randomInt } from 'node:crypto';
import { Board } from './_lib/board.js';
import { HttpError, handlePost, preflight } from './_lib/http.js';
import { findGuest } from './guestbook.js';

// 앞이 뒤를 이긴다: 바위 > 가위 > 보 > 바위
const HANDS = ['rock', 'scissors', 'paper'];

const board = new Board({
  file: 'rps.json',
  score: 'streak',
  tokenKey: 'rps',
  ttl: 6 * 60 * 60 * 1000,
});

export const OPTIONS = preflight;
export const GET = (request) => board.getDb(request);

// 아직 초기화한 적 없는 기존 DB 자료와 기존 토큰은 버전 0으로 취급한다.
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
        s: 0,
        t: Date.now(),
        rv: version,
      });

      return {
        status: 200,
        body: {
          token,
          name: data.name,
          streak: 0,
        },
      };
    }

    const run = board.verify(body.token);

    if (body.action === 'stop') {
      // 종료 저장 시의 초기화 버전 검사는 공통 finishDb에서 수행한다.
      return {
        status: 200,
        body: {
          streak: run.s,
          ...(await board.finishDb(run, run.s, receivedAt)),
        },
      };
    }

    if (body.action === 'play') {
      if (!HANDS.includes(body.choice)) {
        throw new HttpError(
          400,
          '가위·바위·보 중에 골라 주세요.'
        );
      }

      return board.updateDb((data) => {
        const now = Date.now();

        // 초기화와 같은 DB 행 잠금 안에서 최신 버전을 비교한다.
        // 초기화 전 토큰이면 판정·토큰 소모·기록 저장을 모두 중단한다.
        const version = resetVersion(data.resetVersion);

        if (resetVersion(run.rv) !== version) {
          throw new HttpError(
            410,
            '관리자가 이 게임의 기록을 초기화했어요. 게임 창을 닫고 새로 도전해 주세요.'
          );
        }

        if (run.e < now) {
          throw new HttpError(
            410,
            '도전 시간이 지났어요. 다시 도전해 주세요.'
          );
        }

        if (data.burned[run.n]) {
          throw new HttpError(
            409,
            '이미 사용한 도전 정보예요. 같은 요청을 다시 처리하지 않았어요.'
          );
        }

        // 같은 게임의 행 잠금 안에서만 판정한다.
        const cpu = HANDS[randomInt(3)];
        const result = cpu === body.choice
          ? 'draw'
          : HANDS[(HANDS.indexOf(body.choice) + 1) % 3] === cpu
            ? 'win'
            : 'lose';

        // 승리·무승부·패배 모두 이전 토큰을 한 번만 사용한다.
        data.burned = Object.fromEntries(
          Object.entries(data.burned).filter(([, e]) => e > now)
        );
        data.burned[run.n] = run.e;

        if (result === 'lose') {
          data.records.push({
            id: run.id,
            name: run.name,
            streak: run.s,
            at: new Date(run.t).toISOString(),
            end: new Date(receivedAt).toISOString(),
          });

          return {
            status: 200,
            body: {
              result,
              cpu,
              streak: run.s,
              ...board.result(run.id, data),
            },
          };
        }

        const streak = run.s + (result === 'win' ? 1 : 0);

        // 다음 라운드에도 현재 도전의 초기화 버전을 그대로 유지한다.
        const token = board.sign({
          id: run.id,
          name: run.name,
          s: streak,
          t: run.t,
          rv: version,
        });

        return {
          status: 200,
          body: {
            result,
            cpu,
            streak,
            token,
          },
        };
      });
    }

    throw new HttpError(400, '알 수 없는 요청이에요.');
  });
}
