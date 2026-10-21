// Verifies the sync-target backend contract against the git and gitlab
// backends: the five-method set, the error rules and the registration
// descriptor. A new kind (WebDAV, Drive, …) replicates this shape against
// its own backend.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createGitAdapter, gitAdapterDescriptor } from '../../adapters/git-adapter.js';
import { createGitlabAdapter, gitlabAdapterDescriptor } from '../../adapters/gitlab-adapter.js';

function response(status, payload = null) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async () => payload,
  };
}

function setup(routes) {
  const calls = [];
  const fetchFn = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET' });
    for (const route of routes) {
      if (route.match(url, options)) {
        return route.reply();
      }
    }
    throw new Error(`unexpected request: ${options.method ?? 'GET'} ${url}`);
  };
  const backend = createGitAdapter({ repo: 'user/notes', branch: 'main', token: 'secret-token', fetchFn });
  return { backend, calls };
}

function setupGitlab(routes, { baseUrl } = {}) {
  const calls = [];
  const fetchFn = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET' });
    for (const route of routes) {
      if (route.match(url, options)) {
        return route.reply();
      }
    }
    throw new Error(`unexpected request: ${options.method ?? 'GET'} ${url}`);
  };
  const backend = createGitlabAdapter({ repo: 'user/notes', branch: 'main', token: 'secret-token', baseUrl, fetchFn });
  return { backend, calls };
}

test('should_register_kind_with_mapper_when_described', () => {
  assert.equal(gitAdapterDescriptor.kind, 'git');
  assert.equal(typeof gitAdapterDescriptor.create, 'function');
  assert.equal(gitAdapterDescriptor.errorMap.GIT_AUTH_FAILED, 'SYNC_AUTH_FAILED');
  assert.equal(gitAdapterDescriptor.manifestPath, undefined, 'expected no remote metadata in the path-identity scheme');
  const backend = gitAdapterDescriptor.create({ repo: 'u/r', branch: 'main', token: 't' }, async () => response(200, {}));
  assert.equal(backend.kind, 'git');
  for (const method of ['open', 'listDir', 'readFile', 'writeFile', 'deleteFile']) {
    assert.equal(typeof backend[method], 'function', `expected ${method}`);
  }
});

test('should_validate_reachability_when_opened', async () => {
  const { backend } = setup([
    { match: (url) => url.endsWith('/repos/user/notes'), reply: () => response(200, {}) },
    { match: (url) => url.includes('/branches/main'), reply: () => response(200, {}) },
  ]);
  assert.deepEqual(await backend.open(), { kind: 'git', repo: 'user/notes', branch: 'main' });
});

test('should_read_missing_root_as_empty_when_listed', async () => {
  const { backend } = setup([{ match: () => true, reply: () => response(404, {}) }]);
  assert.deepEqual(await backend.listDir(''), []);
  assert.equal(await backend.readFile('gone.md'), null);
  assert.deepEqual(await backend.deleteFile('gone.md', 'sha-1'), { ok: true });
});

test('should_throw_prefixed_codes_without_secrets_when_failing', async () => {
  const { backend } = setup([{ match: () => true, reply: () => response(401, {}) }]);
  const error = await backend.open().catch((caught) => caught);
  assert.ok(String(error?.code).startsWith('GIT_'));
  assert.ok(!String(error?.message).includes('secret-token'));
});

test('should_register_gitlab_kind_with_mapper_when_described', () => {
  assert.equal(gitlabAdapterDescriptor.kind, 'gitlab');
  assert.equal(typeof gitlabAdapterDescriptor.create, 'function');
  assert.equal(gitlabAdapterDescriptor.errorMap.GITL_AUTH_FAILED, 'SYNC_AUTH_FAILED');
  assert.equal(gitlabAdapterDescriptor.errorMap.GITL_REV_MISMATCH, 'SYNC_CONCURRENT_CHANGE');
  assert.equal(gitlabAdapterDescriptor.manifestPath, undefined, 'expected no remote metadata in the path-identity scheme');
  const backend = gitlabAdapterDescriptor.create({ repo: 'u/r', branch: 'main', token: 't' }, async () => response(200, {}));
  assert.equal(backend.kind, 'gitlab');
  for (const method of ['open', 'listDir', 'readFile', 'writeFile', 'deleteFile']) {
    assert.equal(typeof backend[method], 'function', `expected ${method}`);
  }
});

test('should_validate_gitlab_reachability_when_opened', async () => {
  const { backend } = setupGitlab([
    { match: (url) => url.includes('/api/v4/projects/user%2Fnotes') && !url.includes('/repository/'), reply: () => response(200, {}) },
    { match: (url) => url.includes('/repository/branches/main'), reply: () => response(200, {}) },
  ]);
  assert.deepEqual(await backend.open(), { kind: 'gitlab', repo: 'user/notes', branch: 'main', baseUrl: 'https://gitlab.com' });
});

test('should_read_gitlab_missing_tree_and_file_as_empty_when_listed', async () => {
  const { backend } = setupGitlab([{ match: (url) => url.includes('/repository/'), reply: () => response(404, {}) }]);
  assert.deepEqual(await backend.listDir(''), []);
  assert.equal(await backend.readFile('gone.md'), null);
  assert.deepEqual(await backend.deleteFile('gone.md', 'blob-1'), { ok: true });
});

test('should_throw_gitlab_prefixed_codes_without_secrets_when_failing', async () => {
  const { backend } = setupGitlab([{ match: () => true, reply: () => response(401, {}) }]);
  const error = await backend.open().catch((caught) => caught);
  assert.ok(String(error?.code).startsWith('GITL_'));
  assert.ok(!String(error?.message).includes('secret-token'));
});
