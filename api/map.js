// 개발자 모드 지도 저장 API (Vercel Serverless Function)
// POST /api/map  { password, map: { floors, climbs, spawn, couple, npcs } }
//   npcs[id].def가 있으면 개발자 모드에서 추가한 NPC { desc, height, motions } — 처음 저장할 때 npcImages { <id>: { front, idle, walk } }(webp data URL)를 img/npc/<id>/에 커밋
//   npcImages[id].replace = true면 기존 NPC 이미지 교체 (설정 창 "이미지 새로 만들기") → 같은 경로에 덮어씀
//   npcs[id].album = 앨범 NPC의 앨범 디렉토리 → img/gallery/<album>/ 이 없으면 .gitkeep을 커밋해 만든다 (사진은 직접 넣기)
//   npcDeletes [id]: 삭제한 추가 NPC의 img/npc/<id>/ 폴더를 지움 (js/npcs.js에 있는 기본 NPC는 npcs[id].deleted = true로 숨기기만)
//   npcs[id].dir가 있으면 NPC 디렉토리 이름 바꾸기: img/npc/<id>/ → img/npc/<dir>/ 이동 + js/npcs.js·scripts/gen-npc.mjs의 id도 바꿈 (같은 커밋)
//   → 검증 후 js/map-data.js 를 다시 만들어 저장소에 커밋 → Pages 재배포(1~2분)로 반영
// GET /api/map → 상태 확인용 { ok, configured }
//
// 환경변수(Vercel): DEV_PASSWORD(필수, 개발자 모드 저장 비밀번호), GITHUB_TOKEN(필수)

import { GITHUB_ENV, GitHub } from './_lib/github.js';
import { HttpError, checkDevPassword, corsHeaders, handlePost, json, preflight } from './_lib/http.js';

