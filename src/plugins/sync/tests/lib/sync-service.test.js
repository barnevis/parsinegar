// Verifies the sync service: fake storage, fake GitHub over injected
// fetch, recording event bus. Never the network.
import assert from 'node:assert/strict';
import test from 'node:test';
import { hashRecord } from '../../lib/sync-engine.js';
import { createService } from '../../lib/sync-service.js';
import { memoryStorage } from './fake-storage.js';

function encode(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

function decode(payload) {
  return Buffer.from(String(payload ?? '').replace(/\s/g, ''), 'base64').toString('utf8');
}

function fakeGitHub({ files = {}, failOpen = null } = {}) {
  const store = new Map(Object.entries(files));
  let revCounter = 0;
  const calls = [];
  const ok = (payload) => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => payload });
  const fail = (status) => ({ status, ok: false, headers: { get: () => null }, json: async () => ({}) });
  const listDirectory = (prefix) => {
    const seen = new Map();
    for (const [key, file] of store) {
      if (prefix !== '' && key !== prefix && !key.startsWith(`${prefix}/`)) {
        continue;
      }
      const rest = prefix === '' ? key : key.slice(prefix.length + 1);
      if (rest === '') {
        continue;
      }
      const slash = rest.indexOf('/');
      if (slash < 0) {
        seen.set(key, { path: key, type: 'file', sha: file.rev });
      } else {
        const dir = prefix === '' ? rest.slice(0, slash) : `${prefix}/${rest.slice(0, slash)}`;
        seen.set(dir, { path: dir, type: 'dir', sha: null });
      }
    }
    return [...seen.values()];
  };
  const fetchFn = async (url, options = {}) => {
    const method = options.method ?? 'GET';
    calls.push({ method, url, body: options.body });
    if (url.includes('/repos/u/r') && !url.includes('/contents') && !url.includes('/branches')) {
      if (failOpen) {
        throw failOpen;
      }
      return ok({});
    }
    if (url.includes('/branches/')) {
      return ok({});
    }
    const match = url.match(/\/contents\/?(.*?)(\?.*)?$/);
    const path = decodeURIComponent(match?.[1] ?? '');
    if (method === 'PUT') {
      const body = JSON.parse(options.body);
      const hit = store.get(path);
      if (body.sha !== undefined && hit && hit.rev !== body.sha) {
        return fail(409);
      }
      if (body.sha === undefined && hit) {
        return fail(422);
      }
      const rev = `rev-${++revCounter}`;
      store.set(path, { content: body.content, rev });
      return { status: 201, ok: true, headers: { get: () => null }, json: async () => ({ content: { sha: rev } }) };
    }
    if (method === 'DELETE') {
      store.delete(path);
      return ok({});
    }
    if (store.has(path)) {
      const hit = store.get(path);
      return ok({ sha: hit.rev, content: hit.content });
    }
    const children = listDirectory(path);
    if (children.length > 0) {
      return ok(children);
    }
    return fail(404);
  };
  return {
    fetchFn,
    calls,
    reads: () => calls.filter((call) => call.method === 'GET' && call.url.includes('/contents/')),
    writes: () => calls.filter((call) => call.method === 'PUT' || call.method === 'DELETE'),
    files: store,
  };
}

function events() {
  const seen = [];
  return {
    seen,
    publish(type, data) {
      seen.push({ type, data: JSON.parse(JSON.stringify(data)) });
    },
  };
}

const SCOPE = {
  collections: [
    {
      collection: 'docs',
      serializer: 'markdown',
      titleField: 'title',
      folders: { collection: 'folders', nameField: 'name' },
    },
  ],
};

const JSON_SCOPE = {
  collections: [{ collection: 'notes', serializer: 'json', idField: 'key', updatedAtField: 'mtime', contentField: 'text' }],
};

function setup({ storageData = {}, files = {}, eventsBus = events(), options = {} } = {}) {
  const storage = memoryStorage(storageData);
  const remote = fakeGitHub({ files, ...options });
  const service = createService({ storage, events: eventsBus, fetchFn: remote.fetchFn });
  return { service, storage, remote, events: eventsBus };
}

async function configure(service) {
  return service.configureBackend({
    kind: 'git',
    params: { repo: 'u/r', branch: 'main', token: 'tok' },
  });
}

test('should_store_redacted_backend_when_configured', async () => {
  const { service, storage } = setup();
  const result = await configure(service);
  assert.deepEqual(result, { ok: true, kind: 'git', repo: 'u/r', branch: 'main' });
  const stored = await storage.read('sync_backends', 'active');
  assert.equal(stored.token, 'tok');
  assert.equal(JSON.stringify(result).includes('tok'), false);
});

