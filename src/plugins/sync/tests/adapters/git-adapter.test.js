// Verifies the git backend over a fake fetch (never the network).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createGitAdapter } from '../../adapters/git-adapter.js';

function encode(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

function response(status, payload = null, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => payload,
  };
}

function fakeFetch(routes) {
  const calls = [];
  const fetchFn = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET', body: options.body });
    for (const route of routes) {
      if (route.match(url, options)) {
        return route.reply(url, options);
      }
    }
    throw new Error(`unexpected request: ${options.method ?? 'GET'} ${url}`);
  };
  return { fetchFn, calls };
}

function setup(routes) {
  const fake = fakeFetch(routes);
  const backend = createGitAdapter({
    repo: 'user/notes',
    branch: 'main',
    token: 'secret-token',
    fetchFn: fake.fetchFn,
  });
  return { backend, calls: fake.calls };
}

function repoOk() {
  return {
    match: (url) => url.endsWith('/repos/user/notes'),
    reply: () => response(200, {}),
  };
}

function branchOk() {
  return {
    match: (url) => url.includes('/branches/main'),
    reply: () => response(200, {}),
  };
}

test('should_validate_repo_and_branch_when_opened', async () => {
  const { backend, calls } = setup([repoOk(), branchOk()]);
  const opened = await backend.open();
  assert.deepEqual(opened, { kind: 'git', repo: 'user/notes', branch: 'main' });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => !call.url.includes('secret-token')), 'token stays out of URLs');
});

test('should_reject_bad_config_when_created', () => {
  assert.throws(() => createGitAdapter({ repo: 'no-slash', token: 't' }), (error) => error.code === 'GIT_INVALID_CONFIG');
  assert.throws(() => createGitAdapter({ repo: 'u/r' }), (error) => error.code === 'GIT_INVALID_CONFIG');
  assert.throws(() => createGitAdapter({ repo: 'u/r', token: 't', branch: '' }), (error) => error.code === 'GIT_INVALID_CONFIG');
});

test('should_map_auth_and_missing_repo_when_opened', async () => {
  const denied = setup([{
    match: () => true,
    reply: () => response(401, {}),
  }]);
  const authError = await denied.backend.open().catch((error) => error);
  assert.equal(authError.code, 'GIT_AUTH_FAILED');
  assert.ok(!authError.message.includes('secret-token'), 'token stays out of messages');
  const missing = setup([{
    match: () => true,
    reply: () => response(404, {}),
  }]);
  await assert.rejects(missing.backend.open(), (error) => error.code === 'GIT_NOT_FOUND');
});

test('should_map_network_failure_when_opened', async () => {
  const backend = createGitAdapter({
    repo: 'user/notes',
    token: 't',
    fetchFn: async () => { throw new TypeError('fetch failed'); },
  });
  await assert.rejects(backend.open(), (error) => error.code === 'GIT_NETWORK_FAILED');
});

test('should_time_out_when_server_hangs_when_read', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const backend = createGitAdapter({
      repo: 'user/notes',
      token: 't',
      fetchFn: (url, { signal } = {}) => new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    });
    const pending = backend.readFile('a.md');
    // Let the async machinery reach the timer before fast-forwarding it;
    // setImmediate itself is never mocked.
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(30000);
    await assert.rejects(pending, (error) => error.code === 'GIT_NETWORK_FAILED');
  } finally {
    t.mock.timers.reset();
  }
});

test('should_never_abort_after_success_when_completed', async (t) => {
  // Pins the clearTimeout half of the deadline: without it the timer
  // survives success and aborts a settled controller.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let aborted = false;
    const backend = createGitAdapter({
      repo: 'user/notes',
      token: 't',
      fetchFn: (url, { signal } = {}) => {
        signal?.addEventListener('abort', () => {
          aborted = true;
        });
        return Promise.resolve({
          status: 200,
          ok: true,
          headers: { get: () => null },
          json: async () => ({}),
        });
      },
    });
    await backend.open();
    t.mock.timers.tick(60000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(aborted, false);
  } finally {
    t.mock.timers.reset();
  }
});

test('should_list_files_recursively_when_listed', async () => {
  const { backend } = setup([
    {
      match: (url) => url.includes('/contents/?') || url.endsWith('/contents/'),
      reply: () => response(200, [
        { path: 'parsinegar/a.md', type: 'file', sha: 's1' },
        { path: 'parsinegar/sub', type: 'dir', sha: 'd' },
      ]),
    },
    {
      match: (url) => url.includes('/contents/parsinegar%2Fsub') || url.includes('/contents/parsinegar/sub'),
      reply: () => response(200, [{ path: 'parsinegar/sub/b.md', type: 'file', sha: 's2' }]),
    },
  ]);
  const files = await backend.listDir('');
  assert.deepEqual(files, [
    { path: 'parsinegar/a.md', rev: 's1' },
    { path: 'parsinegar/sub/b.md', rev: 's2' },
  ]);
});

test('should_read_empty_for_missing_root_when_listed', async () => {
  const { backend } = setup([{
    match: () => true,
    reply: () => response(404, {}),
  }]);
  assert.deepEqual(await backend.listDir(''), []);
});

test('should_decode_utf8_when_file_is_read', async () => {
  const { backend } = setup([{
    match: (url) => url.includes('/contents/'),
    reply: () => response(200, { sha: 's9', content: `${encode('سلام دنیا')}\n` }),
  }]);
  assert.deepEqual(await backend.readFile('parsinegar/a.md'), { content: 'سلام دنیا', rev: 's9' });
});

