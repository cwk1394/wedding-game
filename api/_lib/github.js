// GitHub API 공통 (방명록 등록, 개발자 모드 지도 저장에서 사용). `_` 폴더라 엔드포인트 아님.
// env: { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, DISCUSSION_CATEGORY }

export const GITHUB_ENV = {
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GITHUB_OWNER: process.env.GITHUB_OWNER || 'kobe-KANG',
  GITHUB_REPO: process.env.GITHUB_REPO || 'guestbook',
  GITHUB_BRANCH: process.env.GITHUB_BRANCH || 'main',
  DISCUSSION_CATEGORY: process.env.DISCUSSION_CATEGORY || '방명록',
};

export class GitHub {
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
        'User-Agent': 'guestbook-api',
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

  /**
   * 여러 파일을 커밋 하나로 브랜치에 올린다. 동시 등록으로 브랜치가 앞서가면 재시도.
   * files: { path, content(base64) } | { path, sha } (이미 있는 blob, 파일 옮기기) | { path, sha: null } (삭제)
   */
  async commitFiles(files, message) {
    const branch = this.env.GITHUB_BRANCH;
    const blobs = await Promise.all(
      files.map((f) =>
        'content' in f ? this.request('POST', `${this.repoPath}/git/blobs`, { content: f.content, encoding: 'base64' }) : { sha: f.sha }
      )
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

  /** 저장소 파일/폴더 조회 (contents API). 없으면 null */
  async getContents(path) {
    try {
      return await this.request('GET', `${this.repoPath}/contents/${path}?ref=${this.env.GITHUB_BRANCH}`);
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
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

  /** 번호로 Discussion 조회 → { id, number, title, body, category } (없으면 null) */
  async getDiscussion(number) {
    const data = await this.graphql(
      `query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          discussion(number: $number) { id number title body category { name } }
        }
      }`,
      { owner: this.env.GITHUB_OWNER, repo: this.env.GITHUB_REPO, number }
    );
    return data.repository.discussion;
  }

  async updateDiscussion(discussionId, title, body) {
    await this.graphql(
      `mutation($id: ID!, $title: String!, $body: String!) {
        updateDiscussion(input: { discussionId: $id, title: $title, body: $body }) { discussion { number } }
      }`,
      { id: discussionId, title, body }
    );
  }

  async deleteDiscussion(discussionId) {
    await this.graphql(
      `mutation($id: ID!) { deleteDiscussion(input: { id: $id }) { discussion { number } } }`,
      { id: discussionId }
    );
  }
}
