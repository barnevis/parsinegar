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

function fakeGitHub({ files = {}, failOpen = null, forceManifestConflict = false } = {}) {
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
    calls.push({ method, url });
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
      if (forceManifestConflict && path === 'sync-manifest.json') {
        return fail(409);
      }
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
    { collection: 'folders', serializer: 'json' },
    {
      collection: 'docs',
      serializer: 'markdown',
      titleField: 'title',
      folders: { collection: 'folders', nameField: 'name' },
    },
  ],
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
  assert.deepEqual(report.pushed.map((item) => item.id).sort(), ['d1', 'f1']);
  assert.deepEqual(report.conflicts, []);
  assert.ok(remote.files.has('docs/کار/یادداشت.md') || [...remote.files.keys()].some((key) => key.endsWith('/یادداشت.md')));
  assert.ok(remote.files.has('sync-manifest.json'));
  const manifest = JSON.parse(decode(remote.files.get('sync-manifest.json').content));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.records.length, 2);
  assert.ok(manifest.records.some((item) => item.title === 'یادداشت'));
  const status = await service.getStatus();
  assert.equal(typeof status.lastSyncAt, 'number');
  assert.equal(status.lastError, null);
  assert.ok(bus.seen.some((event) => event.type === 'sync:changed'));
  assert.ok(!bus.seen.some((event) => event.type === 'sync:conflicts'));
});

test('should_write_nothing_on_repeat_sync_when_synced', async () => {
  const { service, remote } = setup({
    storageData: {
      docs: [{ id: 'd1', title: 'یادداشت', content: 'سلام', folderId: null, updatedAt: 20 }],
    },
  });
  await configure(service);
  await service.syncNow({ scope: SCOPE });
  const writes = remote.writes().length;
  const second = await service.syncNow({ scope: SCOPE });
  assert.equal(second.completed, true);
  assert.deepEqual(second.pushed, []);
  assert.deepEqual(second.pulled, []);
  assert.equal(remote.writes().length, writes);
});

test('should_pull_remote_tree_when_synced', async () => {
  const manifest = {
    version: 1,
    records: [
      { collection: 'folders', id: 'f1', path: 'folders/f1.json', updatedAt: 10, hash: 'h', title: null },
      { collection: 'docs', id: 'd1', path: 'کار/یادداشت.md', updatedAt: 20, hash: 'h', title: 'یادداشت' },
    ],
  };
  const folderRecord = { id: 'f1', name: 'کار', parentId: null, updatedAt: 10 };
  const { service, storage } = setup({
    files: {
      'sync-manifest.json': { content: Buffer.from(JSON.stringify(manifest)).toString('base64'), rev: 'm1' },
      'folders/f1.json': { content: Buffer.from(JSON.stringify(folderRecord)).toString('base64'), rev: 'f1' },
      'کار/یادداشت.md': { content: Buffer.from('سلام از راه دور').toString('base64'), rev: 'd1' },
    },
  });
  await configure(service);
  const report = await service.syncNow({ scope: SCOPE });
  assert.equal(report.completed, true);
  assert.deepEqual(report.pulled.map((item) => item.id).sort(), ['d1', 'f1']);
  const doc = await storage.read('docs', 'd1');
  assert.equal(doc.content, 'سلام از راه دور');
  assert.equal(doc.title, 'یادداشت');
  assert.equal(doc.folderId, 'f1');
});