const FILE = 'js/map-data.js';
const LIMITS = { floors: 200, points: 300, climbs: 200, coord: 10000, npcs: 50, name: 15, shortMsg: 20, longMsg: 500 };
const NPC_DIR = /^[a-z0-9][a-z0-9-]{0,39}$/;
const NPC_ID_FILES = ['js/npcs.js', 'scripts/gen-npc.mjs'];
const NPC_MOTIONS = ['idle', 'walk']; // 추가한 NPC가 가질 수 있는 동작
const MAX_NPC_IMAGE_BYTES = 1.5 * 1024 * 1024; // NPC id(= 디렉토리 이름)가 따옴표 문자열로 들어 있는 파일
const NPC_MODES = ['fixed', 'random', 'stage'];

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
    checkDevPassword(body.password);
    if (!GITHUB_ENV.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN 환경변수가 설정되지 않았습니다.');

    const map = validateMap(body.map);
    const github = new GitHub(GITHUB_ENV);
    const deleted = await npcDeleteFiles(github, map, body.npcDeletes);
    const added = await npcImageFiles(github, map, body.npcImages);
    const renames = await npcRenameFiles(github, map);
    const albums = await albumDirFiles(github, map);
    const commit = await github.commitFiles(
      [...deleted.files, ...added.files, ...renames.files, ...albums, { path: FILE, content: Buffer.from(renderMapFile(map)).toString('base64') }],
      `Update walkable map areas (dev mode): ${Object.keys(map.floors).length} floors, ${map.climbs.length} climbs` +
        deleted.list.map((id) => `; delete NPC ${id}`).join('') +
        added.list.map((what) => `; ${what}`).join('') +
        renames.list.map(([from, to]) => `; rename NPC ${from} -> ${to}`).join('')
    );
    return { status: 200, body: { ok: true, commit } };
  });
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
  if (!Object.keys(floors).some((n) => n.startsWith('stage'))) throw bad('무대(stage) 발판이 하나 이상 있어야 해요.');

  let spawn = null;
  if (map.spawn != null) {
    if (!floors[map.spawn.floor] || !isCoord(map.spawn.x)) throw bad('시작점');
    spawn = { floor: map.spawn.floor, x: Math.round(map.spawn.x) };
  }

  // 신랑·신부 자리 { groom: { floor, x }, bride: { floor, x }, fixed } — 없는 쪽은 무대 가운데. fixed = 자리 고정 (아니면 무대 안에서 돌아다님)
  let couple = null;
  if (map.couple != null) {
    couple = {};
    for (const id of ['groom', 'bride']) {
      const p = map.couple[id];
      if (p == null) continue;
      if (!floors[p.floor] || !isCoord(p.x)) throw bad(`${id === 'groom' ? '신랑' : '신부'} 자리`);
      couple[id] = { floor: p.floor, x: Math.round(p.x) };
    }
    if (map.couple.fixed === true) couple.fixed = true;
    if (!Object.keys(couple).length) couple = null;
  }

  // NPC 설정 { <id>: { shortMsg, longMsg, mode, floor, x } } — mode 없으면 js/npcs.js 기본, fixed면 floor·x 자리
  const npcEntries = Object.entries(map.npcs ?? {});
  if (npcEntries.length > LIMITS.npcs) throw bad(`NPC 설정은 ${LIMITS.npcs}개 이하`);
  const npcs = {};
  for (const [id, n] of npcEntries) {
    if (!/^[\w-]{1,40}$/.test(id) || !n || typeof n !== 'object') throw bad(`NPC "${id}"`);
    if (n.deleted === true) {
      npcs[id] = { deleted: true }; // 기본 NPC 숨기기
      continue;
    }
    const out = {};
    for (const key of ['name', 'shortMsg', 'longMsg']) {
      if (n[key] == null) continue;
      if (typeof n[key] !== 'string' || [...n[key]].length > LIMITS[key]) throw bad(`${id}: ${key}는 ${LIMITS[key]}자 이하`);
      out[key] = n[key];
    }
    if (n.mode != null) {
      if (!NPC_MODES.includes(n.mode)) throw bad(`${id}: 배치 방식`);
      out.mode = n.mode;
    }
    if (out.mode === 'fixed' && n.y != null) {
      // 가만히 있는 NPC: 발판과 상관없이 x, y (공중도 가능)
      if (!isCoord(n.x) || !isCoord(n.y)) throw bad(`${id}: 고정 자리`);
      Object.assign(out, { x: Math.round(n.x), y: Math.round(n.y) });
    } else if (out.mode === 'fixed') {
      if (!floors[n.floor] || !isCoord(n.x)) throw bad(`${id}: 고정 자리`);
      Object.assign(out, { floor: n.floor, x: Math.round(n.x) });
    }
    if (n.album != null) {
      // 앨범 NPC: 누르면 img/gallery/<album>/ 사진을 보여줌
      if (typeof n.album !== 'string' || !NPC_DIR.test(n.album)) throw bad(`${id}: 앨범 디렉토리 이름은 영문 소문자·숫자·-만 (40자 이하)`);
      out.album = n.album;
    }
    if (n.def != null) {
      // 개발자 모드에서 추가한 NPC (id = 이미지 폴더 이름)
      const d = n.def;
      if (!NPC_DIR.test(id)) throw bad(`${id}: 디렉토리 이름은 영문 소문자·숫자·-만 (40자 이하)`);
      if (typeof d.desc !== 'string' || !d.desc.trim() || [...d.desc].length > 300) throw bad(`${id}: 설명은 1~300자`);
      if (!Number.isInteger(d.height) || d.height < 10 || d.height > 200) throw bad(`${id}: 키는 10~200`);
      const motions = Array.isArray(d.motions) ? d.motions : [];
      if (motions.some((m, i) => !NPC_MOTIONS.includes(m) || motions.indexOf(m) !== i)) throw bad(`${id}: 동작`);
      if (!out.name) throw bad(`${id}: 이름이 필요해요.`);
      out.def = { desc: d.desc.trim(), height: d.height, motions };
    }
    if (n.dir != null && n.dir !== id) {
      if (typeof n.dir !== 'string' || !NPC_DIR.test(n.dir)) throw bad(`${id}: 디렉토리 이름은 영문 소문자·숫자·-만 (40자 이하)`);
      out.dir = n.dir;
    }
    if (Object.keys(out).length) npcs[id] = out;
  }
  const dirs = Object.values(npcs).map((n) => n.dir).filter(Boolean);
  if (dirs.some((d, i) => dirs.indexOf(d) !== i || npcs[d])) throw bad('NPC 디렉토리 이름이 겹쳐요.');

  const climbs = map.climbs ?? [];
  if (!Array.isArray(climbs) || climbs.length > LIMITS.climbs) throw bad(`사다리/로프는 ${LIMITS.climbs}개 이하`);
  return {
    floors,
    spawn,
    couple,
    npcs,
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

/**
 * NPC 디렉토리 이름 바꾸기 (npcs[id].dir): 폴더 안 파일을 새 경로로 옮기고(같은 blob) 옛 경로는 지우고,
 * js/npcs.js 등의 'id' 문자열을 새 이름으로 바꾼다. map.npcs 키도 새 이름으로 바꾼다 (dir은 지움).
 * → { files: commitFiles 항목, list: [[from, to]] }
 */
async function npcRenameFiles(github, map) {
  const list = Object.entries(map.npcs)
    .filter(([, n]) => n.dir)
    .map(([id, n]) => [id, n.dir]);
  const files = [];
  if (!list.length) return { files, list };

  const texts = {};
  for (const path of NPC_ID_FILES) {
    const f = await github.getContents(path);
    texts[path] = Buffer.from(f.content, 'base64').toString('utf8');
  }
  for (const [from, to] of list) {
    const q = (id) => new RegExp(`(['"])${id}\\1`, 'g'); // 'id' 또는 "id" (dir 이름은 정규식 특수문자 없음)
    const custom = Boolean(map.npcs[from].def); // 개발자 모드에서 추가한 NPC는 js/npcs.js에 없고 map-data에만 있음
    if (!custom && !q(from).test(texts['js/npcs.js'])) throw new HttpError(400, `NPC "${from}"가 js/npcs.js에 없어요.`);
    if (q(to).test(texts['js/npcs.js']) || (await github.getContents(`img/npc/${to}`))) throw new HttpError(400, `"${to}" 이름은 이미 있어요.`);
    const entries = (await github.getContents(`img/npc/${from}`)) ?? [];
    for (const e of entries) {
      if (e.type !== 'file') throw new HttpError(400, `img/npc/${from}/ 안에 폴더가 있어서 옮길 수 없어요.`);
      files.push({ path: `img/npc/${to}/${e.name}`, sha: e.sha }, { path: e.path, sha: null });
    }
    if (!custom) for (const path of NPC_ID_FILES) texts[path] = texts[path].replace(q(from), `$1${to}$1`);
    const { dir, ...rest } = map.npcs[from];
    delete map.npcs[from];
    if (Object.keys(rest).length) map.npcs[to] = rest;
  }
  for (const path of NPC_ID_FILES) files.push({ path, content: Buffer.from(texts[path]).toString('base64') });
  return { files, list };
}

/** 앨범 NPC의 img/gallery/<album>/ 이 저장소에 없으면 .gitkeep으로 만든다 (git은 빈 폴더를 못 올려서) */
async function albumDirFiles(github, map) {
  const albums = [...new Set(Object.values(map.npcs).map((n) => n.album).filter(Boolean))];
  const files = [];
  for (const album of albums) {
    if (await github.getContents(`img/gallery/${album}`)) continue;
    files.push({ path: `img/gallery/${album}/.gitkeep`, content: Buffer.from('앨범 사진을 이 폴더에 넣으세요.\n').toString('base64') });
  }
  return files;
}

/**
 * 삭제한 추가 NPC npcDeletes [id] → img/npc/<id>/ 파일 삭제 항목. map-data에 남아 있거나 js/npcs.js의 기본 NPC면 거부.
 * → { files, list: [id] }
 */
async function npcDeleteFiles(github, map, npcDeletes) {
  const files = [];
  const list = [];
  if (!Array.isArray(npcDeletes ?? [])) throw new HttpError(400, 'npcDeletes는 목록이어야 해요.');
  const npcsJs = npcDeletes?.length ? Buffer.from((await github.getContents('js/npcs.js')).content, 'base64').toString('utf8') : '';
  for (const id of npcDeletes ?? []) {
    if (typeof id !== 'string' || !NPC_DIR.test(id) || map.npcs[id]) throw new HttpError(400, `NPC "${id}" 삭제: 잘못된 NPC예요.`);
    if (new RegExp(`(['"])${id}\\1`).test(npcsJs)) throw new HttpError(400, `NPC "${id}"는 기본 NPC라 폴더를 지울 수 없어요.`);
    const entries = (await github.getContents(`img/npc/${id}`)) ?? [];
    for (const e of entries) if (e.type === 'file') files.push({ path: e.path, sha: null });
    list.push(id);
  }
  return { files, list };
}

/**
 * NPC 이미지 npcImages { <id>: { front, idle?, walk?, replace? } } → img/npc/<id>/<동작>.webp 커밋 항목.
 *   새 NPC(replace 없음): map.npcs[id].def가 있어야 하고, 이미 있는 폴더 이름이면 거부. front + def.motions 필수
 *   이미지 교체(replace: true): 이미 있는 NPC 폴더에 덮어쓴다. front 필수, idle/walk는 있으면
 * → { files, list: ['add NPC id' | 'update NPC images id'] }
 */
async function npcImageFiles(github, map, npcImages) {
  const files = [];
  const list = [];
  for (const [id, imgs] of Object.entries(npcImages ?? {})) {
    if (!NPC_DIR.test(id) || !imgs || typeof imgs !== 'object') throw new HttpError(400, `NPC "${id}" 이미지: 잘못된 NPC예요.`);
    const def = map.npcs[id]?.def;
    const replace = imgs.replace === true;
    if (!replace) {
      if (!def) throw new HttpError(400, `NPC "${id}" 이미지: 추가한 NPC가 아니에요.`);
      if (await github.getContents(`img/npc/${id}`)) throw new HttpError(400, `"${id}" 이름은 이미 있어요.`);
    }
    const required = ['front', ...(def?.motions ?? [])];
    for (const m of ['front', ...NPC_MOTIONS]) {
      if (imgs[m] == null && !required.includes(m)) continue;
      const match = typeof imgs[m] === 'string' && imgs[m].match(/^data:image\/webp;base64,([A-Za-z0-9+/=]+)$/);
      if (!match) throw new HttpError(400, `NPC "${id}" ${m} 이미지가 없거나 webp가 아니에요.`);
      if (Buffer.byteLength(match[1], 'base64') > MAX_NPC_IMAGE_BYTES) throw new HttpError(413, `NPC "${id}" ${m} 이미지가 너무 커요.`);
      files.push({ path: `img/npc/${id}/${m}.webp`, content: match[1] });
    }
    list.push(`${replace ? 'update NPC images' : 'add NPC'} ${id}`);
  }
  return { files, list };
}

/** js/map-data.js 내용 (사람이 읽기 좋게 한 줄에 발판 하나) */
function renderMapFile({ floors, climbs, spawn, couple, npcs }) {
  return [
    '// 이동 가능 영역 (발판 · 사다리 · 로프). 개발자 모드(?dev)에서 저장하면 이 파일이 통째로 다시 만들어진다.',
    '// floors: { 이름: { path: [[x, y], ...] } } — 배경 이미지 픽셀 좌표, x 오름차순 꺾은선. stage로 시작하는 이름 = 신랑/신부 무대',
    '// climbs: [{ type: ladder|rope, x, floors: [층A, 층B] }] — floors가 하나면 위쪽만 걸리고 end(아래 끝 y)까지 매달림',
    'const MAP_DATA = {',
    '  floors: {',
    ...Object.entries(floors).map(([name, f]) => `    ${JSON.stringify(name)}: { "path": ${JSON.stringify(f.path)} },`),
    '  },',
    '  climbs: [',
    ...climbs.map((c) => `    ${JSON.stringify(c)},`),
    '  ],',
    `  spawn: ${JSON.stringify(spawn)}, // 방명록 등록 직후 새 캐릭터가 나타나는 곳 { floor, x }`,
    `  couple: ${JSON.stringify(couple)}, // 신랑·신부 자리 { groom: { floor, x }, bride: { floor, x }, fixed } (null이면 무대 가운데, fixed면 자리 고정·아니면 무대 안에서 돌아다님)`,
    '  // NPC 설정 (js/npcs.js 값을 덮어씀) { name, shortMsg, longMsg, mode: fixed|random|stage, floor, x, y } — mode 없으면 처음 발판에서 돌아다님. def가 있으면 개발자 모드에서 추가한 NPC { desc, height, motions }, album이면 앨범 NPC(img/gallery/<album>/), deleted면 기본 NPC 숨김',
    '  npcs: {',
    ...Object.entries(npcs).map(([id, n]) => `    ${JSON.stringify(id)}: ${JSON.stringify(n)},`),
    '  },',
    '};',
    '',
  ].join('\n');
}
