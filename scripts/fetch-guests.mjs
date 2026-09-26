// GitHub Discussions의 방명록 글을 모두 읽어 guests.json으로 저장한다.
// GitHub Actions에서 실행: GITHUB_TOKEN, GITHUB_REPOSITORY 환경변수 필요.
//   node scripts/fetch-guests.mjs <출력 경로>

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const token = process.env.GITHUB_TOKEN;
const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
const categoryName = process.env.GUESTBOOK_CATEGORY || '방명록';
const outPath = process.argv[2] || 'data/guests.json';

if (!token || !owner || !repo) {
  console.error('GITHUB_TOKEN, GITHUB_REPOSITORY 환경변수가 필요합니다.');
  process.exit(1);
}

async function graphql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
  return json.data;
}

async function findCategoryId() {
  const data = await graphql(
    `query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        discussionCategories(first: 50) { nodes { id name } }
      }
    }`,
    { owner, repo }
  );
  const category = data.repository.discussionCategories.nodes.find((c) => c.name === categoryName);
  if (!category) throw new Error(`Discussion 카테고리 "${categoryName}"를 찾을 수 없습니다.`);
  return category.id;
}

async function fetchDiscussions(categoryId) {
  const all = [];
  let after = null;
  do {
    const data = await graphql(
      `query($owner: String!, $repo: String!, $categoryId: ID!, $after: String) {
        repository(owner: $owner, name: $repo) {
          discussions(first: 100, after: $after, categoryId: $categoryId,
                      orderBy: { field: CREATED_AT, direction: ASC }) {
            pageInfo { hasNextPage endCursor }
            nodes { id number title body createdAt }
          }
        }
      }`,
      { owner, repo, categoryId, after }
    );
    const page = data.repository.discussions;
    all.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return all;
}

/** 본문에서 JSON 부분만 뽑아 파싱 (```json 코드블록으로 감싸져 있어도 OK) */
function parseBody(body) {
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
    // Worker로 등록된 글은 UUID, 수동으로 쓴 옛 글은 Discussion 번호로 구분
    id: UUID_RE.test(data.id) ? data.id.toLowerCase() : `d${discussion.number}`,
    name,
    shortMsg: str(data.shortMsg, 10),
    longMsg: str(data.longMsg, 1000),
    spriteUrl: imageUrl(data.spriteUrl),
    walkUrl: imageUrl(data.walkUrl),
    createdAt: discussion.createdAt,
  };
}

const categoryId = await findCategoryId();
const discussions = await fetchDiscussions(categoryId);
const guests = discussions.map(toGuest).filter(Boolean);

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify({ updatedAt: new Date().toISOString(), guests }, null, 2));
console.log(`방명록 ${guests.length}개 → ${outPath}`);
