// 방명록 API (Cloudflare Worker)
// POST /api/guestbook  { name, shortMsg, longMsg, images?: { front, walk } }  (이미지는 PNG base64)
//   1) UUID 발급
//   2) 이미지를 img/guests/<uuid>/front.png, walk.png 로 저장소에 한 커밋으로 올림
//   3) GitHub Discussion(방명록 카테고리)에 JSON 본문으로 글 작성
//   4) 생성된 guest 객체 반환
//
// 환경변수: GITHUB_TOKEN(secret), GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, DISCUSSION_CATEGORY, ALLOWED_ORIGINS

const LIMITS = {
  name: 10,
  shortMsg: 10,
  longMsg: 500,
  imageBytes: 512 * 1024, // 브라우저에서 축소해서 보내므로 넉넉한 상한
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (!cors['Access-Control-Allow-Origin']) throw new HttpError(403, '허용되지 않은 출처입니다.');
      const { pathname } = new URL(request.url);
      if (request.method === 'POST' && pathname === '/api/guestbook') {
        const guest = await createGuest(await readJson(request), env);
        return json({ guest }, 201, cors);
      }
      throw new HttpError(404, 'Not found');
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      return json({ error: status === 500 ? '서버 오류가 발생했습니다.' : err.message }, status, cors);
    }
  },
};

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
  if (allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, '잘못된 요청 형식입니다.');
  }
}

// ---------- 입력 검증 ----------

function text(value, field, max, { required = true } = {}) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (required && !v) throw new HttpError(400, `${field}: 꼭 입력해 주세요.`);
  if ([...v].length > max) throw new HttpError(400, `${field}: ${max}자 이하로 입력해 주세요.`);
  return v;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** data URL 또는 순수 base64 → 검증된 순수 base64 (없으면 null) */
function pngBase64(value, field) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(400, `${field} 이미지 형식이 잘못되었습니다.`);
  const b64 = value.replace(/^data:image\/png;base64,/, '');
  let head;
  try {
    head = atob(b64.slice(0, 12));
  } catch {
    throw new HttpError(400, `${field} 이미지 형식이 잘못되었습니다.`);
  }
  if (!PNG_SIGNATURE.every((byte, i) => head.charCodeAt(i) === byte)) {
    throw new HttpError(400, `${field} 이미지는 PNG여야 합니다.`);
  }
  if ((b64.length * 3) / 4 > LIMITS.imageBytes) throw new HttpError(413, `${field} 이미지가 너무 큽니다.`);
  return b64;
}

// ---------- 방명록 생성 ----------

async function createGuest(body, env) {
  const name = text(body.name, '이름', LIMITS.name);
  const shortMsg = text(body.shortMsg, '한줄 멘트', LIMITS.shortMsg);
  const longMsg = text(body.longMsg, '방명록', LIMITS.longMsg);
  const front = pngBase64(body.images?.front, '정면');
  const walk = pngBase64(body.images?.walk, '걷기');
  if (walk && !front) throw new HttpError(400, '걷기 이미지만 올릴 수는 없습니다. 정면 이미지도 함께 올려 주세요.');

  const id = crypto.randomUUID();
  const dir = `img/guests/${id}`;
  const files = [];
  if (front) files.push({ path: `${dir}/front.png`, content: front });
  if (walk) files.push({ path: `${dir}/walk.png`, content: walk });

  const guest = {
    id,
    name,
    shortMsg,
    longMsg,
    spriteUrl: front ? `${dir}/front.png` : null,
    walkUrl: walk ? `${dir}/walk.png` : null,
  };

  const github = new GitHub(env);
  if (files.length) await github.commitFiles(files, `Add guest sprite ${id} (${name})`);
  const discussion = await github.createDiscussion(
    `[방명록] ${name}`,
    '```json\n' + JSON.stringify(guest, null, 2) + '\n```'
  );

  return { ...guest, discussionNumber: discussion.number };
}

// ---------- GitHub API ----------

class GitHub {
  constructor(env) {
    this.env = env;
    this.repoPath = `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;
  }

  async request(method, path, body) {
    const res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'guestbook-worker',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`GitHub ${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async graphql(query, variables) {
    const data = await this.request('POST', '/graphql', { query, variables });
    if (data.errors) throw new Error(`GitHub GraphQL: ${JSON.stringify(data.errors)}`);
    return data.data;
  }

  /** 여러 파일을 커밋 하나로 브랜치에 올린다. 동시 등록으로 브랜치가 앞서가면 재시도. */
  async commitFiles(files, message) {
    const branch = this.env.GITHUB_BRANCH;
    const blobs = await Promise.all(
      files.map((f) => this.request('POST', `${this.repoPath}/git/blobs`, { content: f.content, encoding: 'base64' }))
    );
    const treeItems = files.map((f, i) => ({ path: f.path, mode: '100644', type: 'blob', sha: blobs[i].sha }));

    for (let attempt = 0; attempt < 3; attempt++) {
      const ref = await this.request('GET', `${this.repoPath}/git/ref/heads/${branch}`);
      const parent = await this.request('GET', `${this.repoPath}/git/commits/${ref.object.sha}`);
      const tree = await this.request('POST', `${this.repoPath}/git/trees`, {
        base_tree: parent.tree.sha,
        tree: treeItems,
      });
      const commit = await this.request('POST', `${this.repoPath}/git/commits`, {
        message,
        tree: tree.sha,
        parents: [parent.sha],
      });
      try {
        await this.request('PATCH', `${this.repoPath}/git/refs/heads/${branch}`, { sha: commit.sha });
        return commit.sha;
      } catch (err) {
        if (err.status !== 422 || attempt === 2) throw err; // 422 = fast-forward 불가 (다른 커밋이 먼저 들어옴)
      }
    }
  }

  async getDiscussionTarget() {
    if (this.constructor.target) return this.constructor.target;
    const data = await this.graphql(
      `query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          id
          discussionCategories(first: 50) { nodes { id name } }
        }
      }`,
      { owner: this.env.GITHUB_OWNER, repo: this.env.GITHUB_REPO }
    );
    const category = data.repository.discussionCategories.nodes.find((c) => c.name === this.env.DISCUSSION_CATEGORY);
    if (!category) throw new Error(`Discussion 카테고리 "${this.env.DISCUSSION_CATEGORY}" 없음`);
    this.constructor.target = { repositoryId: data.repository.id, categoryId: category.id };
    return this.constructor.target;
  }

  async createDiscussion(title, body) {
    const { repositoryId, categoryId } = await this.getDiscussionTarget();
    const data = await this.graphql(
      `mutation($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
        createDiscussion(input: { repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body }) {
          discussion { number url }
        }
      }`,
      { repositoryId, categoryId, title, body }
    );
    return data.createDiscussion.discussion;
  }
}
