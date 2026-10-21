// Verifies the gitlab backend over a fake fetch (never the network).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createGitlabAdapter } from '../../adapters/gitlab-adapter.js';

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
    calls.push({
      url,
      method: options.method ?? 'GET',
      body: options.body,
      headers: options.headers ?? {},
    });
    for (const route of routes) {
      if (route.match(url, options)) {
        return route.reply(url, options);
      }
    }
    throw new Error(`unexpected request: ${options.method ?? 'GET'} ${url}`);
  };
  return { fetchFn, calls };
}

function setup(routes, { baseUrl } = {}) {
  const fake = fakeFetch(routes);
  const backend = createGitlabAdapter({
    repo: 'user/notes',
    branch: 'main',
    token: 'secret-token',
    baseUrl,
    fetchFn: fake.fetchFn,
  });
  return { backend, calls: fake.calls };
}

function projectOk() {
  return {
    match: (url) => url.includes('/api/v4/projects/user%2Fnotes') && !url.includes('/repository/'),
    reply: () => response(200, {}),
  };
}

function branchOk() {
  return {
    match: (url) => url.endsWith('/repository/branches/main'),
    reply: () => response(200, {}),
  };
}

function fileRoute(handler) {
  return {
    match: (url, options) => url.includes('/repository/files/'),
    reply: handler,
  };
}

function treeRoute(handler) {
  return {
    match: (url) => url.includes('/repository/tree?'),
    reply: handler,
  };
}

test('should_validate_config_when_created', () => {
  assert.throws(() => createGitlabAdapter({ repo: 'no-slash', token: 't' }), (error) => error.code === 'GITL_INVALID_CONFIG');
  assert.throws(() => createGitlabAdapter({ repo: 'u/r' }), (error) => error.code === 'GITL_INVALID_CONFIG');
  assert.throws(() => createGitlabAdapter({ repo: 'u/r', token: 't', branch: '' }), (error) => error.code === 'GITL_INVALID_CONFIG');
  assert.throws(() => createGitlabAdapter({ repo: 'u/r', token: 't', baseUrl: 'ftp://git.example.com' }), (error) => error.code === 'GITL_INVALID_CONFIG');
  assert.throws(() => createGitlabAdapter({ repo: 'u/r', token: 't', baseUrl: 'not a url' }), (error) => error.code === 'GITL_INVALID_CONFIG');
});

test('should_open_with_token_header_when_opened', async () => {
  const { backend, calls } = setup([projectOk(), branchOk()]);
  const opened = await backend.open();
  assert.deepEqual(opened, { kind: 'gitlab', repo: 'user/notes', branch: 'main', baseUrl: 'https://gitlab.com' });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => !call.url.includes('secret-token')), 'token stays out of URLs');
  assert.ok(calls.every((call) => call.headers['Private-Token'] === 'secret-token'));
});

test('should_normalize_base_url_when_created', async () => {
  const seen = [];
  const backend = createGitlabAdapter({
    repo: 'user/notes',
    token: 't',
    baseUrl: ' https://git.example.com/prefix/ ',
    fetchFn: async (url) => {
      seen.push(url);
      throw new Error('stop at the first request');
    },
  });
  await backend.open().catch(() => {});
  assert.ok(seen[0].startsWith('https://git.example.com/prefix/api/v4/projects/user%2Fnotes'), seen[0]);
  assert.ok(!seen[0].endsWith('//'), 'trailing slashes collapse');
});

test('should_map_auth_and_missing_repo_when_opened', async () => {
  const denied = setup([{
    match: () => true,
    reply: () => response(401, {}),
  }]);
  const authError = await denied.backend.open().catch((error) => error);
  assert.equal(authError.code, 'GITL_AUTH_FAILED');
  assert.ok(!authError.message.includes('secret-token'), 'token stays out of messages');
  const missing = setup([{
    match: () => true,
    reply: () => response(404, {}),
  }]);
  await assert.rejects(missing.backend.open(), (error) => error.code === 'GITL_NOT_FOUND');
  const noBranch = setup([projectOk(), {
    match: (url) => url.includes('/repository/branches/'),
    reply: () => response(404, {}),
  }]);
  await assert.rejects(noBranch.backend.open(), (error) => error.code === 'GITL_NOT_FOUND');
});

test('should_map_forbidden_access_as_auth_when_opened', async () => {
  // 403 on an open project read: valid token, wrong project or missing
  // api scope (write_repository does not authenticate the REST API) —
  // surfaced as auth so the UI points at the token, and the message
  // names the scope fix.
  const denied = setup([{
    match: () => true,
    reply: () => response(403, { error: 'insufficient_scope' }),
  }]);
  const error = await denied.backend.open().catch((caught) => caught);
  assert.equal(error.code, 'GITL_AUTH_FAILED');
  assert.ok(error.message.includes('api scope'), 'expected the scope hint');
});

