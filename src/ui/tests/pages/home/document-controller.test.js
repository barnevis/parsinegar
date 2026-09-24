// Verifies the document controller (pure logic over a fake service, no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocumentController, deriveImportTitle } from '../../../pages/home/document-controller.js';

function createService(initial = []) {
  const docs = new Map(initial.map((record) => [record.id, { ...record }]));
  let counter = docs.size;
  const service = {
    calls: [],
    async listDocuments() {
      return [...docs.values()].sort((left, right) => right.updatedAt - left.updatedAt);
    },
    async openDocument(id) {
      return docs.get(id) ?? null;
    },
    async saveDocument(input = {}) {
      const record = {
        id: input.id ?? `generated-${++counter}`,
        title: input.title ?? 't',
        content: input.content ?? '',
        updatedAt: Date.now(),
      };
      docs.set(record.id, record);
      service.calls.push(['save', record]);
      return record;
    },
    async createDocument(title) {
      return service.saveDocument({ title, content: '' });
    },
    async renameDocument(id, title) {
      const record = docs.get(id) ?? null;
      if (!record) {
        return null;
      }
      const renamed = { ...record, title, updatedAt: Date.now() };
      docs.set(id, renamed);
      return renamed;
    },
    async deleteDocument(id) {
      docs.delete(id);
      service.calls.push(['delete', id]);
    },
  };
  return service;
}

function createController(service, overrides = {}) {
  return createDocumentController({
    documents: service,
    t: (key) => key,
    format: null,
    isLive: () => true,
    readEditorContent: () => undefined,
    ...overrides,
  });
}

/**
 * Mirrors the page: unmounting parks content, then the record is adopted.
 * @param {object} controller Document controller.
 * @param {object|null} result Controller result.
 * @returns {object|null} Same result.
 */
function apply(controller, result) {
  if (result?.apply) {
    controller.adopt(result.apply, result.items);
  }
  return result;
}

test('should_open_most_recent_when_ensuring_initial', async () => {
  const controller = createController(createService([
    { id: 'old', title: 'قدیمی', content: 'متن قدیمی', updatedAt: 100 },
    { id: 'new', title: 'تازه', content: 'متن تازه', updatedAt: 300 },
  ]));
  const result = apply(controller, await controller.ensureInitial());
  assert.equal(result.apply.id, 'new');
  assert.deepEqual(controller.getState().currentId, 'new');
  assert.equal(controller.getDraft(), 'متن تازه');
});

test('should_create_welcome_when_store_is_empty', async () => {
  const controller = createController(createService());
  const result = apply(controller, await controller.ensureInitial());
  assert.ok(result.apply, 'expected a created record');
  assert.equal(result.items.length, 1);
  assert.equal(controller.getState().currentId, result.apply.id);
});

test('should_report_none_when_service_is_missing', async () => {
  const controller = createController(null);
  assert.deepEqual(await controller.ensureInitial(), { none: true });
  assert.equal(await controller.switchDocument('x'), null);
  assert.equal(await controller.createDocument(), null);
  assert.equal(controller.armDelete('x'), false);
  assert.equal(await controller.confirmDelete(), null);
  assert.equal(await controller.renameDocument('x', 'y'), 'ignored');
  assert.equal(await controller.showProperties('x'), null);
  assert.equal(await controller.prepareDownload('x'), null);
});

test('should_switch_working_set_when_switching', async () => {
  const controller = createController(createService([
    { id: 'first', title: 'اول', content: 'متن اول', updatedAt: 100 },
    { id: 'second', title: 'دوم', content: 'متن دوم', updatedAt: 300 },
  ]));
  apply(controller, await controller.ensureInitial());
  const result = apply(controller, await controller.switchDocument('first'));
  assert.equal(result.apply.id, 'first');
  assert.equal(controller.getState().docTitle, 'اول');
  assert.equal(await controller.switchDocument('first'), null);
  assert.equal(await controller.switchDocument('missing'), null);
  assert.equal(await controller.switchDocument(''), null);
});

