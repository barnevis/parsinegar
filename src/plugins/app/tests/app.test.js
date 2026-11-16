// Verifies the parsinegar.app plugin contract: route ownership and the
// app-wide data reset over the storage service.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { activate, prepare } from '../index.js';
import { DATA_COLLECTIONS } from '../lib/app-service.js';

function createPrepareContext() {
  return {
    config: {},
    events: { subscribe: () => () => {}, publish: () => ({ success: true }) },
    onShutdown: null,
    onDeactivated: null,
    reportCriticalError: () => {},
  };
}

function createRouterService() {
  const registered = [];
  return {
    registered,
    registerRoutes(patterns) {
      registered.push(...patterns);
    },
  };
}

/**
 * Builds an in-memory pey.storage.service double: query/delete/transaction
 * with the exact shapes the wipe flow consumes.
 * @param {object} seed Records per collection.
 * @returns {object} Storage double with `calls` and `records` for asserts.
 */
function createStorageService(seed = {}) {
  const records = {
    documents: seed.documents ?? [],
    folders: seed.folders ?? [],
    settings: seed.settings ?? [],
    'disk-drafts': seed['disk-drafts'] ?? [],
    sync_backends: seed.sync_backends ?? [],
    sync_state: seed.sync_state ?? [],
  };
  const calls = [];
  return {
    records,
    calls,
    async query(collection) {
      calls.push(['query', collection]);
      return records[collection] ?? [];
    },
    async transaction(operations) {
      calls.push(['transaction', operations]);
      for (const op of operations) {
        records[op.collection] = records[op.collection].filter((record) => record.id !== op.key && record.key !== op.key);
      }
    },
  };
}

test('should_provide_the_reset_service_when_prepared', async () => {
  const provided = await prepare(createPrepareContext());
  assert.equal(provided.length, 1);
  assert.equal(provided[0].name, 'parsinegar.app.service');
  assert.equal(typeof provided[0].object.wipeAllData, 'function');
});

test('should_register_owned_routes_when_activated', async () => {
  const router = createRouterService();
  await activate({ 'pey.router.service': router, 'pey.storage.service': createStorageService() });
  assert.deepEqual(router.registered, ['/', '/not-found']);
});

test('should_fail_clearly_when_router_is_missing', async () => {
  await assert.rejects(activate({ 'pey.storage.service': createStorageService() }), /pey\.router\.service/);
});

test('should_fail_clearly_when_storage_is_missing', async () => {
  const error = await activate({ 'pey.router.service': createRouterService() }).catch((caught) => caught);
  assert.equal(error?.code, 'APP_STORAGE_UNAVAILABLE');
  assert.equal(error?.type, 'startup');
  assert.match(error?.message ?? '', /pey\.storage\.service/);
});

test('should_report_critical_error_when_storage_service_is_lost', async () => {
  const subscriptions = new Map();
  const reported = [];
  const context = createPrepareContext();
  context.events = {
    subscribe: (name, handler) => {
      subscriptions.set(name, handler);
      return () => subscriptions.delete(name);
    },
    publish: () => ({ success: true }),
  };
  context.reportCriticalError = (error) => reported.push(error);
  const [registration] = await prepare(context);
  await activate({ 'pey.router.service': createRouterService(), 'pey.storage.service': createStorageService() });
  subscriptions.get('core:service-unavailable')({ data: { serviceName: 'pey.storage.service' } });
  assert.equal(reported[0]?.code, 'REQUIRED_DEPENDENCY_LOST');
  assert.equal(reported[0]?.type, 'critical');
  registration.object.wipeAllData().catch(() => {});
});

test('should_ignore_unrelated_service_loss_when_notified', async () => {
  const subscriptions = new Map();
  const reported = [];
  const context = createPrepareContext();
  context.events = {
    subscribe: (name, handler) => {
      subscriptions.set(name, handler);
      return () => subscriptions.delete(name);
    },
    publish: () => ({ success: true }),
  };
  context.reportCriticalError = (error) => reported.push(error);
  await prepare(context);
  subscriptions.get('core:service-unavailable')({ data: { serviceName: 'pey.router.service' } });
  assert.deepEqual(reported, []);
});

test('should_wipe_every_collection_in_one_transaction_when_wiped', async () => {
  const context = createPrepareContext();
  const [registration] = await prepare(context);
  const storage = createStorageService({
    documents: [{ id: 'd1' }, { id: 'd2' }],
    folders: [{ id: 'f1' }],
    settings: [{ id: 'preferences' }],
    'disk-drafts': [{ key: 'draft-1' }],
    sync_backends: [{ id: 'active' }],
    sync_state: [{ id: 'active' }],
  });
  await activate({ 'pey.router.service': createRouterService(), 'pey.storage.service': storage });
  const outcome = await registration.object.wipeAllData();
  assert.deepEqual(outcome, {
    ok: true,
    cleared: {
      documents: 2,
      folders: 1,
      settings: 1,
      'disk-drafts': 1,
      sync_backends: 1,
      sync_state: 1,
    },
  });
  // Every collection queried, then ONE atomic transaction carrying all the
  // deletes with each store's own key field (disk-drafts keys on `key`).
  const transactions = storage.calls.filter(([name]) => name === 'transaction');
  assert.equal(transactions.length, 1);
  const operations = transactions[0][1];
  assert.deepEqual(operations.map((op) => [op.collection, op.key]).sort(), [
    ['disk-drafts', 'draft-1'],
    ['documents', 'd1'],
    ['documents', 'd2'],
    ['folders', 'f1'],
    ['settings', 'preferences'],
    ['sync_backends', 'active'],
    ['sync_state', 'active'],
  ]);
  assert.deepEqual(storage.records.documents, []);
  assert.deepEqual(storage.records['disk-drafts'], []);
});

test('should_skip_the_transaction_when_stores_are_already_empty', async () => {
  const context = createPrepareContext();
  const [registration] = await prepare(context);
  const storage = createStorageService();
  await activate({ 'pey.router.service': createRouterService(), 'pey.storage.service': storage });
  const outcome = await registration.object.wipeAllData();
  assert.deepEqual(outcome.cleared, { documents: 0, folders: 0, settings: 0, 'disk-drafts': 0, sync_backends: 0, sync_state: 0 });
  assert.ok(!storage.calls.some(([name]) => name === 'transaction'), 'expected no empty transaction');
});

test('should_fail_clearly_when_wiped_before_storage_binds', async () => {
  const context = createPrepareContext();
  const [registration] = await prepare(context);
  await assert.rejects(registration.object.wipeAllData(), (error) => {
    assert.equal(error.code, 'APP_STORAGE_UNAVAILABLE');
    assert.equal(error.source, 'parsinegar.app.service');
    assert.equal(error.type, 'operational');
    return true;
  });
});

test('should_declare_exactly_the_bootstrapped_stores_as_wipe_targets', async () => {
  // A store added to bootstrap without landing in the wipe list would keep
  // its data through a "wipe everything" — pin the two lists together.
  const bootstrap = JSON.parse(await readFile(new URL('../../../../bootstrap.json', import.meta.url), 'utf8'));
  const stores = bootstrap.config['pey.storage'].stores.map((store) => store.name);
  assert.deepEqual(
    DATA_COLLECTIONS.map(({ collection }) => collection).sort(),
    [...stores].sort(),
    'expected every bootstrapped store to be a wipe target',
  );
});