test('should_reject_unknown_backend_when_configured', async () => {
  const { service } = setup();
  const error = await service.configureBackend({ kind: 'ftp', params: {} }).catch((caught) => caught);
  assert.equal(error?.code, 'SYNC_INVALID_CONFIG');
});

test('should_map_auth_failure_when_configured', async () => {
  const storage = memoryStorage();
  const service = createService({
    storage,
    events: events(),
    fetchFn: async () => ({ status: 401, ok: false, headers: { get: () => null }, json: async () => ({}) }),
  });
  const error = await configure(service).catch((caught) => caught);
  assert.equal(error?.code, 'SYNC_AUTH_FAILED');
  assert.equal(await storage.read('sync_backends', 'active'), null);
});

test('should_report_unavailable_storage_when_configured', async () => {
  const service = createService({ storage: null, events: events(), fetchFn: async () => ({}) });
  const error = await configure(service).catch((caught) => caught);
  assert.equal(error?.code, 'SYNC_STORAGE_UNAVAILABLE');
});

test('should_clear_backend_when_removed', async () => {
  const { service, storage } = setup();
  await configure(service);
  assert.deepEqual(await service.removeBackend(), { ok: true });
  assert.equal(await storage.read('sync_backends', 'active'), null);
  assert.deepEqual(await service.removeBackend(), { ok: true });
});

test('should_report_unconfigured_status_when_fresh', async () => {
  const { service } = setup();
  assert.deepEqual(await service.getStatus(), { configured: false, lastSyncAt: null, lastError: null });
});

test('should_report_redacted_status_when_configured', async () => {
  const { service } = setup();
  await configure(service);
  const status = await service.getStatus();
  assert.equal(status.configured, true);
  assert.equal(status.kind, 'git');
  assert.equal(status.repo, 'u/r');
  assert.equal(JSON.stringify(status).includes('tok'), false);
});

test('should_report_no_pending_changes_when_unconfigured', async () => {
  const { service } = setup({
    storageData: {
      docs: [{ id: 'd1', title: 'یادداشت', content: 'سلام', folderId: null, updatedAt: 20 }],
    },
  });
  assert.deepEqual(await service.hasPendingChanges({ scope: SCOPE }), { pending: false });
});

test('should_report_pending_local_news_without_network_when_checked', async () => {
  const { service, remote } = setup({
    storageData: {
      docs: [{ id: 'd1', title: 'یادداشت', content: 'سلام', folderId: null, updatedAt: 20 }],
    },
  });
  await configure(service);
  const before = remote.calls.length;
  assert.deepEqual(await service.hasPendingChanges({ scope: SCOPE }), { pending: true });
  assert.equal(remote.calls.length, before, 'expected no network for the check');
});

test('should_report_clean_after_completed_sync_when_checked', async () => {
  const { service, remote } = setup({
    storageData: {
      docs: [{ id: 'd1', title: 'یادداشت', content: 'سلام', folderId: null, updatedAt: 20 }],
    },
  });
  await configure(service);
  const report = await service.syncNow({ scope: SCOPE });
  assert.equal(report.completed, true);
  const before = remote.calls.length;
  assert.deepEqual(await service.hasPendingChanges({ scope: SCOPE }), { pending: false });
  assert.equal(remote.calls.length, before, 'expected no network for the check');
});

test('should_push_everything_on_first_sync_when_synced', async () => {
  const { service, remote, events: bus } = setup({
    storageData: {
      folders: [{ id: 'f1', name: 'کار', parentId: null, updatedAt: 10 }],
      docs: [{ id: 'd1', title: 'یادداشت', content: 'سلام', folderId: 'f1', updatedAt: 20 }],
    },
  });
  await configure(service);
  const report = await service.syncNow({ scope: SCOPE });
  assert.equal(report.completed, true);
  assert.deepEqual(report.pushed.map((item) => item.id), ['d1']);
  assert.deepEqual(report.conflicts, []);
  assert.ok(remote.files.has('کار/یادداشت.md'));
  assert.equal(decode(remote.files.get('کار/یادداشت.md').content), 'سلام');
  const status = await service.getStatus();
  assert.equal(typeof status.lastSyncAt, 'number');
  assert.equal(status.lastError, null);
  assert.ok(bus.seen.some((event) => event.type === 'sync:changed' && event.data.pushed.length === 1));
  assert.ok(!bus.seen.some((event) => event.type === 'sync:conflicts'));
});

