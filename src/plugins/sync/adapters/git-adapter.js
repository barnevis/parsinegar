// Git backend for pey.sync over the GitHub Contents API: one file per
// record plus the engine manifest, addressed by repo path. UTF-8 end to
// end; network is the only transport (fetch injected for tests).

const API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const DEFAULT_BRANCH = 'main';

/**
 * Backend descriptor registering the GitHub Contents backend with the sync
 * engine: factory, error translation and the concurrent-write signal. New
 * backends (e.g. WebDAV) register their own descriptor without touching
 * the engine; see adapters/README.md.
 */
export const gitAdapterDescriptor = {
  kind: 'git',
  create: (params, fetchFn) => createGitAdapter({ ...params, fetchFn }),
  errorMap: {
    GIT_AUTH_FAILED: 'SYNC_AUTH_FAILED',
    GIT_NOT_FOUND: 'SYNC_REPO_NOT_FOUND',
    GIT_RATE_LIMITED: 'SYNC_RATE_LIMITED',
    GIT_REV_MISMATCH: 'SYNC_CONCURRENT_CHANGE',
    GIT_NETWORK_FAILED: 'SYNC_NETWORK_FAILED',
    GIT_REQUEST_FAILED: 'SYNC_NETWORK_FAILED',
    GIT_INVALID_CONFIG: 'SYNC_INVALID_CONFIG',
  },
  revMismatchCode: 'GIT_REV_MISMATCH',
};
// Sanctioned/blackholed networks hang instead of refusing: without a
// deadline the UI stalls forever with zero feedback. t.mock.timers drives
// this timer in tests; real clocks everywhere else.
const REQUEST_TIMEOUT_MS = 30000;

/**
 * Builds a backend error: machine code, safe message, no secrets.
 * @param {string} code GIT_* code.
 * @param {string} message Log-safe description.
 * @param {object} [detail] Safe metadata (never the token).
 * @returns {Error} Coded error.
 */
function gitError(code, message, detail = {}) {
  return Object.assign(new Error(message), { code, detail });
}

/**
 * Builds the permission-denied error for HTTP 403: the token is valid but
 * cannot touch this repository (repo not selected, or Contents permission
 * missing on fine-grained tokens). Surfaced as auth, not network, so the
 * UI can point at the token instead of the connection.
 * @param {object} [detail] Safe metadata (never the token).
 * @returns {Error} Coded error.
 */
function accessDenied(detail = {}) {
  return gitError(
    'GIT_AUTH_FAILED',
    'Git backend token cannot access this repository (check repository access and Contents permission)',
    detail,
  );
}

/**
 * Encodes text to base64 without blowing the stack on long files.
 * @param {string} content UTF-8 text.
 * @returns {string} Base64.
 */