test('should_map_network_failure_when_opened', async () => {
  const backend = createGitlabAdapter({
    repo: 'user/notes',
    token: 't',
    fetchFn: async () => { throw new TypeError('fetch failed'); },
  });
  await assert.rejects(backend.open(), (error) => error.code === 'GITL_NETWORK_FAILED');
});

test('should_time_out_when_server_hangs_when_read', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const backend = createGitlabAdapter({
      repo: 'user/notes',
      token: 't',
      fetchFn: (url, { signal } = {}) => new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    });
    const pending = backend.readFile('a.md');
    // Let the async machinery reach the timer before fast-forwarding it;
    // setImmediate itself is never mocked.
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(30000);
    await assert.rejects(pending, (error) => error.code === 'GITL_NETWORK_FAILED');
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
    const backend = createGitlabAdapter({
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

test('should_follow_keyset_pages_when_listed', async () => {
  let page = 0;
  const { backend, calls } = setup([
    projectOk(),
    branchOk(),
    treeRoute((url) => {
      if (page === 0) {
        page += 1;
        return response(200, [
          { type: 'blob', path: 'parsinegar/a.md', id: 's1' },
          { type: 'tree', path: 'parsinegar/sub', id: 'd' },
        ], { link: '<https://gitlab.com/api/v4/projects/user%2Fnotes/repository/tree?recursive=true&ref=main&pagination=keyset&per_page=100&page_token=tok1>; rel="next"' });
      }
      return response(200, [{ type: 'blob', path: 'parsinegar/sub/b.md', id: 's2' }]);
    }),
  ]);
  await backend.open();
  const files = await backend.listDir('');
  assert.deepEqual(files, [
    { path: 'parsinegar/a.md', rev: 's1' },
    { path: 'parsinegar/sub/b.md', rev: 's2' },
  ]);
  assert.equal(calls.filter((call) => call.url.includes('/repository/tree')).length, 2);
  assert.ok(calls[2].url.includes('pagination=keyset'));
  const followUp = calls[3];
  assert.equal(followUp.headers['Private-Token'], 'secret-token', 'auth headers ride every page');
});

test('should_scope_subdirectory_when_listed', async () => {
  const { backend, calls } = setup([
    projectOk(),
    branchOk(),
    treeRoute((url) => {
      assert.match(url, /path=parsinegar/);
      return response(200, [{ type: 'blob', path: 'parsinegar/a.md', id: 's1' }]);
    }),
  ]);
  await backend.open();
  const files = await backend.listDir('parsinegar');
  assert.deepEqual(files, [{ path: 'parsinegar/a.md', rev: 's1' }]);
  const treeCall = calls.find((call) => call.url.includes('/repository/tree'));
  assert.ok(treeCall.url.includes('path=parsinegar'));
});

test('should_read_empty_for_missing_tree_when_listed', async () => {
  const { backend } = setup([treeRoute(() => response(404, {}))]);
  assert.deepEqual(await backend.listDir(''), []);
});

test('should_decode_and_rev_by_blob_when_file_is_read', async () => {
  const { backend } = setup([fileRoute(() => response(200, { content: encode('سلام دنیا'), blob_id: 'blob-9' }))]);
  assert.deepEqual(await backend.readFile('parsinegar/a.md'), { content: 'سلام دنیا', rev: 'blob-9' });
});

test('should_encode_nested_paths_as_one_segment_when_used', async () => {
  // GitLab's route reads file_path as ONE URL segment: nested paths must
  // carry percent-encoded slashes (`folder%2Ffile.md`) — literal slashes
  // 404 on everything below the root (decisions §48, anchor 7).
  const { backend, calls } = setup([fileRoute(() => response(200, { content: encode('سلام'), blob_id: 'b1' }))]);
  await backend.readFile('پوشه/یادداشت.md');
  const pathPart = calls[0].url.split('/files/')[1].split('?')[0];
  assert.ok(pathPart.includes('%2F'), 'nested path encoded as one segment');
  assert.ok(!pathPart.includes('/'), `no literal slash may reach the route: ${pathPart}`);
  await backend.writeFile('پوشه/یادداشت.md', 'سلام');
  await backend.deleteFile('پوشه/یادداشت.md', 'b1');
  const broken = calls.filter((call) => {
    const part = String(call.url).split('/files/')[1]?.split('?')[0] ?? null;
    return part !== null && decodeURIComponent(part).includes('/') && !part.includes('%2F');
  });
  assert.deepEqual(broken, [], 'every file request must keep slashes percent-encoded');
});

test('should_round_trip_nested_path_when_written_and_read', async () => {
  const store = new Map();
  const keyOf = (url) => decodeURIComponent(url.split('/files/')[1].split('?')[0]);
  const { backend } = setup([fileRoute((url, options) => {
    const key = keyOf(url);
    if ((options.method ?? 'GET') === 'GET') {
      const hit = store.get(key);
      return hit ? response(200, hit) : response(404, {});
    }
    const body = JSON.parse(options.body);
    store.set(key, { content: body.content, blob_id: `b-${store.size}`, last_commit_id: null });
    return response(201, {});
  })]);
  const text = 'سند داخل پوشه';
  await backend.writeFile('مکاتبات/پیش‌نویس/سند.md', text);
  assert.deepEqual(await backend.readFile('مکاتبات/پیش‌نویس/سند.md'), { content: text, rev: 'b-0' });
});

test('should_return_null_for_missing_file_when_read', async () => {
  const { backend } = setup([fileRoute(() => response(404, {}))]);
  assert.equal(await backend.readFile('parsinegar/nope.md'), null);
});

test('should_post_create_without_lock_and_follow_up_rev_when_written', async () => {
  const { backend, calls } = setup([
    fileRoute((url, options) => {
      if (options.method === 'POST') {
        return response(201, {});
      }
      return response(200, { content: encode('سلام'), blob_id: 'new-blob', last_commit_id: 'lc2' });
    }),
  ]);
  const created = await backend.writeFile('parsinegar/a.md', 'سلام');
  assert.deepEqual(created, { rev: 'new-blob' });
  const post = calls.find((call) => call.method === 'POST');
  const postBody = JSON.parse(post.body);
  assert.equal(postBody.branch, 'main');
  assert.equal(postBody.encoding, 'base64');
  assert.equal(postBody.commit_message, 'pey.sync write parsinegar/a.md');
  assert.equal(postBody.last_commit_id, undefined, 'first write carries no lock');
  assert.equal(calls.filter((call) => call.method === 'GET').length, 1, 'one read for the follow-up rev');
});

test('should_verify_rev_then_put_with_lock_when_updated', async () => {
  const { backend, calls } = setup([
    fileRoute((url, options) => {
      if (options.method === 'PUT') {
        const body = JSON.parse(options.body);
        assert.equal(body.last_commit_id, 'lc1');
        return response(200, {});
      }
      return response(200, { content: encode('old'), blob_id: 'stale', last_commit_id: 'lc1' });
    }),
  ]);
  await backend.writeFile('parsinegar/a.md', 'new', 'stale');
  assert.equal(calls.filter((call) => call.method === 'PUT').length, 1);
  assert.equal(calls.filter((call) => call.url.includes('/repository/files/') && (call.method ?? 'GET') === 'GET').length, 2, 'verify + follow-up rev');
});

test('should_refuse_write_when_blob_moved_since_sync', async () => {
  const { backend, calls } = setup([fileRoute((url, options) => {
    if ((options.method ?? 'GET') === 'GET') {
      return response(200, { content: encode('mine=new'), blob_id: 'moved', last_commit_id: 'lcX' });
    }
    return response(200, {});
  })]);
  await assert.rejects(
    backend.writeFile('parsinegar/a.md', 'text', 'old-blob'),
    (error) => error.code === 'GITL_REV_MISMATCH',
  );
  assert.equal(calls.filter((call) => call.method === 'PUT').length, 0, 'no write fires on a moved blob');
});

test('should_treat_gone_as_conflict_on_locked_write', async () => {
  const { backend } = setup([fileRoute(() => response(404, {}))]);
  await assert.rejects(
    backend.writeFile('parsinegar/a.md', 'text', 'old-blob'),
    (error) => error.code === 'GITL_REV_MISMATCH',
  );
});

test('should_map_generic_400_as_conflict_when_write_fails', async () => {
  // GitLab reports all commit failures as 400; with the double
  // verification above this reads as a concurrent change.
  const { backend } = setup([
    fileRoute((url, options) => {
      if ((options.method ?? 'GET') === 'GET') {
        return response(200, { content: encode('old'), blob_id: 'current', last_commit_id: 'lc1' });
      }
      return response(400, { message: 'Something went wrong on our end' });
    }),
  ]);
  await assert.rejects(
    backend.writeFile('parsinegar/a.md', 'new', 'current'),
    (error) => error.code === 'GITL_REV_MISMATCH',
  );
});

test('should_round_trip_content_when_written_and_read', async () => {
  const store = new Map();
  const { backend } = setup([fileRoute((url, options) => {
    const key = decodeURIComponent(url.split('/files/')[1].split('?')[0]);
    if ((options.method ?? 'GET') === 'GET') {
      const hit = store.get(key);
      return hit ? response(200, hit) : response(404, {});
    }
    const body = JSON.parse(options.body);
    store.set(key, { content: body.content, blob_id: `b-${store.size}`, last_commit_id: null });
    return response(201, {});
  })]);
  const text = 'متن فارسی با ایموجی 🎉 و خط‌شکن\nخط دوم';
  await backend.writeFile('parsinegar/a.md', text);
  assert.deepEqual(await backend.readFile('parsinegar/a.md'), { content: text, rev: 'b-0' });
});

test('should_use_custom_message_when_run_supplies_one', async () => {
  const { backend, calls } = setup([
    fileRoute((url, options) => {
      if ((options.method ?? 'GET') === 'GET') {
        return response(200, { content: encode('x'), blob_id: 'b1', last_commit_id: 'lc1' });
      }
      return response(201, {});
    }),
  ]);
  await backend.writeFile('a.md', 'سلام', null, { message: 'پیام سفارشی' });
  await backend.writeFile('a.md', 'سلام!', 'b1', { message: 'پیام سفارشی' });
  await backend.deleteFile('a.md', 'b1', { message: 'پیام سفارشی' });
  const bodies = calls.filter((call) => call.method !== 'GET').map((call) => JSON.parse(call.body));
  assert.ok(bodies.every((body) => body.commit_message === 'پیام سفارشی'));
});

test('should_fall_back_to_automatic_message_when_blank_or_absent', async () => {
  const { backend, calls } = setup([
    fileRoute((url, options) => {
      const path = decodeURIComponent(url.split('/files/')[1].split('?')[0]);
      if ((options.method ?? 'GET') === 'GET') {
        return path === 'c.md'
          ? response(200, { content: encode('x'), blob_id: 'b3', last_commit_id: 'lc3' })
          : response(404, {});
      }
      return response(201, {});
    }),
  ]);
  await backend.writeFile('a.md', 'سلام', null, { message: '   ' });
  await backend.writeFile('b.md', 'سلام', null, null);
  await backend.deleteFile('c.md');
  const bodies = calls.filter((call) => call.method !== 'GET').map((call) => JSON.parse(call.body));
  assert.equal(bodies[0].commit_message, 'pey.sync write a.md');
  assert.equal(bodies[1].commit_message, 'pey.sync write b.md');
  assert.equal(bodies[2].commit_message, 'pey.sync delete c.md');
});

test('should_delete_with_lock_when_rev_known', async () => {
  const { backend, calls } = setup([
    fileRoute((url, options) => {
      if ((options.method ?? 'GET') === 'GET') {
        return response(200, { content: encode('x'), blob_id: 'b1', last_commit_id: 'lc1' });
      }
      return response(204, {});
    }),
  ]);
  assert.deepEqual(await backend.deleteFile('a.md', 'b1'), { ok: true });
  const body = JSON.parse(calls.filter((call) => call.method === 'DELETE')[0].body);
  assert.equal(body.branch, 'main');
  assert.equal(body.last_commit_id, 'lc1');
});

test('should_refuse_delete_when_blob_moved_since_sync', async () => {
  const { backend, calls } = setup([
    fileRoute((url, options) => {
      if ((options.method ?? 'GET') === 'GET') {
        return response(200, { content: encode('x'), blob_id: 'moved', last_commit_id: 'lcX' });
      }
      return response(204, {});
    }),
  ]);
  await assert.rejects(
    backend.deleteFile('a.md', 'old-blob'),
    (error) => error.code === 'GITL_REV_MISMATCH',
  );
  assert.equal(calls.filter((call) => call.method === 'DELETE').length, 0, 'no delete fires on a moved blob');
});

test('should_delete_missing_file_silently_when_already_gone', async () => {
  const { backend, calls } = setup([fileRoute(() => response(404, {}))]);
  assert.deepEqual(await backend.deleteFile('a.md', 'stale'), { ok: true });
  assert.deepEqual(await backend.deleteFile('a.md'), { ok: true });
  assert.equal(calls.filter((call) => call.method === 'DELETE').length, 0, 'nothing to delete twice');
});

test('should_map_rate_limit_when_throttled', async () => {
  const { backend } = setup([fileRoute(() => response(429, {}))]);
  await assert.rejects(backend.readFile('a.md'), (error) => error.code === 'GITL_RATE_LIMITED');
});

test('should_map_forbidden_as_auth_when_denied', async () => {
  // GitLab answers 403 when the token cannot touch the project: surfaced
  // as auth, not network, so the UI points at the token.
  const denied = setup([fileRoute(() => response(403, {}))]);
  await assert.rejects(denied.backend.readFile('a.md'), (error) => error.code === 'GITL_AUTH_FAILED');
  await assert.rejects(
    denied.backend.writeFile('a.md', 'x'),
    (error) => error.code === 'GITL_AUTH_FAILED',
  );
  await assert.rejects(
    denied.backend.deleteFile('a.md'),
    (error) => error.code === 'GITL_AUTH_FAILED',
  );
});