test('should_stamp_custom_message_on_this_runs_writes_when_supplied', async () => {
  const { service, remote } = setup({
    storageData: {
      folders: [{ id: 'f1', name: 'کار', parentId: null, updatedAt: 10 }],
      docs: [{ id: 'd1', title: 'یادداشت', content: 'سلام', folderId: 'f1', updatedAt: 20 }],
    },
  });
  await configure(service);
  const report = await service.syncNow({ scope: SCOPE, message: 'پیام من' });
  assert.equal(report.completed, true);
  assert.ok(remote.files.has('کار/یادداشت.md'));
  const putBodies = remote.calls
    .filter((call) => call.method === 'PUT')
    .map((call) => JSON.parse(call.body));
  assert.ok(putBodies.length > 0);
  assert.ok(putBodies.every((body) => body.message === 'پیام من'));
});

test('should_keep_automatic_messages_when_no_custom_message_is_supplied', async () => {
  const { service, remote } = setup({
    storageData: {
      docs: [{ id: 'd1', title: 'یادداشت', content: 'سلام', folderId: null, updatedAt: 20 }],
    },
  });
  await configure(service);
  const report = await service.syncNow({ scope: SCOPE, message: '   ' });
  assert.equal(report.completed, true);
  const putBodies = remote.calls
    .filter((call) => call.method === 'PUT')
    .map((call) => JSON.parse(call.body));
  assert.deepEqual(putBodies.map((body) => body.message), ['pey.sync write یادداشت.md']);
});

test('should_cap_long_custom_messages_instead_of_failing', async () => {
  const { service, remote } = setup({
    storageData: {
      docs: [{ id: 'd1', title: 'یادداشت', content: 'سلام', folderId: null, updatedAt: 20 }],
    },
  });
  await configure(service);
  const report = await service.syncNow({ scope: SCOPE, message: 'ت'.repeat(300) });
  assert.equal(report.completed, true);
  const putBodies = remote.calls
    .filter((call) => call.method === 'PUT')
    .map((call) => JSON.parse(call.body));
  assert.equal(putBodies[0].message.length, 200);
});

test('should_rest_without_reads_or_writes_on_repeat_sync_when_synced', async () => {
  const { service, remote } = setup({
    storageData: {
      docs: [{ id: 'd1', title: 'یادداشت', content: 'سلام', folderId: null, updatedAt: 20 }],
    },
  });
  await configure(service);
  const first = await service.syncNow({ scope: SCOPE });
  assert.equal(first.completed, true);
  const second = await service.syncNow({ scope: SCOPE });
  assert.equal(second.completed, true);
  assert.deepEqual(second.pushed, []);
  assert.deepEqual(second.pulled, []);
  assert.equal(remote.writes().length, 1, 'expected only the first round to write');
  assert.equal(remote.reads().length, 2, 'expected root lists only, no per-file hash reads');
});

test('should_pull_remote_tree_when_synced', async () => {
  const { service, storage } = setup({
    files: {
      'کار/یادداشت.md': { content: Buffer.from('سلام از راه دور').toString('base64'), rev: 'd1' },
    },
  });
  await configure(service);
  const report = await service.syncNow({ scope: SCOPE });
  assert.equal(report.completed, true);
  assert.equal(report.pulled.length, 1);
  const docs = await storage.query('docs');
  assert.equal(docs.length, 1);
  assert.equal(docs[0].content, 'سلام از راه دور');
  assert.equal(docs[0].title, 'یادداشت');
  const folders = await storage.query('folders');
  assert.equal(folders.length, 1);
  assert.equal(folders[0].name, 'کار');
  assert.equal(docs[0].folderId, folders[0].id);
});

test('should_mint_local_ids_for_new_remote_documents_when_pulled', async () => {
  const { service, storage } = setup({
    files: {
      'README.md': { content: Buffer.from('توضیح پروژه').toString('base64'), rev: 'r1' },
    },
  });
  await configure(service);
  const report = await service.syncNow({ scope: SCOPE });
  assert.equal(report.completed, true);
  assert.equal(report.pulled.length, 1);
  const docs = await storage.query('docs');
  assert.equal(docs.length, 1);
  assert.equal(docs[0].title, 'README');
  assert.equal(typeof docs[0].id, 'string');
  assert.ok(docs[0].id.length > 0, 'expected a minted storage key for the pulled document');
  assert.deepEqual(await service.hasPendingChanges({ scope: SCOPE }), { pending: false });
  const second = await service.syncNow({ scope: SCOPE });
  assert.equal(second.completed, true);
  assert.deepEqual(second.pulled, []);
  assert.deepEqual(second.pushed, []);
});

test('should_pull_minting_folder_chain_when_synced', async () => {
  const { service, storage } = setup({
    storageData: {
      folders: [{ id: 'f2', name: 'پروژه', parentId: null, updatedAt: 1 }],
      docs: [{ id: 'd9', title: 'همسایه', content: 'x', folderId: 'f2', updatedAt: 2 }],
    },
    files: {
      'پروژه/ویسنامه.md': { content: Buffer.from('تازه').toString('base64'), rev: 'a1' },
    },
  });
  await configure(service);
  const report = await service.syncNow({ scope: SCOPE });
  assert.equal(report.completed, true);
  const docs = await storage.query('docs');
  const pulled = docs.find((record) => record.title === 'ویسنامه');
  const known = await storage.query('folders');
  const parent = known.find((record) => record.name === 'پروژه');
  assert.equal(pulled.folderId, parent?.id ?? null);
});

