// Verifies the documents service (fake storage, fake events).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from '../lib/documents-service.js';

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

function createState(initial = [], published = []) {
  return {
    storage: createStorage(initial),
    events: {
      publish: (type, data) => {
        published.push({ type, data });
        return { success: true };
      },
    },
  };
}

function setup(initial = [], published = []) {
  const state = createState(initial, published);
  return { service: createService(state), published };
}

test('should_order_by_updated_when_listed', async () => {
  const { service } = setup([
    { id: 'old', title: 'قدیمی', content: '', updatedAt: 100 },
    { id: 'new', title: 'تازه', content: '', updatedAt: 300 },
    { id: 'mid', title: 'میانی', content: '', updatedAt: 200 },
  ]);
  const listed = await service.listDocuments();
  assert.deepEqual(listed.map(({ id }) => id), ['new', 'mid', 'old']);
});

test('should_return_null_when_opening_missing_document', async () => {
  const { service } = setup();
  assert.equal(await service.openDocument('absent'), null);
});

test('should_return_null_when_storage_reports_missing_record', async () => {
  const state = createState();
  state.storage.read = async () => {
    throw Object.assign(new Error('missing'), { code: 'RECORD_NOT_FOUND' });
  };
  assert.equal(await createService(state).openDocument('absent'), null);
});

test('should_stamp_and_publish_when_saved', async () => {
  const published = [];
  const { service } = setup([], published);
  const saved = await service.saveDocument({ title: 'یادداشت', content: '# سلام' });
  assert.ok(typeof saved.id === 'string' && saved.id.length > 0);
  assert.equal(saved.title, 'یادداشت');
  assert.ok(typeof saved.updatedAt === 'number');
  assert.deepEqual(published, [{ type: 'documents:changed', data: { id: saved.id } }]);
  assert.deepEqual(await service.openDocument(saved.id), saved);
});

test('should_default_fields_when_saved_minimally', async () => {
  const { service } = setup();
  const saved = await service.saveDocument({});
  assert.equal(saved.title, 'بدون عنوان');
  assert.equal(saved.content, '');
});

test('should_create_empty_document_when_created', async () => {
  const { service } = setup();
  const created = await service.createDocument('ایده‌ها');
  assert.equal(created.title, 'ایده‌ها');
  assert.equal(created.content, '');
});

test('should_publish_when_deleted', async () => {
  const published = [];
  const { service } = setup([{ id: 'd1', title: 't', content: '', updatedAt: 1 }], published);
  await service.deleteDocument('d1');
  assert.equal(await service.openDocument('d1'), null);
  assert.deepEqual(published, [{ type: 'documents:changed', data: { id: 'd1' } }]);
});