function scopeWithIgnore(patterns) {
  return {
    collections: [
      { collection: 'folders', serializer: 'json' },
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
  assert.ok(
    ![...remote.files.keys()].some((key) => key !== 'sync-manifest.json'),
    'expected nothing pushed',
  );
  assert.deepEqual(await service.hasPendingChanges({ scope }), { pending: false });
});

test('should_leave_ignored_remote_files_alone_when_synced', async () => {
  const manifest = {
    version: 1,
    records: [
      { collection: 'docs', id: 'd1', path: 'پیش‌نویس.md', updatedAt: 20, hash: 'h', title: 'پیش‌نویس' },
    ],
  };
  const { service, storage, remote } = setup({
    files: {
      'sync-manifest.json': { content: Buffer.from(JSON.stringify(manifest)).toString('base64'), rev: 'm1' },
      'پیش‌نویس.md': { content: Buffer.from('متن').toString('base64'), rev: 'd1' },
    },
  });
  await configure(service);
  const report = await service.syncNow({ scope: scopeWithIgnore(['پیش‌نویس']) });
  assert.equal(report.completed, true);
  assert.deepEqual(report.pulled, []);
  assert.deepEqual(report.deletedRemote, []);
  assert.ok(remote.files.has('پیش‌نویس.md'), 'expected the ignored file untouched');
  assert.equal(await storage.read('docs', 'd1'), null);
});

test('should_not_delete_previously_synced_when_ignored', async () => {
  const { service, remote } = setup({
    storageData: {
      docs: [{ id: 'd1', title: 'یادداشت', content: 'سلام', folderId: null, updatedAt: 20 }],
    },
  });
  await configure(service);
  const first = await service.syncNow({ scope: SCOPE });
  assert.equal(first.completed, true);
  assert.ok(remote.files.has('یادداشت.md'));
  const scope = scopeWithIgnore(['یادداشت']);
  const second = await service.syncNow({ scope });
  assert.equal(second.completed, true);
  assert.deepEqual(second.deletedRemote, []);
  assert.deepEqual(second.pushed, []);
  assert.ok(remote.files.has('یادداشت.md'), 'expected the ignored file kept');
  assert.deepEqual(await service.hasPendingChanges({ scope }), { pending: false });
});

test('should_reject_bad_ignore_when_synced', async () => {
  const { service } = setup();
  await configure(service);
  const error = await service.syncNow({
    scope: { collections: [{ collection: 'docs', serializer: 'markdown', ignore: 'nope' }] },
  }).catch((caught) => caught);
  assert.equal(error?.code, 'SYNC_INVALID_CONFIG');
});

test('should_relocate_when_folder_chain_breaks_when_synced', async () => {
  const manifest = {
    version: 1,
    records: [{ collection: 'docs', id: 'd1', path: 'گمشده/یادداشت.md', updatedAt: 20, hash: 'h', title: 'یادداشت' }],
  };
  const { service, storage } = setup({
    files: {
      'sync-manifest.json': { content: Buffer.from(JSON.stringify(manifest)).toString('base64'), rev: 'm1' },
      'گمشده/یادداشت.md': { content: Buffer.from('متن').toString('base64'), rev: 'd1' },
    },
  });
  await configure(service);
  const report = await service.syncNow({ scope: SCOPE });
  assert.equal(report.completed, true);
  const doc = await storage.read('docs', 'd1');
  assert.equal(doc.folderId, null);
  assert.deepEqual(report.relocated, [{ collection: 'docs', id: 'd1', path: 'گمشده/یادداشت.md' }]);
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
  const manifest = JSON.parse(Buffer.from(remote.files.get('sync-manifest.json').content, 'base64').toString('utf8'));
  assert.ok(!manifest.records.some((item) => item.id === 'gone-local'));
  remote.files.delete('ماندنی.md');
  const listed = manifest.records.filter((item) => item.id !== 'keep');
  remote.files.set('sync-manifest.json', {
    content: Buffer.from(JSON.stringify({ version: 1, records: listed })).toString('base64'),
    rev: 'm9',
  });
  const third = await service.syncNow({ scope: SCOPE });
  assert.ok(third.deleteLocal.some((item) => item.id === 'keep'));
  assert.equal(await storage.read('docs', 'keep'), null);
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
  const manifest = JSON.parse(Buffer.from(remote.files.get('sync-manifest.json').content, 'base64').toString('utf8'));
  manifest.records[0] = { ...manifest.records[0], updatedAt: 35, hash: 'other' };
  remote.files.set('sync-manifest.json', {
    content: Buffer.from(JSON.stringify(manifest)).toString('base64'),
    rev: 'm2',
  });
  remote.files.set('یادداشت.md', {
    content: Buffer.from('نسخه طرف').toString('base64'),
    rev: 'd2',
  });
  await storage.write('docs', { id: 'd1', title: 'یادداشت', content: 'نسخه تازه من', folderId: null, updatedAt: 40 });
  const report = await service.syncNow({ scope: SCOPE });
  assert.equal(report.completed, false);
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0].local.content, 'نسخه تازه من');
  assert.equal(report.conflicts[0].remote.content, 'نسخه طرف');
  const status = await service.getStatus();
  assert.equal(typeof status.lastSyncAt, 'number');
  assert.ok(bus.seen.some((event) => event.type === 'sync:conflicts'));
});

