// 도둑 잡기 API (Vercel Serverless Function) — 이벤트 NPC "도둑 잡기 경찰관" (js/chase.js)
// POST /api/chase { action: 'start', number, id, password } → 내 캐릭터 비밀번호 확인 → { token, countdown }
//   화면은 countdown(ms) 동안 3·2·1 뒤에 추격 시작
// POST /api/chase { action: 'end', token } → 잡혔을 때. 버틴 시간 = 지금 - 시작 - countdown (서버 시각) → 기록 { ms, ended, rank }
// contact·admin·reset·GET(랭킹)은 공통 (_lib/board.js). 기록은 gist의 chase.json { records: [{ id, name, ms, at, end }] }
//
// ponytail: 잡혔는지는 브라우저가 알려 줌 → 잡힌 뒤 늦게 보내면 시간이 늘어남. MAX_MS로 상한만 둠 (막으려면 서버가 게임을 돌려야 함)

import { Board } from './_lib/board.js';
import { HttpError, handlePost, preflight } from './_lib/http.js';
import { findGuest } from './guestbook.js';

const COUNTDOWN = 3000;
const MAX_MS = 10 * 60 * 1000; // 이보다 오래 버틴 기록은 이 값으로
const board = new Board({ file: 'chase.json', score: 'ms', tokenKey: 'chase', ttl: 60 * 60 * 1000 });

export const OPTIONS = preflight;
export const GET = (request) => board.getDb(request);

export function POST(request) {
  const receivedAt = Date.now();
  return handlePost(request, async (body) => {
    const common = await board.commonDb(body);
    if (common) return common;
    if (body.action === 'start') {
      const { data, id } = await findGuest(body);
      return { status: 200, body: { token: board.sign({ id, name: data.name, t: Date.now() }), countdown: COUNTDOWN } };
    }
    if (body.action === 'end') {
      const run = board.verify(body.token);
      const ms = Math.min(MAX_MS, Math.max(0, receivedAt - run.t - COUNTDOWN));
      return { status: 200, body: { ms, ...(await board.finishDb(run, ms, receivedAt)) } };
    }
    throw new HttpError(400, '알 수 없는 요청이에요.');
  });
}