test('should_open_created_record_when_creating', async () => {
  const controller = createController(createService([
    { id: 'd1', title: 't', content: 'c', updatedAt: 1 },
  ]));
  apply(controller, await controller.ensureInitial());
  const result = apply(controller, await controller.createDocument());
  assert.ok(result.apply.id !== 'd1');
  assert.equal(result.apply.content, '');
  assert.equal(controller.getState().currentId, result.apply.id);
});

test('should_arm_menu_target_when_deleting', () => {
  const controller = createController(createService([
    { id: 'd1', title: 'اول', content: 'c1', updatedAt: 100 },
    { id: 'd2', title: 'دوم', content: 'c2', updatedAt: 300 },
  ]));
  return controller.ensureInitial().then((result) => {
    apply(controller, result);
    assert.equal(controller.armDelete('d1'), true);
    assert.equal(controller.getState().confirmDeleteId, 'd1');
    assert.deepEqual(controller.getModal(), { kind: 'confirm', title: 'اول' });
    controller.cancelOverlays();
    assert.equal(controller.getModal(), null);
    assert.equal(controller.armDelete(), true);
    assert.equal(controller.getState().confirmDeleteId, 'd2');
  });
});

test('should_keep_current_when_deleting_background', async () => {
  const service = createService([
    { id: 'd1', title: 'اول', content: 'c1', updatedAt: 100 },
    { id: 'd2', title: 'دوم', content: 'c2', updatedAt: 300 },
  ]);
  const controller = createController(service);
  apply(controller, await controller.ensureInitial());
  controller.armDelete('d1');
  const result = apply(controller, await controller.confirmDelete());
  assert.deepEqual(result, { apply: null, items: result.items, removingCurrent: false });
  assert.deepEqual(service.calls.filter(([method]) => method === 'delete'), [['delete', 'd1']]);
  assert.equal(controller.getState().currentId, 'd2');
  assert.equal(controller.getDraft(), 'c2');
});

test('should_adopt_survivor_when_deleting_current', async () => {
  const service = createService([
    { id: 'd1', title: 'اول', content: 'c1', updatedAt: 100 },
    { id: 'd2', title: 'دوم', content: 'c2', updatedAt: 300 },
  ]);
  const controller = createController(service);
  apply(controller, await controller.ensureInitial());
  controller.armDelete('d2');
  const result = apply(controller, await controller.confirmDelete());
  assert.equal(result.apply.id, 'd1');
  assert.equal(result.removingCurrent, true);
  assert.equal(controller.getState().currentId, 'd1');
  assert.equal(controller.getDraft(), 'c1');
});

test('should_create_fresh_when_deleting_last', async () => {
  const controller = createController(createService([
    { id: 'only', title: 't', content: 'c', updatedAt: 1 },
  ]));
  apply(controller, await controller.ensureInitial());
  controller.armDelete('only');
  const result = apply(controller, await controller.confirmDelete());
  assert.ok(result.apply.id !== 'only');
  assert.equal(result.items.length, 1);
  assert.equal(controller.getState().currentId, result.apply.id);
});

test('should_report_rename_outcomes_when_renaming', async () => {
  const controller = createController(createService([
    { id: 'd1', title: 't', content: 'c', updatedAt: 1 },
  ]));
  apply(controller, await controller.ensureInitial());
  assert.equal(await controller.renameDocument('d1', '  '), 'empty');
  assert.equal(await controller.renameDocument('d1', 'تازه'), 'renamed');
  assert.equal(controller.getState().docTitle, 'تازه');
  assert.equal(await controller.renameDocument('missing', 'x'), 'failed');
  assert.equal(await controller.renameDocument(null, 'x'), 'ignored');
});

test('should_load_record_when_showing_properties', async () => {
  const controller = createController(createService([
    { id: 'd1', title: 't', content: 'hello', createdAt: 10, updatedAt: 20 },
  ]));
  apply(controller, await controller.ensureInitial());
  const record = await controller.showProperties('d1');
  assert.equal(record.id, 'd1');
  const modal = controller.getModal();
  assert.equal(modal.kind, 'properties');
  assert.equal(modal.title, 't');
  assert.ok(modal.sizeText.length > 0);
  assert.equal(await controller.showProperties('missing'), null);
  assert.equal(await controller.prepareDownload('d1'), record);
  assert.equal(await controller.prepareDownload('missing'), null);
});

