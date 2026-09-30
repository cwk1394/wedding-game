import { GitHub } from './_lib/github.js';
import { corsHeaders, json, preflight } from './_lib/http.js';

// 브라우저의 사전 요청에 응답합니다.
export const OPTIONS = preflight;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MOTIONS = ['walk', 'jump', 'ladder', 'rope', 'prone'];
const STAT_KEYS = ['str', 'dex', 'int', 'luk'];

// 문자열만 허용하고 최대 길이를 제한합니다.
function text(value, maxLength) {
  return typeof value === 'string'
    ? value.trim().slice(0, maxLength)
    : '';
}

// 관계와 성향에 사용하는 영문 키를 확인합니다.
function validKey(value) {
  return typeof value === 'string' && /^[a-z]{1,20}$/.test(value)
    ? value
    : null;
}

// HTTPS 이미지 주소 또는 저장소 내부 이미지 경로만 허용합니다.
function imageUrl(value) {
  if (typeof value !== 'string') return null;

  if (value.startsWith('https://')) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password
        ? url.href
        : null;
    } catch {
      return null;
    }
  }

  if (
    /^img\/[\w\-/.]+\.(png|webp)$/.test(value) &&
    !value.includes('..')
  ) {
    return value;
  }

  return null;
}

// 방명록 본문의 JSON 데이터를 읽습니다.
function parseBody(body) {
  if (typeof body !== 'string') return null;

  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');

  if (start < 0 || end < start) return null;

  try {
    const data = JSON.parse(body.slice(start, end + 1));

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

// 공개할 항목만 선택합니다.
// 비밀번호, 비밀번호 해시 및 원본 본문은 반환하지 않습니다.
function toGuest(discussion) {
  if (!discussion) return null;

  const data = parseBody(discussion.body);
  if (!data) return null;

  const name = text(data.name, 20);
  if (!name) return null;

  const oldSide = ['groom', 'bride', 'both'].includes(data.relation);

  const validStats =
    data.stats &&
    typeof data.stats === 'object' &&
    STAT_KEYS.every(
      (key) =>
        Number.isInteger(data.stats[key]) &&
        data.stats[key] >= 4 &&
        data.stats[key] <= 13
    );

  const guest = {
    id:
      typeof data.id === 'string' && UUID_RE.test(data.id)
        ? data.id.toLowerCase()
        : `d${discussion.number}`,
    name,
    shortMsg: text(data.shortMsg, 20),
    longMsg: text(data.longMsg, 1000),
    side: validKey(data.side) ?? (oldSide ? data.relation : null),
    relation: oldSide ? null : validKey(data.relation),
    personality: validKey(data.personality),
    title: text(data.title, 12) || null,
    stats: validStats
      ? Object.fromEntries(
          STAT_KEYS.map((key) => [key, data.stats[key]])
        )
      : null,
    spriteUrl: imageUrl(data.spriteUrl),
    number: discussion.number,
    createdAt: discussion.createdAt,
  };

  for (const motion of MOTIONS) {
    const field = `${motion}Url`;
    guest[field] = imageUrl(data[field]);
  }

  return guest;
}

// 최신 방명록 목록을 읽어 반환합니다.
export async function GET(request) {
  const headers = {
    ...corsHeaders(request),
    'Cache-Control': 'no-store',
    'CDN-Cache-Control': 'no-store',
    'Vercel-CDN-Cache-Control': 'no-store',
  };

  // 원작자 저장소를 기본값으로 사용하지 않습니다.
  const env = {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GITHUB_OWNER: process.env.GITHUB_OWNER,
    GITHUB_REPO: process.env.GITHUB_REPO,
    GITHUB_BRANCH: process.env.GITHUB_BRANCH || 'main',
    DISCUSSION_CATEGORY:
      process.env.DISCUSSION_CATEGORY || '방명록',
  };

  if (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPO) {
    return json(
      { error: '방명록 서버 설정을 확인해주세요.' },
      503,
      headers
    );
  }

  try {
    const github = new GitHub(env);
    const { categoryId } = await github.getDiscussionTarget();

    const guests = [];
    let after = null;

    // 한 번에 100개씩 읽고, 다음 페이지가 있으면 이어서 읽습니다.
    do {
      const result = await github.graphql(
        `query(
          $owner: String!,
          $repo: String!,
          $categoryId: ID!,
          $after: String
        ) {
          repository(owner: $owner, name: $repo) {
            discussions(
              first: 100,
              after: $after,
              categoryId: $categoryId,
              orderBy: { field: CREATED_AT, direction: ASC }
            ) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                number
                body
                createdAt
              }
            }
          }
        }`,
        {
          owner: env.GITHUB_OWNER,
          repo: env.GITHUB_REPO,
          categoryId,
          after,
        }
      );

      const page = result?.repository?.discussions;

      if (!page || !Array.isArray(page.nodes) || !page.pageInfo) {
        throw new Error('방명록 조회 응답 형식이 올바르지 않습니다.');
      }

      for (const discussion of page.nodes) {
        const guest = toGuest(discussion);
        if (guest) guests.push(guest);
      }

      if (page.pageInfo.hasNextPage) {
        const nextCursor = page.pageInfo.endCursor;

        if (!nextCursor || nextCursor === after) {
          throw new Error('다음 페이지 정보를 확인할 수 없습니다.');
        }

        after = nextCursor;
      } else {
        after = null;
      }
    } while (after);

    return json(
      {
        updatedAt: new Date().toISOString(),
        guests,
      },
      200,
      headers
    );
  } catch {
    // 내부 오류나 인증 정보를 외부 응답에 노출하지 않습니다.
    return json(
      { error: '최신 방명록을 불러오지 못했어요.' },
      502,
      headers
    );
  }
}
