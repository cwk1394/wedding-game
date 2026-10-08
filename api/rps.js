// 가위바위보 머신 API (Vercel Serverless Function) — 이벤트 NPC "가위바위보 머신"
// POST /api/rps { action: 'start', number, id, password } → 내 캐릭터(방명록) 비밀번호 확인 → { token, name, streak: 0 }
// POST /api/rps { action: 'play', token, choice: rock|scissors|paper } → 서버가 무작위로 내고 판정
//   이김 → { result: 'win', cpu, streak, token(연승 +1) } · 비김 → { result: 'draw', …, token } · 짐 → 기록 저장 { result: 'lose', ended: true, rank }
// POST /api/rps { action: 'stop', token } → 지금 연승으로 기록 저장 { ended: true, rank }
// contact·admin·reset·GET(랭킹)은 공통 (_lib/board.js). 기록은 gist의 rps.json { records: [{ id, name, streak, at, end }] }
//
// 승패는 서버가 판정하며, 진행 중인 연승은 서명한 토큰에 담는다.
// 매 라운드 DB 행 잠금 안에서 이전 토큰을 확인·소모하고, 승리·무승부이면 새 토큰을 반환한다.
// 종료 기록은 패배·그만하기 때 저장한다. 동일 토큰 재사용 차단의 실제 실행 검증은 별도로 진행한다.

import { randomInt } from 'node:crypto';
import { Board } from './_lib/board.js';
import { HttpError, handlePost, preflight } from './_lib/http.js';
import { findGuest } from './guestbook.js';

const HANDS = ['rock', 'scissors', 'paper']; // 앞이 뒤를 이김 (바위 > 가위 > 보 > 바위)
const board = new Board({ file: 'rps.json', score: 'streak', tokenKey: 'rps', ttl: 6 * 60 * 60 * 1000 });

export const OPTIONS = preflight;
export const GET = (request) => board.getDb(request);

export function POST(request) {
  const receivedAt = Date.now();
  return handlePost(request, async (body) => {
    const common = await board.commonDb(body);
    if (common) return common;
    if (body.action === 'start') {
      const { data, id } = await findGuest(body);
      const token = board.sign({ id, name: data.name, s: 0, t: Date.now() });
      return { status: 200, body: { token, name: data.name, streak: 0 } };
    }
        const run = board.verify(body.token);
    if (body.action === 'stop') return { status: 200, body: { streak: run.s, ...(await board.finishDb(run, run.s, receivedAt)) } };
        if (body.action === 'play') {
      if (!HANDS.includes(body.choice)) {
        throw new HttpError(400, '가위·바위·보 중에 골라 주세요.');
      }

      const response = await board.updateDb((data) => {
        const now = Date.now();

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
        const token = board.sign({
          id: run.id,
          name: run.name,
          s: streak,
          t: run.t,
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

      return response;
    }
    throw new HttpError(400, '알 수 없는 요청이에요.');
  });
}