test('should_derive_title_when_filename_is_given', () => {
  assert.equal(deriveImportTitle('notes.md'), 'notes');
  assert.equal(deriveImportTitle('راهنما.MARKDOWN'), 'راهنما');
  assert.equal(deriveImportTitle('  draft.txt  '), 'draft');
  assert.equal(deriveImportTitle('README'), 'README');
  assert.equal(deriveImportTitle('.md'), '');
  assert.equal(deriveImportTitle(''), '');
  assert.equal(deriveImportTitle(null), '');
  assert.equal(deriveImportTitle(42), '');
});

test('should_import_content_when_importing', async () => {
  const service = createService([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const controller = createController(service);
  apply(controller, await controller.ensureInitial());
  const result = apply(controller, await controller.importContent({ title: 'یادداشت', content: '# سلام\n' }));
  assert.ok(result.apply.id !== 'd1');
  assert.equal(result.apply.title, 'یادداشت');
  assert.equal(result.apply.content, '# سلام\n');
  assert.equal(result.items.length, 2);
  assert.equal(controller.getDraft(), '# سلام\n');
});

test('should_strip_bom_when_importing', async () => {
  const service = createService();
  const controller = createController(service);
  const result = await controller.importContent({ title: 't', content: '\uFEFFمتن' });
  assert.equal(result.apply.content, 'متن');
});

test('should_fall_back_to_new_title_when_import_title_is_empty', async () => {
  const service = createService();
  const controller = createController(service, { t: (key) => key });
  const result = await controller.importContent({ title: '   ', content: 'c' });
  const creates = service.calls.filter(([method]) => method === 'create');
  assert.deepEqual(creates, []);
  const saves = service.calls.filter(([method]) => method === 'save');
  assert.ok(saves.length >= 1);
  assert.equal(result.apply.title, 'parsinegar.documents.new-title');
});

test('should_report_none_when_importing_without_service', async () => {
  const controller = createController(null);
  assert.equal(await controller.importContent({ title: 't', content: 'c' }), null);
});

test('should_adopt_record_when_adopted', async () => {
  const controller = createController(createService());
  controller.adopt({ id: 'x', title: 't', content: 'c' }, [{ id: 'x' }]);
  assert.deepEqual(controller.getState().currentId, 'x');
  assert.equal(controller.getDraft(), 'c');
});

test('should_save_draft_when_timer_fires', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const service = createService([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
    let liveContent = 'متن تازه';
    const controller = createController(service, { readEditorContent: () => liveContent });
    apply(controller, await controller.ensureInitial());
    controller.setDraft('پیش‌نویس');
    controller.scheduleSave();
    t.mock.timers.tick(1500);
    await new Promise((resolve) => setImmediate(resolve));
    const saves = service.calls.filter(([method]) => method === 'save');
    assert.equal(saves.length, 1);
    assert.equal(saves[0][1].content, 'متن تازه');
    liveContent = undefined;
    controller.setDraft('پیش‌نویس تنها');
    controller.scheduleSave();
    t.mock.timers.tick(1500);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(service.calls.filter(([method]) => method === 'save').length, 2);
    controller.setDraft('پیش‌نویس رهاشده');
    controller.scheduleSave();
    controller.dispose();
    t.mock.timers.tick(5000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(service.calls.filter(([method]) => method === 'save').length, 2);
  } finally {
    t.mock.timers.reset();
  }
});

test('should_keep_working_set_when_reconnected', async () => {
  const controller = createController(createService([
    { id: 'd1', title: 't', content: 'c', updatedAt: 1 },
  ]));
  apply(controller, await controller.ensureInitial());
  controller.reconnect({ documents: createService() });
  assert.equal(controller.getState().currentId, 'd1');
});
