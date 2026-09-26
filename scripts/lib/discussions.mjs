// GitHub Discussions의 방명록 카테고리 글을 읽는 공통 코드 (fetch-guests, cleanup-guest-images에서 사용).
// GITHUB_TOKEN, GITHUB_REPOSITORY 환경변수 필요.

const token = process.env.GITHUB_TOKEN;
const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
const categoryName = process.env.GUESTBOOK_CATEGORY || '방명록';

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

/** 방명록 카테고리의 Discussion 전부 (작성순) */
export async function fetchGuestbookDiscussions() {
  const categoryId = await findCategoryId();
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
export function parseBody(body) {
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
