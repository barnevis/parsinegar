// Verifies the parsinegar.documents plugin contract (fake storage service).
import assert from 'node:assert/strict';
import test from 'node:test';
import { activate, prepare } from '../../../src/plugins/documents/index.js';

function createPrepareContext(published = []) {
  return {
    config: {},
    events: {
      subscribe: () => () => {},
      publish: (type, data) => {
        published.push({ type, data });
        return { success: true };
      },
    },
    onShutdown: null,
    onDeactivated: null,
    reportCriticalError: () => {},
  };
}

function createStorage(initial = []) {
  const records = new Map(initial.map((record) => [record.id, { ...record }]));
  return {
    records,
    async query() {
      return [...records.values()];
    },
    async read(collection, key) {
      return records.get(key) ?? null;
    },
    async write(collection, record) {
      records.set(record.id, { ...record });
    },
    async delete(collection, key) {
      records.delete(key);
    },
  };
}

async function setup(initial = [], published = []) {
  const provided = await prepare(createPrepareContext(published));
  const storage = createStorage(initial);
  await activate({ 'pey.storage.service': storage });
  const service = provided.find(({ name }) => name === 'parsinegar.documents.service').object;
  return { service, storage, published };
}

test('should_register_service_when_prepared', async () => {
  const provided = await prepare(createPrepareContext());
  assert.deepEqual(provided.map(({ name }) => name), ['parsinegar.documents.service']);
});

test('should_fail_clearly_when_storage_is_missing', async () => {
  await prepare(createPrepareContext());
  await assert.rejects(activate({}), /pey\.storage\.service/);
});

test('should_fail_service_calls_when_called_before_activation', async () => {
  const provided = await prepare(createPrepareContext());
  const service = provided[0].object;
  await assert.rejects(service.listDocuments(), /pey\.storage\.service/);
});

test('should_order_by_updated_when_listed', async () => {
  const { service } = await setup([
    { id: 'old', title: 'قدیمی', content: '', updatedAt: 100 },
    { id: 'new', title: 'تازه', content: '', updatedAt: 300 },
    { id: 'mid', title: 'میانی', content: '', updatedAt: 200 },
  ]);
  const listed = await service.listDocuments();
  assert.deepEqual(listed.map(({ id }) => id), ['new', 'mid', 'old']);
});

test('should_return_null_when_opening_missing_document', async () => {
  const { service } = await setup();
  assert.equal(await service.openDocument('absent'), null);
});

test('should_return_null_when_storage_reports_missing_record', async () => {
  const provided = await prepare(createPrepareContext());
  const failing = { query: async () => [], write: async () => {}, delete: async () => {} };
  failing.read = async () => {
    throw Object.assign(new Error('missing'), { code: 'RECORD_NOT_FOUND' });
  };
  await activate({ 'pey.storage.service': failing });
  assert.equal(await provided[0].object.openDocument('absent'), null);
});

test('should_stamp_and_publish_when_saved', async () => {
  const published = [];
  const { service } = await setup([], published);
  const saved = await service.saveDocument({ title: 'یادداشت', content: '# سلام' });
  assert.ok(typeof saved.id === 'string' && saved.id.length > 0);
  assert.equal(saved.title, 'یادداشت');
  assert.ok(typeof saved.updatedAt === 'number');
  assert.deepEqual(published, [{ type: 'documents:changed', data: { id: saved.id } }]);
  assert.deepEqual(await service.openDocument(saved.id), saved);
});

test('should_default_fields_when_saved_minimally', async () => {
  const { service } = await setup();
  const saved = await service.saveDocument({});
  assert.equal(saved.title, 'بدون عنوان');
  assert.equal(saved.content, '');
});

test('should_create_empty_document_when_created', async () => {
  const { service } = await setup();
  const created = await service.createDocument('ایده‌ها');
  assert.equal(created.title, 'ایده‌ها');
  assert.equal(created.content, '');
});

test('should_publish_when_deleted', async () => {
  const published = [];
  const { service } = await setup([{ id: 'd1', title: 't', content: '', updatedAt: 1 }], published);
  await service.deleteDocument('d1');
  assert.equal(await service.openDocument('d1'), null);
  assert.deepEqual(published, [{ type: 'documents:changed', data: { id: 'd1' } }]);
});
