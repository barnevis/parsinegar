// GitLab backend for pey.sync over the GitLab Files API (gitlab.com and
// self-hosted instances via baseUrl): one file per record, addressed by
// repo path. UTF-8 end to end; network is the only transport (fetch
// injected for tests).
//
// GitLab quirk, load-bearing for the engine's conflict guarantee: the
// writes API takes `last_commit_id` as its optimistic lock, but tree
// listings and write responses never carry it — only the blob sha. So the
// rev everywhere is the blob sha (stable across rounds: an unchanged file
// keeps its blob sha), and before every mutating call on an already-seen
// file the adapter re-reads it and refuses when the blob sha moved.
// GitLab reports all commit failures as status 400 with a non-specific
// message; adapter-generated paths and pushed-only-when-changed contents
// make a 400 here overwhelmingly a concurrent change, so it maps to the
// rev-mismatch code (decisions §48).
import { REQUEST_TIMEOUT_MS, commitMessageOf, decodeContent, encodeContent } from './shared.js';

const DEFAULT_BASE_URL = 'https://gitlab.com';
const API_PATH = '/api/v4';
const DEFAULT_BRANCH = 'main';
const TREE_PAGE_SIZE = 100;

/**
 * Backend descriptor registering the GitLab Files backend with the sync
 * engine: factory, error translation and the concurrent-write signal.
 */
export const gitlabAdapterDescriptor = {
  kind: 'gitlab',
  create: (params, fetchFn) => createGitlabAdapter({ ...params, fetchFn }),
  errorMap: {
    GITL_AUTH_FAILED: 'SYNC_AUTH_FAILED',
    GITL_NOT_FOUND: 'SYNC_REPO_NOT_FOUND',
    GITL_RATE_LIMITED: 'SYNC_RATE_LIMITED',
    GITL_REV_MISMATCH: 'SYNC_CONCURRENT_CHANGE',
    GITL_NETWORK_FAILED: 'SYNC_NETWORK_FAILED',
    GITL_REQUEST_FAILED: 'SYNC_NETWORK_FAILED',
    GITL_INVALID_CONFIG: 'SYNC_INVALID_CONFIG',
  },
  revMismatchCode: 'GITL_REV_MISMATCH',
  // Lets the service persist and echo exactly what the backend will use
  // (normalized base URL) and fail on a bad URL before the first request.
  normalizeParams: (params) => ({
    ...params,
    baseUrl: params.baseUrl === undefined || params.baseUrl === null
      ? null
      : normalizeBaseUrl(params.baseUrl),
  }),
};

/**
 * Builds a backend error: machine code, safe message, no secrets.
 * @param {string} code GITL_* code.
 * @param {string} message Log-safe description.
 * @param {object} [detail] Safe metadata (never the token).
 * @returns {Error} Coded error.
 */
function gitlabError(code, message, detail = {}) {
  return Object.assign(new Error(message), { code, detail });
}

/**
 * Builds the permission-denied error for HTTP 403: the token is valid but
 * cannot touch these endpoints — chiefly the `insufficient_scope` case
 * (the REST files API needs the `api` scope; `write_repository` alone
 * only authenticates Git-over-HTTP) or a project token bound to another
 * project. Surfaced as auth, not network, so the UI can point at the
 * token instead of the connection.
 * @param {object} [detail] Safe metadata (never the token).
 * @returns {Error} Coded error.
 */
function insufficientScopes(detail = {}) {
  return gitlabError(
    'GITL_AUTH_FAILED',
    'GitLab backend token cannot access these endpoints (a project/personal token with the api scope is required; write_repository does not authenticate the REST API)',
    detail,
  );
}

/**
 * Normalizes the instance base URL: trims, strips trailing slashes, and
 * accepts only http(s) URLs (self-hosted installs may live under a
 * sub-path). `/api/v4` is appended by the caller.
 * @param {unknown} raw Configured base URL.
 * @returns {string} Normalized base URL without trailing slash.
 * @throws {Error} GITL_INVALID_CONFIG on malformed values.
 */