function encodeContent(content) {
  const bytes = new TextEncoder().encode(content);
  let binary = '';
  const CHUNK = 8192;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

/**
 * Decodes base64 file content to text (GitHub wraps lines).
 * @param {string} content Base64 payload.
 * @returns {string} UTF-8 text.
 */
function decodeContent(content) {
  const cleaned = String(content ?? '').replace(/\s/g, '');
  const bytes = Uint8Array.from(atob(cleaned), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Creates a git backend bound to one repository.
 * @param {object} config Backend config.
 * @param {string} config.repo `owner/name`.
 * @param {string} [config.branch] Branch, default main.
 * @param {string} config.token Fine-grained personal token (Contents read/write).
 * @param {Function} [config.fetchFn] Fetch implementation (injected in tests).
 * @returns {object} Backend implementing the sync-target contract.
 * @throws {Error} GIT_INVALID_CONFIG on malformed config.
 */
export function createGitAdapter({ repo, branch = DEFAULT_BRANCH, token, fetchFn = globalThis.fetch } = {}) {
  if (typeof repo !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw gitError('GIT_INVALID_CONFIG', 'Git backend requires an owner/name repo', {});
  }
  if (typeof token !== 'string' || token.length === 0) {
    throw gitError('GIT_INVALID_CONFIG', 'Git backend requires a token', { repo });
  }
  if (typeof branch !== 'string' || branch.length === 0) {
    throw gitError('GIT_INVALID_CONFIG', 'Git backend requires a branch', { repo });
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': API_VERSION,
  };

  async function request(path, options = {}) {
    let response = null;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => {
      try {
        controller?.abort(new Error('Git backend request timed out'));
      } catch {
        // Aborting is best effort; the mapping below still applies.
      }
    }, REQUEST_TIMEOUT_MS);
    try {
      response = await fetchFn(`${API_BASE}${path}`, { ...options, ...(controller ? { signal: controller.signal } : {}), headers: { ...headers, ...(options.headers ?? {}) } });
    } catch (error) {
      if (controller?.signal.aborted === true) {
        throw gitError('GIT_NETWORK_FAILED', 'Git backend request timed out', { repo });
      }
      throw gitError('GIT_NETWORK_FAILED', `Git backend unreachable: ${error?.message ?? 'network error'}`, { repo });
    } finally {
      clearTimeout(timer);
    }
    return response;
  }

  function rateLimited(response) {
    return response.status === 403 && response.headers?.get?.('x-ratelimit-remaining') === '0';
  }

  async function contentsUrl(path, forWrite = false) {
    const encoded = String(path ?? '')
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `/repos/${repo}/contents/${encoded}${forWrite ? '' : `?ref=${encodeURIComponent(branch)}`}`;
  }

  async function collectDir(path, out) {
    const response = await request(await contentsUrl(path));
    if (response.status === 404) {
      return out;
    }
    if (!response.ok) {
      if (response.status === 401) {
        throw gitError('GIT_AUTH_FAILED', 'Git backend rejected the token', { repo });
      }
      if (rateLimited(response)) {
        throw gitError('GIT_RATE_LIMITED', 'Git backend rate limit exhausted', { repo });
      }
      if (response.status === 403) {
        throw accessDenied({ repo, path });
      }
      throw gitError('GIT_REQUEST_FAILED', `Git backend list failed: HTTP ${response.status}`, { repo, path });
    }
    const payload = await response.json();
    const entries = Array.isArray(payload) ? payload : [payload];
    for (const item of entries) {
      if (item?.type === 'file') {
        out.push({ path: item.path, rev: item.sha ?? null });
      } else if (item?.type === 'dir') {
        await collectDir(item.path, out);
      }
    }
    return out;
  }

  async function readOne(path) {
    const response = await request(await contentsUrl(path));
    if (response.status === 404) {
      return null;
    }
    if (response.status === 401) {
      throw gitError('GIT_AUTH_FAILED', 'Git backend rejected the token', { repo });
    }
    if (rateLimited(response)) {
      throw gitError('GIT_RATE_LIMITED', 'Git backend rate limit exhausted', { repo });
    }
    if (response.status === 403) {
      throw accessDenied({ repo, path });
    }
    if (!response.ok) {
      throw gitError('GIT_REQUEST_FAILED', `Git backend read failed: HTTP ${response.status}`, { repo, path });
    }
    const payload = await response.json();
    return { content: decodeContent(payload.content), rev: payload.sha ?? null };
  }

  return {
    kind: 'git',

    async open() {
      const repoResponse = await request(`/repos/${repo}`);
      if (repoResponse.status === 401) {
        throw gitError('GIT_AUTH_FAILED', 'Git backend rejected the token', { repo });
      }
      if (repoResponse.status === 404) {
        throw gitError('GIT_NOT_FOUND', 'Git repository not found', { repo });
      }
      if (rateLimited(repoResponse)) {
        throw gitError('GIT_RATE_LIMITED', 'Git backend rate limit exhausted', { repo });
      }
      if (repoResponse.status === 403) {
        throw accessDenied({ repo });
      }
      if (!repoResponse.ok) {
        throw gitError('GIT_REQUEST_FAILED', `Git backend check failed: HTTP ${repoResponse.status}`, { repo });
      }
      const branchResponse = await request(`/repos/${repo}/branches/${encodeURIComponent(branch)}`);
      if (branchResponse.status === 404) {
        throw gitError('GIT_NOT_FOUND', 'Git branch not found', { repo, branch });
      }
      if (branchResponse.status === 403) {
        throw accessDenied({ repo, branch });
      }
      if (!branchResponse.ok) {
        throw gitError('GIT_REQUEST_FAILED', `Git backend check failed: HTTP ${branchResponse.status}`, { repo, branch });
      }
      return { kind: 'git', repo, branch };
    },

    async listDir(path) {
      return collectDir(path ?? '', []);
    },

    async readFile(path) {
      return readOne(path);
    },

    async writeFile(path, content, rev = null) {
      const body = {
        message: `pey.sync write ${path}`,
        content: encodeContent(content),
        branch,
      };
      if (rev !== null && rev !== undefined) {
        body.sha = rev;
      }
      const response = await request(await contentsUrl(path, true), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.status === 409 || response.status === 422) {
        throw gitError('GIT_REV_MISMATCH', 'Git backend file changed underneath the write', { repo, path });
      }
      if (response.status === 401) {
        throw gitError('GIT_AUTH_FAILED', 'Git backend rejected the token', { repo });
      }
      if (rateLimited(response)) {
        throw gitError('GIT_RATE_LIMITED', 'Git backend rate limit exhausted', { repo });
      }
      if (response.status === 403) {
        throw accessDenied({ repo, path });
      }
      if (!response.ok) {
        throw gitError('GIT_REQUEST_FAILED', `Git backend write failed: HTTP ${response.status}`, { repo, path });
      }
      const payload = await response.json();
      return { rev: payload?.content?.sha ?? null };
    },

    async deleteFile(path, rev = null) {
      let sha = rev;
      if (sha === null || sha === undefined) {
        const current = await readOne(path);
        if (!current) {
          return { ok: true };
        }
        sha = current.rev;
      }
      const response = await request(await contentsUrl(path, true), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `pey.sync delete ${path}`, sha, branch }),
      });
      if (response.status === 404) {
        return { ok: true };
      }
      if (response.status === 403) {
        throw accessDenied({ repo, path });
      }
      if (!response.ok) {
        throw gitError('GIT_REQUEST_FAILED', `Git backend delete failed: HTTP ${response.status}`, { repo, path });
      }
      return { ok: true };
    },
  };
}
