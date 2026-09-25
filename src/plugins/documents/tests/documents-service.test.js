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

test('should_stamp_created_at_when_saved', async () => {
  const { service } = setup();
  const saved = await service.saveDocument({ title: 'یادداشت', content: 'x' });
  assert.equal(saved.createdAt, saved.updatedAt);
});

test('should_preserve_created_at_when_resaved', async () => {
  const { service } = setup([{ id: 'd1', title: 't', content: '', createdAt: 100, updatedAt: 200 }]);
  const saved = await service.saveDocument({ id: 'd1', title: 't', content: 'new' });
  assert.equal(saved.createdAt, 100);
  assert.ok(saved.updatedAt >= 200);
});

test('should_backfill_created_at_when_missing', async () => {
  const { service } = setup([{ id: 'd1', title: 't', content: '', updatedAt: 300 }]);
  assert.equal((await service.openDocument('d1')).createdAt, 300);
  assert.equal((await service.listDocuments())[0].createdAt, 300);
});

test('should_reject_duplicate_title_when_saving', async () => {
  const published = [];
  const { service } = setup([{ id: 'd1', title: 'تکراری', content: '', updatedAt: 1 }], published);
  const error = await service.saveDocument({ title: 'تکراری', content: 'x' }).catch((caught) => caught);
  assert.equal(error?.code, 'DOCUMENT_TITLE_DUPLICATE');
  assert.deepEqual(published, []);
});

test('should_allow_same_title_when_updating_own_record', async () => {
  const { service } = setup([{ id: 'd1', title: 'تکراری', content: '', updatedAt: 1 }]);
  const saved = await service.saveDocument({ id: 'd1', title: 'تکراری', content: 'new' });
  assert.equal(saved.content, 'new');
});

test('should_suffix_until_unique_when_created', async () => {
  const { service } = setup([{ id: 'd1', title: 'سند تازه', content: '', updatedAt: 1 }]);
  const created = await service.createDocument('سند تازه');
  assert.equal(created.title, 'سند تازه ۲');
});

test('should_rename_when_title_is_free', async () => {
  const published = [];
  const { service } = setup([{ id: 'd1', title: 'قدیمی', content: 'متن', createdAt: 100, updatedAt: 200 }], published);
  const renamed = await service.renameDocument('d1', 'تازه');
  assert.equal(renamed.title, 'تازه');
  assert.equal(renamed.content, 'متن');
  assert.equal(renamed.createdAt, 100);
  assert.deepEqual(published, [{ type: 'documents:changed', data: { id: 'd1' } }]);
});

test('should_reject_duplicate_title_when_renaming', async () => {
  const published = [];
  const { service } = setup([
    { id: 'd1', title: 'اول', content: '', updatedAt: 1 },
    { id: 'd2', title: 'دوم', content: '', updatedAt: 2 },
  ], published);
  const error = await service.renameDocument('d1', 'دوم').catch((caught) => caught);
  assert.equal(error?.code, 'DOCUMENT_TITLE_DUPLICATE');
  assert.deepEqual(published, []);
});

test('should_reject_empty_title_when_renaming', async () => {
  const { service } = setup([{ id: 'd1', title: 'اول', content: '', updatedAt: 1 }]);
  const error = await service.renameDocument('d1', '   ').catch((caught) => caught);
  assert.equal(error?.code, 'DOCUMENT_INVALID_TITLE');
});

test('should_return_null_when_renaming_missing_document', async () => {
  const { service } = setup();
  assert.equal(await service.renameDocument('absent', 'x'), null);
});

test('should_default_read_only_when_records_predate_it', async () => {
  const { service } = setup([{ id: 'd1', title: 'اول', content: '', updatedAt: 1 }]);
  assert.equal((await service.openDocument('d1')).readOnly, false);
  const listed = await service.listDocuments();
  assert.equal(listed[0].readOnly, false);
});

test('should_lock_and_publish_when_read_only_is_set', async () => {
  const published = [];
  const { service } = setup([{ id: 'd1', title: 'اول', content: 'x', updatedAt: 1 }], published);
  const locked = await service.setReadOnly('d1', true);
  assert.equal(locked.readOnly, true);
  assert.equal(locked.title, 'اول');
  assert.equal(locked.content, 'x');
  assert.deepEqual(published, [{ type: 'documents:changed', data: { id: 'd1' } }]);
  assert.equal((await service.openDocument('d1')).readOnly, true);
  const unlocked = await service.setReadOnly('d1', false);
  assert.equal(unlocked.readOnly, false);
});

test('should_return_null_when_locking_missing_document', async () => {
  const published = [];
  const { service } = setup([], published);
  assert.equal(await service.setReadOnly('absent', true), null);
  assert.deepEqual(published, []);
});

test('should_preserve_lock_when_saved_without_flag', async () => {
  const { service } = setup([{ id: 'd1', title: 'اول', content: 'x', updatedAt: 1, readOnly: true }]);
  const saved = await service.saveDocument({ id: 'd1', title: 'اول', content: 'y' });
  assert.equal(saved.readOnly, true);
  assert.equal(saved.content, 'y');
  const cleared = await service.saveDocument({ id: 'd1', title: 'اول', content: 'z', readOnly: false });
  assert.equal(cleared.readOnly, false);
});