test('should_return_null_for_missing_file_when_read', async () => {
  const { backend } = setup([{
    match: () => true,
    reply: () => response(404, {}),
  }]);
  assert.equal(await backend.readFile('parsinegar/nope.md'), null);
});

test('should_create_without_sha_and_update_with_sha_when_written', async () => {
  const { backend, calls } = setup([
    repoOk(),
    branchOk(),
    {
      match: (url, options) => options.method === 'PUT',
      reply: (url, options) => {
        const body = JSON.parse(options.body);
        assert.match(body.content, /^[A-Za-z0-9+/=]+$/);
        return response(body.sha ? 200 : 201, { content: { sha: 'new-sha' } });
      },
    },
  ]);
  await backend.open();
  const created = await backend.writeFile('parsinegar/a.md', 'سلام');
  assert.deepEqual(created, { rev: 'new-sha' });
  const updated = await backend.writeFile('parsinegar/a.md', 'سلام!', 'old-sha');
  assert.deepEqual(updated, { rev: 'new-sha' });
  const bodies = calls.filter((call) => call.method === 'PUT').map((call) => JSON.parse(call.body));
  assert.equal(bodies[0].sha, undefined);
  assert.equal(bodies[1].sha, 'old-sha');
  assert.ok(bodies.every((body) => body.branch === 'main'));
});

test('should_round_trip_content_when_written_and_read', async () => {
  const store = new Map();
  const keyOf = (url) => url.split('?')[0];
  const { backend } = setup([{
    match: (url, options) => url.includes('/contents/'),
    reply: (url, options) => {
      const key = keyOf(url);
      if ((options.method ?? 'GET') === 'PUT') {
        const body = JSON.parse(options.body);
        store.set(key, { sha: `sha-${store.size}`, content: body.content });
        return response(201, { content: { sha: `sha-${store.size - 1}` } });
      }
      const hit = store.get(key);
      return hit ? response(200, hit) : response(404, {});
    },
  }]);
  const text = 'متن فارسی با ایموجی 🎉 و خط‌شکن\nخط دوم';
  await backend.writeFile('a.md', text);
  assert.deepEqual(await backend.readFile('a.md'), { content: text, rev: 'sha-0' });
});

test('should_map_rev_mismatch_when_write_conflicts', async () => {
  const { backend } = setup([{
    match: () => true,
    reply: () => response(409, {}),
  }]);
  await assert.rejects(
    backend.writeFile('a.md', 'x', 'stale-sha'),
    (error) => error.code === 'GIT_REV_MISMATCH',
  );
});

test('should_map_rate_limit_when_throttled', async () => {
  const { backend } = setup([{
    match: () => true,
    reply: () => response(403, {}, { 'x-ratelimit-remaining': '0' }),
  }]);
  await assert.rejects(backend.readFile('a.md'), (error) => error.code === 'GIT_RATE_LIMITED');
});

test('should_map_forbidden_as_auth_when_denied', async () => {
  // GitHub answers 403 "Resource not accessible by personal access token"
  // when the token is valid but cannot touch the repo (unselected repo or
  // missing Contents permission): auth, not network.
  const denied = setup([{
    match: () => true,
    reply: () => response(403, { message: 'Resource not accessible by personal access token' }),
  }]);
  const openError = await denied.backend.open().catch((error) => error);
  assert.equal(openError.code, 'GIT_AUTH_FAILED');
  assert.ok(openError.message.includes('Contents'), 'expected the permission hint');
  assert.ok(!openError.message.includes('secret-token'), 'token stays out of messages');
  await assert.rejects(denied.backend.readFile('a.md'), (error) => error.code === 'GIT_AUTH_FAILED');
  await assert.rejects(
    denied.backend.writeFile('a.md', 'x'),
    (error) => error.code === 'GIT_AUTH_FAILED',
  );
  await assert.rejects(
    denied.backend.deleteFile('a.md', 'sha-1'),
    (error) => error.code === 'GIT_AUTH_FAILED',
  );
});

test('should_delete_with_known_rev_when_deleted', async () => {
  const { backend, calls } = setup([{
    match: (url, options) => options.method === 'DELETE',
    reply: () => response(200, {}),
  }]);
  assert.deepEqual(await backend.deleteFile('a.md', 'sha-1'), { ok: true });
  const body = JSON.parse(calls[0].body);
  assert.equal(body.sha, 'sha-1');
  assert.equal(body.branch, 'main');
});

test('should_resolve_rev_and_tolerate_missing_when_deleted', async () => {
  const { backend, calls } = setup([
    {
      match: (url, options) => (options.method ?? 'GET') === 'GET',
      reply: () => response(200, { sha: 'found-sha', content: encode('x') }),
    },
    {
      match: (url, options) => options.method === 'DELETE',
      reply: () => response(200, {}),
    },
  ]);
  assert.deepEqual(await backend.deleteFile('a.md'), { ok: true });
  assert.equal(JSON.parse(calls[1].body).sha, 'found-sha');
  const missing = setup([{
    match: () => true,
    reply: () => response(404, {}),
  }]);
  assert.deepEqual(await missing.backend.deleteFile('a.md'), { ok: true });
  assert.equal(missing.calls.length, 1);
});