export function normalizeBaseUrl(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  const value = text.length > 0 ? text : DEFAULT_BASE_URL;
  let parsed = null;
  try {
    parsed = new URL(value);
  } catch {
    throw gitlabError('GITL_INVALID_CONFIG', 'GitLab backend requires a valid base URL', {});
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw gitlabError('GITL_INVALID_CONFIG', 'GitLab backend base URL must start with http(s)', {});
  }
  return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`;
}

/**
 * Creates a GitLab backend bound to one project.
 * @param {object} config Backend config.
 * @param {string} config.repo `owner/name`.
 * @param {string} [config.branch] Branch, default main.
 * @param {string} config.token Project or personal access token
 *   (`api` scope — `write_repository` authenticates only Git-over-HTTP,
 *   never the REST files API).
 * @param {string} [config.baseUrl] Instance base URL, default gitlab.com.
 * @param {Function} [config.fetchFn] Fetch implementation (tests).
 * @returns {object} Backend implementing the sync-target contract.
 * @throws {Error} GITL_INVALID_CONFIG on malformed config.
 */
export function createGitlabAdapter({ repo, branch = DEFAULT_BRANCH, token, baseUrl, fetchFn = globalThis.fetch } = {}) {
  if (typeof repo !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw gitlabError('GITL_INVALID_CONFIG', 'GitLab backend requires an owner/name project path', {});
  }
  if (typeof token !== 'string' || token.length === 0) {
    throw gitlabError('GITL_INVALID_CONFIG', 'GitLab backend requires a token', { repo });
  }
  if (typeof branch !== 'string' || branch.length === 0) {
    throw gitlabError('GITL_INVALID_CONFIG', 'GitLab backend requires a branch', { repo });
  }
  const base = normalizeBaseUrl(baseUrl);
  const api = `${base}/api/v4`;
  const headers = {
    Accept: 'application/json',
    'Private-Token': token,
  };

  async function request(url, options = {}) {
    let response = null;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => {
      try {
        controller?.abort(new Error('GitLab backend request timed out'));
      } catch {
        // Aborting is best effort; the mapping below still applies.
      }
    }, REQUEST_TIMEOUT_MS);
    try {
      response = await fetchFn(url, { ...options, ...(controller ? { signal: controller.signal } : {}), headers: { ...headers, ...(options.headers ?? {}) } });
    } catch (error) {
      if (controller?.signal.aborted === true) {
        throw gitlabError('GITL_NETWORK_FAILED', 'GitLab backend request timed out', { repo });
      }
      throw gitlabError('GITL_NETWORK_FAILED', `GitLab backend unreachable: ${error?.message ?? 'network error'}`, { repo });
    } finally {
      clearTimeout(timer);
    }
    return response;
  }

  function rateLimited(response) {
    return response.status === 429
      || (response.status === 403 && typeof response.headers?.get?.('retry-after') === 'string');
  }

  /**
   * Throws the coded error for a response the caller did not handle
   * specially; returns silently when everything is fine or the caller
   * inspects the status itself.
   * @param {object} response Fetch response.
   * @param {object} [context] Safe metadata (never the token).
   * @param {string} [context.path] Remote path involved.
   * @param {string} [context.branch] Branch involved.
   * @returns {void}
   * @throws {Error} GITL_* error.
   */
  function failIfResponseDoes(response, context = {}) {
    if (rateLimited(response)) {
      throw gitlabError('GITL_RATE_LIMITED', 'GitLab backend rate limit exhausted', { repo, ...context });
    }
    if (response.status === 403) {
      throw insufficientScopes({ repo, ...context });
    }
  }

  function filesUrl(path) {
    const encoded = String(path ?? '')
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `${api}/projects/${encodeURIComponent(repo)}/repository/files/${encoded}`;
  }

  /**
   * Reads one file's full metadata payload: null when the file is gone
   * (absence is data, never a failure), coded failures otherwise.
   * @param {string} path Remote path.
   * @returns {Promise<object|null>} Metadata payload.
   * @throws {Error} GITL_* error.
   */
  async function readPayload(path) {
    const response = await request(`${filesUrl(path)}?ref=${encodeURIComponent(branch)}`);
    if (response.status === 404) {
      return null;
    }
    if (response.status === 401) {
      throw gitlabError('GITL_AUTH_FAILED', 'GitLab backend rejected the token', { repo, path });
    }
    failIfResponseDoes(response, { path });
    if (!response.ok) {
      throw gitlabError('GITL_REQUEST_FAILED', `GitLab backend read failed: HTTP ${response.status}`, { repo, path });
    }
    return response.json();
  }

  async function readOne(path) {
    const payload = await readPayload(path);
    if (!payload) {
      return null;
    }
    return { content: decodeContent(payload.content), rev: payload.blob_id ?? null };
  }

  /**
   * Guard for mutating calls on files the engine has already seen: the
   * remote blob must still be the one last synced, or the round fails as
   * a concurrent change (nothing is ever silently overwritten). Returns
   * the full metadata payload so the caller can pin `last_commit_id`.
   * @param {string} path Remote path.
   * @param {string} rev Blob sha last seen by the engine.
   * @returns {object} File metadata payload.
   * @throws {Error} GITL_REV_MISMATCH or read failures.
   */
  async function assertUnchanged(path, rev) {
    const payload = await readPayload(path);
    if (!payload || payload?.blob_id !== rev) {
      // Gone or moved mid-round: the engine planned against a file that
      // no longer holds the version it saw.
      throw gitlabError('GITL_REV_MISMATCH', 'GitLab backend file changed underneath the write', { repo, path });
    }
    return payload;
  }

  async function collectPage(url, out) {
    const response = await request(url);
    if (response.status === 404) {
      // 17.7+: a missing path is 404; for the engine the empty tree is
      // data, never an error (open() already validated the project).
      return out;
    }
    if (response.status === 401) {
      throw gitlabError('GITL_AUTH_FAILED', 'GitLab backend rejected the token', { repo });
    }
    failIfResponseDoes(response);
    if (!response.ok) {
      throw gitlabError('GITL_REQUEST_FAILED', `GitLab backend list failed: HTTP ${response.status}`, { repo });
    }
    const entries = await response.json();
    for (const item of Array.isArray(entries) ? entries : []) {
      if (item?.type === 'blob' && typeof item.path === 'string') {
        out.push({ path: item.path, rev: item.id ?? null });
      }
    }
    // Keyset pagination: the Link header (rel="next") carries the exact
    // next URL including the page token — follow it verbatim, with the
    // auth headers applied again on every hop.
    const link = response.headers?.get?.('link');
    const match = typeof link === 'string' ? link.match(/<([^>]+)>;\s*rel="next"/i) : null;
    if (match) {
      await collectPage(match[1], out);
    }
    return out;
  }

  return {
    kind: 'gitlab',

    async open() {
      const project = `${api}/projects/${encodeURIComponent(repo)}`;
      const projectResponse = await request(project);
      if (projectResponse.status === 401) {
        throw gitlabError('GITL_AUTH_FAILED', 'GitLab backend rejected the token', { repo });
      }
      if (projectResponse.status === 404) {
        throw gitlabError('GITL_NOT_FOUND', 'GitLab project not found', { repo });
      }
      if (rateLimited(projectResponse)) {
        throw gitlabError('GITL_RATE_LIMITED', 'GitLab backend rate limit exhausted', { repo });
      }
      if (projectResponse.status === 403) {
        throw insufficientScopes({ repo });
      }
      if (!projectResponse.ok) {
        throw gitlabError('GITL_REQUEST_FAILED', `GitLab backend check failed: HTTP ${projectResponse.status}`, { repo });
      }
      const branchResponse = await request(`${project}/repository/branches/${encodeURIComponent(branch)}`);
      if (branchResponse.status === 404) {
        throw gitlabError('GITL_NOT_FOUND', 'GitLab branch not found', { repo, branch });
      }
      if (branchResponse.status === 401) {
        throw gitlabError('GITL_AUTH_FAILED', 'GitLab backend rejected the token', { repo, branch });
      }
      failIfResponseDoes(branchResponse, { branch });
      if (!branchResponse.ok) {
        throw gitlabError('GITL_REQUEST_FAILED', `GitLab backend check failed: HTTP ${branchResponse.status}`, { repo, branch });
      }
      return { kind: 'gitlab', repo, branch, baseUrl: base };
    },

    async listDir(path) {
      const subdir = path ? `&path=${encodeURIComponent(path)}` : '';
      const first = `${api}/projects/${encodeURIComponent(repo)}/repository/tree?recursive=true&ref=${encodeURIComponent(branch)}&pagination=keyset&per_page=${TREE_PAGE_SIZE}${subdir}`;
      return collectPage(first, []);
    },

    async readFile(path) {
      return readOne(path);
    },

    async writeFile(path, content, rev = null, options = null) {
      const known = rev !== null && rev !== undefined;
      const body = {
        branch,
        commit_message: commitMessageOf(options, `pey.sync write ${path}`),
        encoding: 'base64',
        content: encodeContent(content),
      };
      if (known) {
        const payload = await assertUnchanged(path, rev);
        if (typeof payload?.last_commit_id === 'string') {
          body.last_commit_id = payload.last_commit_id;
        }
      }
      const response = await request(filesUrl(path), {
        method: known ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.status === 401) {
        throw gitlabError('GITL_AUTH_FAILED', 'GitLab backend rejected the token', { repo, path });
      }
      failIfResponseDoes(response, { path });
      if (response.status === 400 || response.status === 409) {
        // The generic commit-failure 400 with the double verification
        // above reads as a concurrent change; nothing is overwritten.
        throw gitlabError('GITL_REV_MISMATCH', 'GitLab backend file changed underneath the write', { repo, path });
      }
      if (!response.ok) {
        throw gitlabError('GITL_REQUEST_FAILED', `GitLab backend write failed: HTTP ${response.status}`, { repo, path });
      }
      // The write response names only path and branch: one follow-up read
      // resolves the new blob sha so the snapshot stays exact.
      const written = await readOne(path);
      return { rev: written?.rev ?? null };
    },

    async deleteFile(path, rev = null, options = null) {
      const lock = {};
      // Resolve-and-lock in one read: an absent file (whatever rev the
      // engine carried) succeeds silently — idempotent deletes keep
      // retries safe; a known rev must still be the synced blob.
      const payload = await readPayload(path);
      if (!payload) {
        return { ok: true };
      }
      if (rev !== null && rev !== undefined && payload.blob_id !== rev) {
        throw gitlabError('GITL_REV_MISMATCH', 'GitLab backend file changed underneath the write', { repo, path });
      }
      if (typeof payload?.last_commit_id === 'string') {
        lock.last_commit_id = payload.last_commit_id;
      }
      const response = await request(filesUrl(path), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch,
          commit_message: commitMessageOf(options, `pey.sync delete ${path}`),
          ...lock,
        }),
      });
      if (response.status === 404) {
        return { ok: true };
      }
      if (response.status === 401) {
        throw gitlabError('GITL_AUTH_FAILED', 'GitLab backend rejected the token', { repo, path });
      }
      failIfResponseDoes(response, { path });
      if (!response.ok) {
        throw gitlabError('GITL_REQUEST_FAILED', `GitLab backend delete failed: HTTP ${response.status}`, { repo, path });
      }
      return { ok: true };
    },
  };
}