function scopeWithIgnore(patterns) {
  return {
    collections: [
      {
        collection: 'docs',
        serializer: 'markdown',
        titleField: 'title',
        folders: { collection: 'folders', nameField: 'name' },
        ignore: patterns,
      },
    ],
  };
}

test('should_skip_ignored_documents_and_folders_when_synced', async () => {
  const { service, remote } = setup({
    storageData: {
      folders: [{ id: 'f1', name: 'کار', parentId: null, updatedAt: 10 }],
      docs: [
        { id: 'd1', title: 'یادداشت', content: 'سلام', folderId: 'f1', updatedAt: 20 },
        { id: 'd2', title: 'پیش‌نویس', content: 'موقت', folderId: null, updatedAt: 20 },
      ],
    },
  });
  await configure(service);
  const scope = scopeWithIgnore(['پیش‌نویس', 'کار/']);
  const report = await service.syncNow({ scope });
  assert.equal(report.completed, true);
  assert.deepEqual(report.pushed, []);
  assert.deepEqual(report.pulled, []);
  assert.equal(remote.writes().length, 0, 'expected nothing pushed');
  assert.deepEqual(await service.hasPendingChanges({ scope }), { pending: false });
});

test('should_leave_ignored_remote_files_alone_when_synced', async () => {
  const { service, remote, events: bus } = setup({
    files: {
      'پیش‌نویس.md': { content: Buffer.from('متن').toString('base64'), rev: 'd1' },
    },
  });
  await configure(service);
  const report = await service.syncNow({ scope: scopeWithIgnore(['پیش‌نویس']) });
  assert.equal(report.completed, true);
  assert.deepEqual(report.pulled, []);
  assert.deepEqual(report.deletedRemote, []);
  assert.ok(remote.files.has('پیش‌نویس.md'), 'expected the ignored file untouched');
  assert.ok(bus.seen.some((event) => event.type === 'sync:changed' && event.data.conflicts.length === 0));
});

test('should_not_delete_previously_synced_when_ignored', async () => {
  const { service, remote, storage } = setup({
    storageData: {
      docs: [{ id: 'd1', title: 'یادداشت', content: 'سلام', folderId: null, updatedAt: 20 }],
    },
  });
  await configure(service);
  const first = await service.syncNow({ scope: SCOPE });
  assert.equal(first.completed, true);
  assert.ok(remote.files.has('یادداشت.md'));
  assert.ok(await storage.read('docs', 'd1'), 'expected the local doc alive');
  const second = await service.syncNow({ scope: scopeWithIgnore(['یادداشت']) });
  assert.equal(second.completed, true);
  assert.deepEqual(second.deletedRemote, []);
  assert.deepEqual(second.deleteLocal, []);
  assert.deepEqual(second.pushed, []);
  assert.ok(remote.files.has('یادداشت.md'), 'expected the ignored file kept');
  assert.ok(await storage.read('docs', 'd1'), 'expected the ignored doc kept');
  assert.deepEqual(await service.hasPendingChanges({ scope: scopeWithIgnore(['یادداشت']) }), { pending: false });
});

test('should_reject_bad_ignore_when_synced', async () => {
  const { service } = setup();
  await configure(service);
  const error = await service.syncNow({
    scope: { collections: [{ collection: 'docs', serializer: 'markdown', ignore: 'nope' }] },
  }).catch((caught) => caught);
  assert.equal(error?.code, 'SYNC_INVALID_CONFIG');
});

test('should_relocate_dangling_folder_links_when_synced', async () => {
  const { service, storage } = setup({
    storageData: {
      docs: [{ id: 'd1', title: 'یادداشت', content: 'متن', folderId: 'vanished', updatedAt: 20 }],
    },
  });
  await configure(service);
  const report = await service.syncNow({ scope: SCOPE });
  assert.equal(report.completed, true);
  assert.deepEqual(report.relocated.map((item) => [item.collection, item.id, item.path]), [
    ['docs', 'd1', 'یادداشت.md'],
  ]);
  const doc = await storage.read('docs', 'd1');
  assert.equal(doc.folderId, 'vanished', 'expected the link preserved, only the path moved');
});