test('should_resolve_conflict_when_resolved', async () => {
  const { service } = setup({
    storageData: {
      docs: [{ id: 'd1', title: 'یادداشت', content: 'نسخه من', folderId: null, updatedAt: 40 }],
    },
  });
  await configure(service);
  const first = await service.syncNow({ scope: SCOPE });
  assert.equal(first.completed, true);
  const { service: third, remote } = setup({
    storageData: {
      docs: [{ id: 'd1', title: 'یادداشت', content: 'نسخه تازه من', folderId: null, updatedAt: 50 }],
    },
  });
  await third.configureBackend({ kind: 'git', params: { repo: 'u/r', branch: 'main', token: 't' } });
  remote.files.set('sync-manifest.json', {
    content: Buffer.from(JSON.stringify({
      version: 1,
      records: [{ collection: 'docs', id: 'd1', path: 'docs/یادداشت.md', updatedAt: 45, hash: 'other', title: 'یادداشت' }],
    })).toString('base64'),
    rev: 'm2',
  });
  remote.files.set('docs/یادداشت.md', {
    content: Buffer.from('نسخه طرف').toString('base64'),
    rev: 'd2',
  });
  const report = await third.syncNow({ scope: SCOPE });
  assert.equal(report.completed, false);
  const resolved = await third.resolveConflict({ collection: 'docs', id: 'd1', choice: 'local' });
  assert.equal(resolved.remaining, 0);
  const status = await third.getStatus();
  assert.equal(typeof status.lastSyncAt, 'number');
  const done = await third.syncNow({ scope: SCOPE });
  assert.equal(done.completed, true);
  assert.deepEqual(done.conflicts, []);
});

test('should_reject_unknown_conflict_when_resolved', async () => {
  const { service } = setup();
  await configure(service);
  const error = await service.resolveConflict({ collection: 'docs', id: 'x', choice: 'local' }).catch((caught) => caught);
  assert.equal(error?.code, 'SYNC_INVALID_CONFIG');
  const bad = await service.resolveConflict({ collection: 'docs', id: 'x', choice: 'both' }).catch((caught) => caught);
  assert.equal(bad?.code, 'SYNC_INVALID_CONFIG');
});

test('should_fail_on_corrupt_manifest_when_synced', async () => {
  const { service } = setup({
    storageData: { docs: [{ id: 'd1', title: 'x', content: 'y', folderId: null, updatedAt: 1 }] },
    files: { 'sync-manifest.json': { content: Buffer.from('nope').toString('base64'), rev: 'm' } },
  });
  await configure(service);
  const error = await service.syncNow({ scope: SCOPE }).catch((caught) => caught);
  assert.equal(error?.code, 'SYNC_CORRUPT_MANIFEST');
  const status = await service.getStatus();
  assert.equal(status.lastError?.code, 'SYNC_CORRUPT_MANIFEST');
});

