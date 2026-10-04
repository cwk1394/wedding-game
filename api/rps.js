// 가위바위보 머신 API (Vercel Serverless Function) — 이벤트 NPC "가위바위보 머신"
// POST /api/rps { action: 'start', number, id, password } → 내 캐릭터(방명록) 비밀번호 확인 → { token, name, streak: 0 }
// POST /api/rps { action: 'play', token, choice: rock|scissors|paper } → 서버가 무작위로 내고 판정
//   이김 → { result: 'win', cpu, streak, token(연승 +1) } · 비김 → { result: 'draw', …, token } · 짐 → 기록 저장 { result: 'lose', ended: true, rank }
// POST /api/rps { action: 'stop', token } → 지금 연승으로 기록 저장 { ended: true, rank }
// contact·admin·reset·GET(랭킹)은 공통 (_lib/board.js). 기록은 gist의 rps.json { records: [{ id, name, streak, at, end }] }
//
// 판정은 서버가 한다(브라우저가 결과를 정하지 않음). 진행 중인 연승은 서명한 토큰(HMAC, 방명록 비밀번호와 같은 비밀키)에 들어 있어 저장 없이 이어가고,
// 도전이 끝날 때(짐·그만하기)만 기록 + 그 토큰을 "끝남"으로 표시 → 진 토큰으로 다시 내기 불가.
// ponytail: 한 토큰으로 동시에 여러 번 요청하면 끝남 표시 전에 결과를 골라낼 수 있음 — 막으려면 라운드마다 저장해야 해서 안 함

import { randomInt } from 'node:crypto';
import { Board } from './_lib/board.js';
import { HttpError, handlePost, preflight } from './_lib/http.js';
import { findGuest } from './guestbook.js';

const HANDS = ['rock', 'scissors', 'paper']; // 앞이 뒤를 이김 (바위 > 가위 > 보 > 바위)
const board = new Board({ file: 'rps.json', score: 'streak', tokenKey: 'rps', ttl: 6 * 60 * 60 * 1000 });

export const OPTIONS = preflight;
export const GET = (request) => board.get(request);

export function POST(request) {
  const receivedAt = Date.now();
  return handlePost(request, async (body) => {
    const common = await board.common(body);
    if (common) return common;
    if (body.action === 'start') {
      const { data, id } = await findGuest(body);
      const token = board.sign({ id, name: data.name, s: 0, t: Date.now() });
      return { status: 200, body: { token, name: data.name, streak: 0 } };
    }
    const run = board.verify(body.token);
    if (body.action === 'stop') return { status: 200, body: { streak: run.s, ...(await board.finish(run, run.s, undefined, receivedAt)) } };
    if (body.action === 'play') {
      if (!HANDS.includes(body.choice)) throw new HttpError(400, '가위·바위·보 중에 골라 주세요.');
      const github = board.gist();
      if ((await board.read(github)).burned[run.n]) throw new HttpError(409, '이미 끝난 도전이에요. 다시 도전해 주세요.');
      const cpu = HANDS[randomInt(3)];
      const result = cpu === body.choice ? 'draw' : HANDS[(HANDS.indexOf(body.choice) + 1) % 3] === cpu ? 'win' : 'lose';
      if (result === 'lose') return { status: 200, body: { result, cpu, streak: run.s, ...(await board.finish(run, run.s, github, receivedAt)) } };
      const streak = run.s + (result === 'win' ? 1 : 0);
      return { status: 200, body: { result, cpu, streak, token: board.sign({ id: run.id, name: run.name, s: streak, t: run.t }) } };
    }
    throw new HttpError(400, '알 수 없는 요청이에요.');
  });
}