test('should_propagate_deletes_both_ways_when_synced', async () => {
  const { service, storage, remote } = setup({
    storageData: {
      docs: [
        { id: 'keep', title: 'ماندنی', content: 'x', folderId: null, updatedAt: 20 },
        { id: 'gone-local', title: 'رفتنی', content: 'x', folderId: null, updatedAt: 20 },
      ],
    },
  });
  await configure(service);
  const first = await service.syncNow({ scope: SCOPE });
  assert.equal(first.completed, true);
  assert.ok(remote.files.has('رفتنی.md'));
  await storage.delete('docs', 'gone-local');
  const second = await service.syncNow({ scope: SCOPE });
  assert.ok(second.deletedRemote.some((item) => item.id === 'gone-local'));
  assert.ok(!remote.files.has('رفتنی.md'));
  remote.files.delete('ماندنی.md');
  const third = await service.syncNow({ scope: SCOPE });
  assert.ok(third.deleteLocal.some((item) => item.id === 'keep'));
  assert.equal(await storage.read('docs', 'keep'), null);
});

test('should_fail_on_local_path_collision_when_synced', async () => {
  const { service, remote, events: bus } = setup({
    storageData: {
      docs: [
        { id: 'd1', title: 'همسنگ', content: 'نخست', folderId: null, updatedAt: 1 },
        { id: 'd2', title: 'همسنگ', content: 'دوم', folderId: null, updatedAt: 1 },
      ],
    },
  });
  await configure(service);
  const error = await service.syncNow({ scope: SCOPE }).catch((caught) => caught);
  assert.equal(error?.code, 'SYNC_PATH_COLLISION');
  assert.deepEqual(remote.writes(), [], 'expected no remote touch while locals collide');
  const status = await service.getStatus();
  assert.equal(status.lastError?.code, 'SYNC_PATH_COLLISION');
  assert.ok(bus.seen.some((event) => event.type === 'sync:changed'));
});

test('should_tolerate_corrupt_legacy_manifest_when_synced', async () => {
  const { service, remote, storage } = setup({
    storageData: { docs: [{ id: 'd1', title: 'x', content: 'y', folderId: null, updatedAt: 1 }] },
    files: { 'sync-manifest.json': { content: Buffer.from('nope').toString('base64'), rev: 'm' } },
  });
  await configure(service);
  const report = await service.syncNow({ scope: SCOPE });
  assert.equal(report.completed, true);
  assert.ok(remote.files.has('sync-manifest.json'), 'expected an unreadable manifest left in place');
  assert.ok(await storage.read('docs', 'd1'));
});

test('should_migrate_legacy_state_and_clean_artifacts_when_synced', async () => {
  const legacyManifest = {
    version: 1,
    records: [
      { collection: 'docs', id: 'd1', path: 'یادداشت.md', updatedAt: 10, hash: hashRecord('محتوای قدیم'), title: 'یادداشت' },
      { collection: 'folders', id: 'f1', path: 'folders/f1.json', updatedAt: 1, hash: 'x', title: null },
    ],
  };
  const { service, remote } = setup({
    storageData: {
      'sync_state': [{ id: 'active', snapshot: [{ collection: 'docs', id: 'd1', path: 'یادداشت.md', updatedAt: 10 }] }],
      docs: [{ id: 'd1', title: 'یادداشت', content: 'محتوای تازه', folderId: null, updatedAt: 50 }],
    },
    files: {
      'sync-manifest.json': { content: Buffer.from(JSON.stringify(legacyManifest)).toString('base64'), rev: 'm1' },
      'یادداشت.md': { content: Buffer.from('محتوای قدیم').toString('base64'), rev: 'f1' },
      'folders/f1.json': { content: Buffer.from('{"id":"f1","name":"x"}').toString('base64'), rev: 'f2' },
    },
  });
  await configure(service);
  const report = await service.syncNow({ scope: SCOPE });
  assert.equal(report.completed, true);
  assert.deepEqual(report.conflicts, []);
  assert.deepEqual(report.pushed.map((item) => item.id), ['d1'], 'expected a seeded hash to read the local edit as a push');
  assert.equal(decode(remote.files.get('یادداشت.md').content), 'محتوای تازه');
  assert.ok(!remote.files.has('sync-manifest.json'), 'expected the legacy manifest swept');
  assert.ok(!remote.files.has('folders/f1.json'), 'expected the stale folder file swept');
  assert.deepEqual(await service.hasPendingChanges({ scope: SCOPE }), { pending: false });
});

test('should_sync_custom_id_fields_when_synced', async () => {
  const { service, remote } = setup({
    storageData: { notes: [{ key: 'n1', text: 'hi', mtime: 5 }] },
  });
  await configure(service);
  const report = await service.syncNow({ scope: JSON_SCOPE });
  assert.equal(report.completed, true);
  assert.deepEqual(report.pushed.map((item) => item.id), ['n1']);
  assert.ok(remote.files.has('notes/n1.json'));
  assert.deepEqual(await service.hasPendingChanges({ scope: JSON_SCOPE }), { pending: false });
});

