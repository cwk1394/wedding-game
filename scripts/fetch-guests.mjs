// GitHub Discussions의 방명록 글을 모두 읽어 guests.json으로 저장한다.
// GitHub Actions에서 실행: GITHUB_TOKEN, GITHUB_REPOSITORY 환경변수 필요.
//   node scripts/fetch-guests.mjs <출력 경로>

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
    shortMsg: str(data.shortMsg, 10),
    longMsg: str(data.longMsg, 1000),
    spriteUrl: imageUrl(data.spriteUrl),
    walkUrl: imageUrl(data.walkUrl),
    jumpUrl: imageUrl(data.jumpUrl),
    ladderUrl: imageUrl(data.ladderUrl),
    ropeUrl: imageUrl(data.ropeUrl),
    proneUrl: imageUrl(data.proneUrl),
    createdAt: discussion.createdAt,
  };
}

const discussions = await fetchGuestbookDiscussions();
const guests = discussions.map(toGuest).filter(Boolean);

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify({ updatedAt: new Date().toISOString(), guests }, null, 2));
console.log(`방명록 ${guests.length}개 → ${outPath}`);
