// GitHub Discussions의 방명록 글을 모두 읽어 guests.json으로 저장한다.
// GitHub Actions에서 실행: GITHUB_TOKEN, GITHUB_REPOSITORY 환경변수 필요.
//   node scripts/fetch-guests.mjs <출력 경로>

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fetchGuestbookDiscussions, parseBody, UUID_RE } from './lib/discussions.mjs';

const outPath = process.argv[2] || 'data/guests.json';

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
// 이미지 주소: https URL 또는 저장소 내부 경로(img/... .png)만 허용
const imageUrl = (v) =>
  typeof v === 'string' && (v.startsWith('https://') || (/^img\/[\w\-/.]+\.png$/.test(v) && !v.includes('..')))
    ? v
    : null;

const MOTIONS = ['walk', 'jump', 'ladder', 'rope', 'prone'];

// 관계·성향 키 (한글 이름은 js/config.js). 모르는 값이면 null
const key = (v) => (typeof v === 'string' && /^[a-z]{1,20}$/.test(v) ? v : null);
// 능력치 { str, dex, int, luk } 각 4~13 (API가 합 25까지 검사함). 없거나 이상하면 null
const stats = (v) =>
  v && ['str', 'dex', 'int', 'luk'].every((k) => Number.isInteger(v[k]) && v[k] >= 4 && v[k] <= 13)
    ? { str: v.str, dex: v.dex, int: v.int, luk: v.luk }
    : null;

/**
 * 본문에 없는 동작 이미지라도 저장소의 img/guests/<uuid>/<동작>.png 가 있으면 채운다.
 * (나중에 추가한 동작 이미지 — 예: 기존 하객의 엎드리기 — 를 Discussion 본문 수정 없이 반영)
 */
function fillMotionFiles(guest) {
  if (!UUID_RE.test(guest.id) || !guest.spriteUrl) return guest;
  for (const m of MOTIONS) {
    const path = `img/guests/${guest.id}/${m}.png`;
    if (!guest[`${m}Url`] && existsSync(path)) guest[`${m}Url`] = path;
  }
  return guest;
}

function toGuest(discussion) {
  const data = parseBody(discussion.body);
  const name = str(data?.name, 20);
  if (!name) {
    console.warn(`#${discussion.number} "${discussion.title}": JSON 파싱 실패 또는 name 없음 → 건너뜀`);
    return null;
  }
  return {
    // API로 등록된 글은 UUID, 수동으로 쓴 옛 글은 Discussion 번호로 구분
    id: UUID_RE.test(data.id) ? data.id.toLowerCase() : `d${discussion.number}`,
    name,
    shortMsg: str(data.shortMsg, 20),
    longMsg: str(data.longMsg, 1000),
    // 예전 글은 relation에 신랑측/신부측/양측(groom|bride|both)가 들어 있음 → side로 옮김
    side: key(data.side) ?? (['groom', 'bride', 'both'].includes(data.relation) ? data.relation : null),
    relation: ['groom', 'bride', 'both'].includes(data.relation) ? null : key(data.relation),
    personality: key(data.personality),
    title: str(data.title, 12) || null,
    stats: stats(data.stats),
    spriteUrl: imageUrl(data.spriteUrl),
    walkUrl: imageUrl(data.walkUrl),
    jumpUrl: imageUrl(data.jumpUrl),
    ladderUrl: imageUrl(data.ladderUrl),
    ropeUrl: imageUrl(data.ropeUrl),
    proneUrl: imageUrl(data.proneUrl),
    number: discussion.number, // 수정/삭제 요청용 (본문의 pw 해시는 guests.json에 넣지 않음)
    createdAt: discussion.createdAt,
  };
}

const discussions = await fetchGuestbookDiscussions();
const guests = discussions.map(toGuest).filter(Boolean).map(fillMotionFiles);

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify({ updatedAt: new Date().toISOString(), guests }, null, 2));
console.log(`방명록 ${guests.length}개 → ${outPath}`);