test('should_pull_json_records_when_synced', async () => {
  const { service, storage } = setup({
    files: {
      'notes/n1.json': {
        content: Buffer.from(JSON.stringify({ key: 'n1', text: 'سلام', mtime: 1 })).toString('base64'),
        rev: 'n1',
      },
    },
  });
  await configure(service);
  const report = await service.syncNow({ scope: JSON_SCOPE });
  assert.equal(report.completed, true);
  const record = await storage.read('notes', 'n1');
  assert.equal(record.text, 'سلام');
  assert.equal(typeof record.mtime, 'number');
});

test('should_skip_json_identity_mismatch_when_synced', async () => {
  const { service, storage } = setup({
    files: {
      'notes/wrongname.json': {
        content: Buffer.from(JSON.stringify({ key: ' kidnapper', text: 'x', mtime: 1 })).toString('base64'),
        rev: 'w1',
      },
    },
  });
  await configure(service);
  const report = await service.syncNow({ scope: JSON_SCOPE });
  assert.equal(report.completed, true);
  assert.deepEqual(report.pulled, []);
  assert.ok(report.skipped.some((item) => item.path === 'notes/wrongname.json'));
  assert.equal(await storage.read('notes', 'kidnapper'), null);
});

test('should_skip_idless_records_without_crashing_when_synced', async () => {
  const { service, remote } = setup({
    storageData: { docs: [{ title: 'بی‌شناسه', content: 'x', folderId: null, updatedAt: 1 }] },
  });
  await configure(service);
  const report = await service.syncNow({ scope: SCOPE });
  assert.equal(report.completed, true);
  assert.deepEqual(report.pushed, []);
  assert.ok(report.skipped.some((item) => item.collection === 'docs' && item.id === null));
  assert.equal(remote.writes().length, 0);
});

test('should_stop_on_conflict_when_synced', async () => {
  const { service, storage, remote, events: bus } = setup({
    storageData: {
      docs: [{ id: 'd1', title: 'یادداشت', content: 'نسخه من', folderId: null, updatedAt: 30 }],
    },
  });
  await configure(service);
  const first = await service.syncNow({ scope: SCOPE });
  assert.equal(first.completed, true);
  remote.files.set('یادداشت.md', {
    content: Buffer.from('نسخه طرف').toString('base64'),
    rev: 'd2',
  });
  await storage.write('docs', { id: 'd1', title: 'یادداشت', content: 'نسخه تازه من', folderId: null, updatedAt: 40 });
  const report = await service.syncNow({ scope: SCOPE });
  assert.equal(report.completed, false);
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0].collection, 'docs');
  assert.equal(report.conflicts[0].id, 'd1');
  assert.equal(report.conflicts[0].local.content, 'نسخه تازه من');
  assert.equal(report.conflicts[0].remote.content, 'نسخه طرف');
  report.conflicts[0].title === null || report.conflicts[0].title === undefined;
  assert.ok(report.conflicts[0].title === undefined || typeof report.conflicts[0].title === 'string');
  assert.ok(bus.seen.some((event) => event.type === 'sync:conflicts'));
  assert.ok(await storage.read('docs', 'd1'), 'expected nothing deleted mid-conflict');
});

test('should_resolve_conflict_via_local_when_resolved', async () => {
  const { service, storage, remote } = setup({
    storageData: {
      docs: [{ id: 'd1', title: 'یادداشت', content: 'نسخه من', folderId: null, updatedAt: 30 }],
    },
  });
  await configure(service);
  await service.syncNow({ scope: SCOPE });
  remote.files.set('یادداشت.md', {
    content: Buffer.from('نسخه طرف').toString('base64'),
    rev: 'd2',
  });
  await storage.write('docs', { id: 'd1', title: 'یادداشت', content: 'نسخه تازه من', folderId: null, updatedAt: 40 });
  const report = await service.syncNow({ scope: SCOPE });
  assert.equal(report.completed, false);
  const resolved = await service.resolveConflict({ collection: 'docs', id: 'd1', choice: 'local' });
  assert.equal(resolved.remaining, 0);
  assert.equal(decode(remote.files.get('یادداشت.md').content), 'نسخه تازه من');
  assert.equal((await storage.read('docs', 'd1')).content, 'نسخه تازه من');
  const status = await service.getStatus();
  assert.equal(typeof status.lastSyncAt, 'number');
  assert.equal(status.lastError, null);
  const done = await service.syncNow({ scope: SCOPE });
  assert.equal(done.completed, true);
  assert.deepEqual(done.conflicts, []);
});

