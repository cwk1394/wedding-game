// 방명록 Discussion에서 참조하지 않는 하객 이미지 폴더(img/guests/<uuid>/)를 git rm 한다.
// 커밋/push는 워크플로가 한다. GitHub Actions에서 실행 (전체 git 히스토리 필요: fetch-depth 0).
//   GITHUB_TOKEN, GITHUB_REPOSITORY 필요. 선택: GRACE_HOURS(기본 24), DRY_RUN=true
//
// 남기는 폴더
//  - 방명록 글 본문의 id(UUID)와 같은 이름의 폴더
//  - 본문 어딘가에 img/guests/<폴더>/ 경로가 적혀 있는 폴더 (수동 작성 글 대비)
//  - 마지막 커밋이 GRACE_HOURS 이내인 폴더: API는 이미지 커밋 → Discussion 작성 순서라
//    그 사이에 돌면 방금 올라온 이미지를 지울 수 있어서 여유를 둔다.

import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fetchGuestbookDiscussions, parseBody, UUID_RE } from './lib/discussions.mjs';

const GUESTS_DIR = 'img/guests';
const graceHours = Number(process.env.GRACE_HOURS ?? 24);
const dryRun = process.env.DRY_RUN === 'true';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

async function listFolders() {
  try {
    const entries = await readdir(GUESTS_DIR, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

function referencedFolders(discussions) {
  const keep = new Set();
  for (const d of discussions) {
    const id = parseBody(d.body)?.id;
    if (typeof id === 'string' && UUID_RE.test(id)) keep.add(id.toLowerCase());
    for (const m of d.body.matchAll(/img\/guests\/([^/"'\s)]+)\//g)) keep.add(m[1]);
  }
  return keep;
}

const folders = await listFolders();
if (!folders.length) {
  console.log(`${GUESTS_DIR}에 폴더 없음`);
  process.exit(0);
}

// 조회 실패(카테고리 없음, API 오류)면 예외로 종료 → 아무것도 지우지 않음
const discussions = await fetchGuestbookDiscussions();
const keep = referencedFolders(discussions);
const now = Date.now() / 1000;

const removed = [];
for (const name of folders) {
  if (keep.has(name) || keep.has(name.toLowerCase())) continue;
  const path = `${GUESTS_DIR}/${name}`;
  const committedAt = Number(git('log', '-1', '--format=%ct', '--', path)) || now; // 커밋 안 된 폴더는 방금 것으로 취급
  const ageHours = (now - committedAt) / 3600;
  if (ageHours < graceHours) {
    console.log(`보류  ${name} (올라온 지 ${ageHours.toFixed(1)}시간 < ${graceHours}시간)`);
    continue;
  }
  console.log(`삭제  ${name} (올라온 지 ${ageHours.toFixed(1)}시간, 참조하는 방명록 없음)`);
  if (!dryRun) git('rm', '-r', '-q', '--', path);
  removed.push(name);
}

console.log(
  `방명록 ${discussions.length}개, 폴더 ${folders.length}개 중 ${removed.length}개 ${dryRun ? '삭제 대상 (DRY_RUN)' : '삭제'}`
);
