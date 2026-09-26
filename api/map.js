// 개발자 모드 지도 저장 API (Vercel Serverless Function)
// POST /api/map  { password, map: { floors, climbs, spawn, couple } }
//   → 검증 후 js/map-data.js 를 다시 만들어 저장소에 커밋 → Pages 재배포(1~2분)로 반영
// GET /api/map → 상태 확인용 { ok, configured }
//
// 환경변수(Vercel): DEV_PASSWORD(필수, 개발자 모드 저장 비밀번호), GITHUB_TOKEN(필수)

import { timingSafeEqual } from 'node:crypto';
import { GITHUB_ENV, GitHub } from './_lib/github.js';
import { HttpError, corsHeaders, handlePost, json, preflight } from './_lib/http.js';

const FILE = 'js/map-data.js';
const LIMITS = { floors: 200, points: 300, climbs: 200, coord: 10000 };

export const OPTIONS = preflight;

export function GET(request) {
  return json(
    { ok: true, configured: Boolean(process.env.DEV_PASSWORD && GITHUB_ENV.GITHUB_TOKEN) },
    200,
    corsHeaders(request)
  );
}

export function POST(request) {
  return handlePost(request, async (body) => {
    if (!process.env.DEV_PASSWORD) throw new HttpError(503, '개발자 모드 저장이 설정되지 않았어요. (DEV_PASSWORD)');
    if (!GITHUB_ENV.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN 환경변수가 설정되지 않았습니다.');
    if (!checkPassword(body.password)) throw new HttpError(401, '비밀번호가 맞지 않아요.');

    const map = validateMap(body.map);
    const commit = await new GitHub(GITHUB_ENV).commitFiles(
      [{ path: FILE, content: Buffer.from(renderMapFile(map)).toString('base64') }],
      `Update walkable map areas (dev mode): ${Object.keys(map.floors).length} floors, ${map.climbs.length} climbs`
    );
    return { status: 200, body: { ok: true, commit } };
  });
}

function checkPassword(value) {
  const a = Buffer.from(String(value ?? ''));
  const b = Buffer.from(process.env.DEV_PASSWORD);
  return a.length === b.length && timingSafeEqual(a, b);
}

const isCoord = (v) => Number.isFinite(v) && v >= 0 && v <= LIMITS.coord;

/** 모양·범위를 검사하고 좌표를 정수로 정리한 사본을 돌려준다 */
function validateMap(map) {
  const bad = (msg) => new HttpError(400, `지도 데이터 오류: ${msg}`);
  if (!map || typeof map !== 'object') throw bad('map이 없어요.');

  const entries = Object.entries(map.floors ?? {});
  if (!entries.length || entries.length > LIMITS.floors) throw bad(`발판은 1~${LIMITS.floors}개여야 해요.`);
  const floors = {};
  for (const [name, floor] of entries) {
    if (!/^[\w-]{1,40}$/.test(name)) throw bad(`발판 이름 "${name}"`);
    const path = floor?.path;
    if (!Array.isArray(path) || path.length < 2 || path.length > LIMITS.points) throw bad(`${name}: 점은 2~${LIMITS.points}개`);
    floors[name] = {
      path: path.map((p, i) => {
        if (!Array.isArray(p) || p.length !== 2 || !isCoord(p[0]) || !isCoord(p[1])) throw bad(`${name}: ${i}번째 점`);
        if (i > 0 && p[0] < path[i - 1][0]) throw bad(`${name}: x는 오름차순이어야 해요.`);
        return [Math.round(p[0]), Math.round(p[1])];
      }),
    };
  }
  if (!floors.stage) throw bad('stage(신랑/신부 자리) 발판이 없어요.');

  let spawn = null;
  if (map.spawn != null) {
    if (!floors[map.spawn.floor] || !isCoord(map.spawn.x)) throw bad('시작점');
    spawn = { floor: map.spawn.floor, x: Math.round(map.spawn.x) };
  }

  // 신랑·신부 자리 { groom: { floor, x }, bride: { floor, x } } — 없는 쪽은 stage 가운데
  let couple = null;
  if (map.couple != null) {
    couple = {};
    for (const id of ['groom', 'bride']) {
      const p = map.couple[id];
      if (p == null) continue;
      if (!floors[p.floor] || !isCoord(p.x)) throw bad(`${id === 'groom' ? '신랑' : '신부'} 자리`);
      couple[id] = { floor: p.floor, x: Math.round(p.x) };
    }
    if (!Object.keys(couple).length) couple = null;
  }

  const climbs = map.climbs ?? [];
  if (!Array.isArray(climbs) || climbs.length > LIMITS.climbs) throw bad(`사다리/로프는 ${LIMITS.climbs}개 이하`);
  return {
    floors,
    spawn,
    couple,
    climbs: climbs.map((c, i) => {
      if (!['ladder', 'rope'].includes(c?.type)) throw bad(`${i}번째 사다리/로프 종류`);
      if (!isCoord(c.x)) throw bad(`${i}번째 사다리/로프 x`);
      const names = Array.isArray(c.floors) ? c.floors : [];
      if (names.length === 1) {
        // 위쪽만 발판에 걸린 매달린 사다리/로프: end = 아래 끝 y
        if (!floors[names[0]] || !isCoord(c.end)) throw bad(`${i}번째 매달린 사다리/로프`);
        return { type: c.type, x: Math.round(c.x), floors: [names[0]], end: Math.round(c.end) };
      }
      const [a, b] = names;
      if (names.length !== 2 || !floors[a] || !floors[b] || a === b) throw bad(`${i}번째 사다리/로프가 잇는 발판`);
      return { type: c.type, x: Math.round(c.x), floors: [a, b] };
    }),
  };
}

/** js/map-data.js 내용 (사람이 읽기 좋게 한 줄에 발판 하나) */
function renderMapFile({ floors, climbs, spawn, couple }) {
  return [
    '// 이동 가능 영역 (발판 · 사다리 · 로프). 개발자 모드(?dev)에서 저장하면 이 파일이 통째로 다시 만들어진다.',
    '// floors: { 이름: { path: [[x, y], ...] } } — 배경 이미지 픽셀 좌표, x 오름차순 꺾은선. stage = 신랑/신부 자리',
    '// climbs: [{ type: ladder|rope, x, floors: [층A, 층B] }] — floors가 하나면 위쪽만 걸리고 end(아래 끝 y)까지 매달림',
    'const MAP_DATA = {',
    '  floors: {',
    ...Object.entries(floors).map(([name, f]) => `    ${JSON.stringify(name)}: { "path": ${JSON.stringify(f.path)} },`),
    '  },',
    '  climbs: [',
    ...climbs.map((c) => `    ${JSON.stringify(c)},`),
    '  ],',
    `  spawn: ${JSON.stringify(spawn)}, // 방명록 등록 직후 새 캐릭터가 나타나는 곳 { floor, x }`,
    `  couple: ${JSON.stringify(couple)}, // 신랑·신부 자리 { groom: { floor, x }, bride: { floor, x } } (null이면 stage 가운데)`,
    '};',
    '',
  ].join('\n');
}