test('should_resolve_conflict_via_remote_when_resolved', async () => {
  const { service, storage, remote } = setup({
    storageData: {
      docs: [{ id: 'd1', title: 'یادداشت', content: 'نسخه من', folderId: null, updatedAt: 30 }],
    },
  });
  await configure(service);
  await service.syncNow({ scope: SCOPE });
  remote.files.set('یادداشت.md', {
    content: Buffer.from('نسخه طرف').toString('base64'),
    rev: 'd2',
  });
  await storage.write('docs', { id: 'd1', title: 'یادداشت', content: 'نسخه تازه من', folderId: null, updatedAt: 40 });
  const report = await service.syncNow({ scope: SCOPE });
  assert.equal(report.completed, false);
  const resolved = await service.resolveConflict({ collection: 'docs', id: 'd1', choice: 'remote' });
  assert.equal(resolved.remaining, 0);
  assert.equal((await storage.read('docs', 'd1')).content, 'نسخه طرف');
  assert.equal(typeof (await service.getStatus()).lastSyncAt, 'number');
  const done = await service.syncNow({ scope: SCOPE });
  assert.equal(done.completed, true);
});

test('should_reject_unknown_conflict_when_resolved', async () => {
  const { service } = setup();
  await configure(service);
  const error = await service.resolveConflict({ collection: 'docs', id: 'x', choice: 'local' }).catch((caught) => caught);
  assert.equal(error?.code, 'SYNC_INVALID_CONFIG');
  const bad = await service.resolveConflict({ collection: 'docs', id: 'x', choice: 'both' }).catch((caught) => caught);
  assert.equal(bad?.code, 'SYNC_INVALID_CONFIG');
  const missing = await service.resolveConflict({ collection: null, id: 4, choice: 'local' }).catch((caught) => caught);
  assert.equal(missing?.code, 'SYNC_INVALID_CONFIG');
});

test('should_reject_resolve_without_backend_when_resolved', async () => {
  const { service } = setup();
  const error = await service.resolveConflict({ collection: 'docs', id: 'd1', choice: 'local' }).catch((caught) => caught);
  assert.equal(error?.code, 'SYNC_NOT_CONFIGURED');
});

test('should_reject_bad_scope_and_unconfigured_when_synced', async () => {
  const { service } = setup();
  await configure(service);
  const empty = await service.syncNow({ scope: { collections: [] } }).catch((caught) => caught);
  assert.equal(empty?.code, 'SYNC_INVALID_CONFIG');
  const bad = await service.syncNow({ scope: { collections: [{ collection: 'docs', serializer: 'yaml' }] } }).catch((caught) => caught);
  assert.equal(bad?.code, 'SYNC_INVALID_CONFIG');
  const fresh = setup();
  const missing = await fresh.service.syncNow({ scope: SCOPE }).catch((caught) => caught);
  assert.equal(missing?.code, 'SYNC_NOT_CONFIGURED');
});

test('should_reject_bad_scope_and_missing_storage_when_checked', async () => {
  const { service } = setup();
  await configure(service);
  const bad = await service.hasPendingChanges({ scope: { collections: [] } }).catch((caught) => caught);
  assert.equal(bad?.code, 'SYNC_INVALID_CONFIG');
  const offline = createService({ storage: null, events: events(), fetchFn: async () => ({}) });
  const missing = await offline.hasPendingChanges({ scope: SCOPE }).catch((caught) => caught);
  assert.equal(missing?.code, 'SYNC_STORAGE_UNAVAILABLE');
});

test('should_fail_status_check_when_storage_is_missing', async () => {
  const service = createService({ storage: null, events: events(), fetchFn: async () => ({}) });
  const error = await service.getStatus().catch((caught) => caught);
  assert.equal(error?.code, 'SYNC_STORAGE_UNAVAILABLE');
});

test('should_fail_backend_removal_when_storage_is_missing', async () => {
  const service = createService({ storage: null, events: events(), fetchFn: async () => ({}) });
  const error = await service.removeBackend().catch((caught) => caught);
  assert.equal(error?.code, 'SYNC_STORAGE_UNAVAILABLE');
});

test('should_tolerate_missing_bus_when_synced', async () => {
  const storage = memoryStorage({ docs: [{ id: 'd1', title: 'x', content: 'y', folderId: null, updatedAt: 1 }] });
  const remote = fakeGitHub({});
  const service = createService({ storage, events: null, fetchFn: remote.fetchFn });
  await service.configureBackend({ kind: 'git', params: { repo: 'u/r', branch: 'main', token: 't' } });
  const report = await service.syncNow({ scope: SCOPE });
  assert.equal(report.completed, true);
});