test('should_fail_on_concurrent_manifest_write_when_synced', async () => {
  const { service } = setup({
    storageData: { docs: [{ id: 'd1', title: 'x', content: 'y', folderId: null, updatedAt: 1 }] },
    options: { forceManifestConflict: true },
  });
  await configure(service);
  const error = await service.syncNow({ scope: SCOPE }).catch((caught) => caught);
  assert.equal(error?.code, 'SYNC_CONCURRENT_CHANGE');
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

test('should_tolerate_missing_bus_when_synced', async () => {
  const storage = memoryStorage({ docs: [{ id: 'd1', title: 'x', content: 'y', folderId: null, updatedAt: 1 }] });
  const remote = fakeGitHub({});
  const service = createService({ storage, events: null, fetchFn: remote.fetchFn });
  await service.configureBackend({ kind: 'git', params: { repo: 'u/r', branch: 'main', token: 't' } });
  const report = await service.syncNow({ scope: SCOPE });
  assert.equal(report.completed, true);
});

test('should_fail_backend_removal_when_storage_is_missing', async () => {
  const service = createService({ storage: null, events: events(), fetchFn: async () => ({}) });
  const error = await service.removeBackend().catch((caught) => caught);
  assert.equal(error?.code, 'SYNC_STORAGE_UNAVAILABLE');
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

test('should_reject_resolve_without_backend_when_resolved', async () => {
  const { service } = setup();
  const error = await service.resolveConflict({ collection: 'docs', id: 'd1', choice: 'local' }).catch((caught) => caught);
  assert.equal(error?.code, 'SYNC_NOT_CONFIGURED');
});

test('should_apply_remote_side_when_resolved', async () => {
  const { service: third, storage, remote } = setup({
    storageData: {
      docs: [{ id: 'd1', title: 'یادداشت', content: 'نسخه تازه من', folderId: null, updatedAt: 50 }],
    },
  });
  await third.configureBackend({ kind: 'git', params: { repo: 'u/r', branch: 'main', token: 't' } });
  remote.files.set('sync-manifest.json', {
    content: Buffer.from(JSON.stringify({
      version: 1,
      records: [{ collection: 'docs', id: 'd1', path: 'یادداشت.md', updatedAt: 45, hash: 'other', title: 'یادداشت' }],
    })).toString('base64'),
    rev: 'm2',
  });
  remote.files.set('یادداشت.md', {
    content: Buffer.from('نسخه طرف').toString('base64'),
    rev: 'd2',
  });
  const report = await third.syncNow({ scope: SCOPE });
  assert.equal(report.completed, false);
  assert.equal(report.conflicts.length, 1);
  const resolved = await third.resolveConflict({ collection: 'docs', id: 'd1', choice: 'remote' });
  assert.equal(resolved.remaining, 0);
  assert.equal((await storage.read('docs', 'd1')).content, 'نسخه طرف');
  assert.equal(typeof (await third.getStatus()).lastSyncAt, 'number');
  const done = await third.syncNow({ scope: SCOPE });
  assert.equal(done.completed, true);
});

test('should_fail_resolve_on_concurrent_manifest_write_when_resolved', async () => {
  const { service: third, remote } = setup({
    storageData: {
      docs: [{ id: 'd1', title: 'یادداشت', content: 'نسخه تازه من', folderId: null, updatedAt: 50 }],
    },
    options: { forceManifestConflict: true },
  });
  await third.configureBackend({ kind: 'git', params: { repo: 'u/r', branch: 'main', token: 't' } });
  remote.files.set('sync-manifest.json', {
    content: Buffer.from(JSON.stringify({
      version: 1,
      records: [{ collection: 'docs', id: 'd1', path: 'یادداشت.md', updatedAt: 45, hash: 'other', title: 'یادداشت' }],
    })).toString('base64'),
    rev: 'm2',
  });
  remote.files.set('یادداشت.md', {
    content: Buffer.from('نسخه طرف').toString('base64'),
    rev: 'd2',
  });
  const report = await third.syncNow({ scope: SCOPE });
  assert.equal(report.completed, false);
  const error = await third.resolveConflict({ collection: 'docs', id: 'd1', choice: 'local' }).catch((caught) => caught);
  assert.equal(error?.code, 'SYNC_CONCURRENT_CHANGE');
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

test('should_push_pull_and_stop_on_conflict_in_order_when_synced', async () => {
  const manifest = {
    version: 1,
    records: [
      { collection: 'docs', id: 'b1', path: 'ب.md', updatedAt: 20, hash: hashRecord('b-remote'), title: 'ب' },
      { collection: 'docs', id: 'c', path: 'جیم.md', updatedAt: 25, hash: 'remote-h', title: 'جیم' },
    ],
  };
  const { service, storage, remote, events: bus } = setup({
    storageData: {
      docs: [
        { id: 'a', title: 'الف', content: 'mine-a', folderId: null, updatedAt: 20 },
        { id: 'c', title: 'جیم', content: 'mine-c', folderId: null, updatedAt: 30 },
      ],
    },
    files: {
      'sync-manifest.json': { content: Buffer.from(JSON.stringify(manifest)).toString('base64'), rev: 'm1' },
      'ب.md': { content: Buffer.from('b-remote').toString('base64'), rev: 'b1' },
      'جیم.md': { content: Buffer.from('theirs-c').toString('base64'), rev: 'c2' },
    },
  });
  await configure(service);
  const report = await service.syncNow({ scope: SCOPE });
  assert.equal(report.completed, false);
  assert.deepEqual(report.pushed.map((item) => item.id), ['a']);
  assert.deepEqual(report.pulled.map((item) => item.id), ['b1']);
  assert.deepEqual(report.conflicts.map((item) => item.id), ['c']);
  assert.equal((await storage.read('docs', 'b1')).content, 'b-remote');
  assert.ok(bus.seen.some((event) => event.type === 'sync:conflicts'));
  const resolved = await service.resolveConflict({ collection: 'docs', id: 'c', choice: 'remote' });
  assert.equal(resolved.remaining, 0);
  assert.equal((await storage.read('docs', 'c')).content, 'theirs-c');
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

test('should_sync_custom_id_and_stamp_fields_when_synced', async () => {
  const custom = {
    collections: [{ collection: 'notes', serializer: 'json', idField: 'key', updatedAtField: 'mtime' }],
  };
  const { service } = setup({
    storageData: { notes: [{ key: 'n1', text: 'hi', mtime: 5 }] },
  });
  await configure(service);
  const report = await service.syncNow({ scope: custom });
  assert.equal(report.completed, true);
  assert.deepEqual(report.pushed.map((item) => item.id), ['n1']);
  assert.deepEqual(await service.hasPendingChanges({ scope: custom }), { pending: false });
});

test('should_skip_idless_records_without_crashing_when_synced', async () => {
  const { service } = setup({
    storageData: { docs: [{ title: 'بی‌شناسه', content: 'x', folderId: null, updatedAt: 1 }] },
  });
  await configure(service);
  const report = await service.syncNow({ scope: SCOPE });
  assert.equal(report.completed, true);
  assert.deepEqual(report.pushed, []);
  assert.ok(report.skipped.some((item) => item.collection === 'docs' && item.id === null));
});
