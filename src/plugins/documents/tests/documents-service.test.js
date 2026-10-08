// Verifies the documents service (fake storage, fake events).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from '../lib/documents-service.js';

function createStorage(initial = []) {
  const data = new Map(initial.map((record) => [`documents/${record.id}`, { ...record }]));
  return {
    records: data,
    async query(collection) {
      return [...data.entries()]
        .filter(([key]) => key.startsWith(`${collection}/`))
        .map(([, record]) => record);
    },
    async read(collection, key) {
      return data.get(`${collection}/${key}`) ?? null;
    },
    async write(collection, record) {
      data.set(`${collection}/${record.id ?? record.key}`, { ...record });
    },
    async delete(collection, key) {
      data.delete(`${collection}/${key}`);
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

test('should_fail_with_structured_error_when_storage_is_missing', async () => {
  const service = createService({ storage: null, events: null });
  const error = await service.listDocuments().catch((caught) => caught);
  assert.equal(error?.code, 'DOCUMENTS_STORAGE_UNAVAILABLE');
  assert.equal(error?.source, 'parsinegar.documents.service');
  assert.equal(error?.type, 'operational');
  assert.equal(typeof error?.timestamp, 'string');
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

test('should_backfill_folder_when_missing', async () => {
  const { service } = setup([{ id: 'd', title: 'قدیمی', content: '', updatedAt: 1 }]);
  const [listed] = await service.listDocuments();
  assert.equal(listed.folderId, null);
  assert.equal((await service.openDocument('d')).folderId, null);
});

test('should_save_into_folder_when_created', async () => {
  const { service } = setup();
  const folder = await service.createFolder('کار');
  const created = await service.createDocument('یادداشت', folder.id);
  assert.equal(created.folderId, folder.id);
  const moved = await service.moveDocument(created.id, null);
  assert.equal(moved.folderId, null);
});

test('should_fall_back_to_root_when_folder_is_missing', async () => {
  const { service } = setup();
  const created = await service.createDocument('یادداشت', 'absent');
  assert.equal(created.folderId, null);
  assert.equal(await service.moveDocument(created.id, 'absent'), null);
  assert.equal(await service.moveDocument('absent', null), null);
});

test('should_suffix_folder_names_when_taken_by_sibling', async () => {
  const { service } = setup();
  const first = await service.createFolder('کار');
  const second = await service.createFolder('کار');
  assert.notEqual(first.id, second.id);
  assert.equal(second.name, 'کار ۲');
  const other = await service.createFolder('کار', second.id);
  assert.equal(other.name, 'کار');
  assert.equal(other.parentId, second.id);
});

test('should_reject_slash_when_renaming_folder', async () => {
  const { service } = setup();
  const folder = await service.createFolder('کار');
  await assert.rejects(
    service.renameFolder(folder.id, 'a/b'),
    (error) => error?.code === 'FOLDER_INVALID_NAME',
  );
  await assert.rejects(
    service.renameFolder(folder.id, '   '),
    (error) => error?.code === 'FOLDER_INVALID_NAME',
  );
  assert.equal(await service.renameFolder('absent', 'x'), null);
});

test('should_reject_duplicate_sibling_when_renaming_folder', async () => {
  const { service } = setup();
  await service.createFolder('یک');
  const folder = await service.createFolder('دو');
  await assert.rejects(
    service.renameFolder(folder.id, 'یک'),
    (error) => error?.code === 'FOLDER_TITLE_DUPLICATE',
  );
});

test('should_cascade_when_folder_is_deleted', async () => {
  const published = [];
  const { service } = setup([], published);
  const root = await service.createFolder('ریشه');
  const sub = await service.createFolder('زیر', root.id);
  const inside = await service.createDocument('داخلی', sub.id);
  const outside = await service.createDocument('بیرونی');
  await service.deleteFolder(root.id);
  assert.equal(await service.openDocument(inside.id), null);
  assert.ok(await service.openDocument(outside.id), 'expected the outside document kept');
  assert.deepEqual(await service.listFolders(), []);
  assert.ok(published.some(({ type, data }) => type === 'documents:changed' && data.id === inside.id));
  assert.ok(published.some(({ type, data }) => type === 'folders:changed' && data.id === root.id));
});

test('should_publish_folder_event_when_created', async () => {
  const published = [];
  const { service } = setup([], published);
  const folder = await service.createFolder('کار');
  assert.ok(published.some(({ type, data }) => type === 'folders:changed' && data.id === folder.id));
});