test('should_keep_local_data_when_backend_is_removed', async () => {
  const { service, storage } = setup({
    storageData: {
      docs: [{ id: 'd1', title: 'یادداشت', content: 'سلام', folderId: null, updatedAt: 1 }],
    },
  });
  await configure(service);
  await service.syncNow({ scope: SCOPE });
  assert.deepEqual(await service.removeBackend(), { ok: true });
  assert.deepEqual(await storage.read('docs', 'd1'), { id: 'd1', title: 'یادداشت', content: 'سلام', folderId: null, updatedAt: 1 });
});

function midRunFetch(contents) {
  return async (url, options = {}) => {
    if (!url.includes('/contents')) {
      return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({}) };
    }
    return contents(url, options);
  };
}

test('should_map_midrun_network_failure_and_report_when_synced', async () => {
  const storage = memoryStorage({
    docs: [{ id: 'd1', title: 'x', content: 'y', folderId: null, updatedAt: 1 }],
  });
  const bus = events();
  const service = createService({
    storage,
    events: bus,
    fetchFn: midRunFetch(async () => { throw new TypeError('fetch failed'); }),
  });
  await configure(service);
  const error = await service.syncNow({ scope: SCOPE }).catch((caught) => caught);
  assert.equal(error?.code, 'SYNC_NETWORK_FAILED');
  assert.equal((await service.getStatus()).lastError?.code, 'SYNC_NETWORK_FAILED');
  assert.ok(bus.seen.some((event) => event.type === 'sync:changed'));
  assert.ok(!bus.seen.some((event) => event.type === 'sync:conflicts'));
});

test('should_map_midrun_rate_limit_when_synced', async () => {
  const storage = memoryStorage({
    docs: [{ id: 'd1', title: 'x', content: 'y', folderId: null, updatedAt: 1 }],
  });
  const service = createService({
    storage,
    events: events(),
    fetchFn: midRunFetch(async () => ({
      status: 403,
      ok: false,
      headers: { get: (name) => (name.toLowerCase() === 'x-ratelimit-remaining' ? '0' : null) },
      json: async () => ({}),
    })),
  });
  await configure(service);
  const error = await service.syncNow({ scope: SCOPE }).catch((caught) => caught);
  assert.equal(error?.code, 'SYNC_RATE_LIMITED');
});

test('should_map_midrun_auth_failure_when_synced', async () => {
  const storage = memoryStorage({
    docs: [{ id: 'd1', title: 'x', content: 'y', folderId: null, updatedAt: 1 }],
  });
  const service = createService({
    storage,
    events: events(),
    fetchFn: midRunFetch(async () => ({
      status: 401, ok: false, headers: { get: () => null }, json: async () => ({}),
    })),
  });
  await configure(service);
  const error = await service.syncNow({ scope: SCOPE }).catch((caught) => caught);
  assert.equal(error?.code, 'SYNC_AUTH_FAILED');
});

test('should_map_missing_repo_and_network_when_configured', async () => {
  const missing = createService({
    storage: memoryStorage(),
    events: events(),
    fetchFn: async () => ({ status: 404, ok: false, headers: { get: () => null }, json: async () => ({}) }),
  });
  const notFound = await missing.configureBackend({ kind: 'git', params: { repo: 'u/r', branch: 'main', token: 't' } }).catch((caught) => caught);
  assert.equal(notFound?.code, 'SYNC_REPO_NOT_FOUND');
  const offline = createService({
    storage: memoryStorage(),
    events: events(),
    fetchFn: async () => { throw new TypeError('fetch failed'); },
  });
  const unreachable = await offline.configureBackend({ kind: 'git', params: { repo: 'u/r', branch: 'main', token: 't' } }).catch((caught) => caught);
  assert.equal(unreachable?.code, 'SYNC_NETWORK_FAILED');
});

test('should_resume_after_midrun_failure_when_synced', async () => {
  const storage = memoryStorage({
    docs: [
      { id: 'd1', title: 'اول', content: 'x', folderId: null, updatedAt: 10 },
      { id: 'd2', title: 'دوم', content: 'y', folderId: null, updatedAt: 20 },
    ],
  });
  const remote = fakeGitHub({});
  let failPuts = true;
  const service = createService({
    storage,
    events: events(),
    fetchFn: async (url, options = {}) => {
      if ((options.method ?? 'GET') === 'PUT' && failPuts) {
        throw new TypeError('fetch failed');
      }
      return remote.fetchFn(url, options);
    },
  });
  await configure(service);
  const first = await service.syncNow({ scope: SCOPE }).catch((caught) => caught);
  assert.equal(first?.code, 'SYNC_NETWORK_FAILED');
  failPuts = false;
  const second = await service.syncNow({ scope: SCOPE });
  assert.equal(second.completed, true);
  assert.ok(remote.files.has('اول.md'));
  assert.ok(remote.files.has('دوم.md'));
  assert.deepEqual(await service.hasPendingChanges({ scope: SCOPE }), { pending: false });
});
