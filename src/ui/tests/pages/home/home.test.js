// Verifies the home page shell: placeholders, child mounting, flows.
//
// Children (menu bar, rail, side panel, status bar, modal dialog) mount
// through the shared mount helper after render; behavior is asserted through
// their public surface (shadow content, CustomEvents), never their internals.
import '../../setup-dom.js';
import '../../setup-styles.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { TAG } from '../../../pages/home/home.js';
import catalog from '../../../i18n/catalog.js';

function createEvents() {
  return {
    subscribe: () => () => {},
    publish: () => ({ success: true }),
  };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function nextFrame() {
  await new Promise((resolve) => globalThis.requestAnimationFrame(() => resolve()));
}

async function settled() {
  await flush();
  await nextFrame();
  await flush();
}

function translate(key, params) {
  const template = catalog.fa[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => params?.[name] ?? `{${name}}`);
}

const ASSET_BASE_URL = 'http://localhost/assets/';

function baseRefs(extra = {}) {
  return { t: translate, assetBaseUrl: ASSET_BASE_URL, events: createEvents(), ...extra };
}

function child(home, tag) {
  return home.shadowRoot.querySelector(tag);
}

function inChild(home, tag, selector) {
  return child(home, tag)?.shadowRoot?.querySelector(selector) ?? null;
}

function inChildAll(home, tag, selector) {
  return [...(child(home, tag)?.shadowRoot?.querySelectorAll(selector) ?? [])];
}

test('should_render_editor_without_brand_when_mounted', async () => {
  const element = document.createElement(TAG);
  element.connect({ infrastructure: { events: createEvents() }, refs: baseRefs() });
  document.body.append(element);
  await settled();
  try {
    assert.equal(inChild(element, 'parsi-menu-bar', '[part="brand"]'), null);
    assert.equal(element.shadowRoot.querySelector('[part="title"]'), null);
    assert.equal(element.shadowRoot.querySelector('[part="subtitle"]'), null);
    assert.ok(element.shadowRoot.querySelector('[part="editor-host"] .cm-editor'));
    assert.ok(element.value.includes('پارسی‌نگار'));
  } finally {
    element.remove();
  }
});

test('should_mount_region_children_when_events_are_forwarded', async () => {
  const element = document.createElement(TAG);
  element.connect({ infrastructure: { events: createEvents() }, refs: baseRefs() });
  document.body.append(element);
  await settled();
  try {
    assert.ok(child(element, 'parsi-menu-bar'), 'expected the menu bar');
    assert.ok(child(element, 'parsi-activity-rail'), 'expected the rail');
    assert.ok(child(element, 'parsi-side-panel'), 'expected the side panel');
    assert.ok(child(element, 'parsi-status-bar'), 'expected the status bar');
    assert.ok(element.shadowRoot.querySelector('[part="editor-host"] .cm-editor'));
  } finally {
    element.remove();
  }
});

test('should_focus_editor_when_card_is_clicked', async () => {
  const element = document.createElement(TAG);
  element.connect({ infrastructure: { events: createEvents() }, refs: baseRefs() });
  document.body.append(element);
  await settled();
  try {
    element.shadowRoot.querySelector('[part="editor-host"]').click();
    await settled();
    const inner = element.shadowRoot.activeElement;
    assert.ok(inner, 'expected focus inside the editor');
    assert.ok(element.shadowRoot.querySelector('.cm-editor').contains(inner));
  } finally {
    element.remove();
  }
});

test('should_keep_cell_focus_when_table_cell_is_clicked', async () => {
  // In-place table editing owns its focus: the page must not steal it to
  // the CodeMirror view on click, or rendered editing becomes impossible.
  const documents = createDocuments([
    { id: 't', title: 'جدول', content: 'متن\n\n| نام | سن |\n|:---|---:|\n| علی | ۳۰ |', updatedAt: 1 },
  ]);
  const element = await mountWithDocuments(documents);
  try {
    const cell = element.shadowRoot.querySelector('tbody td');
    assert.ok(cell, 'expected a rendered cell');
    cell.focus();
    await settled();
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    await settled();
    assert.equal(element.shadowRoot.activeElement, cell);
    assert.ok(element.shadowRoot.querySelector('.parsi-table'), 'expected the widget undisturbed');
  } finally {
    element.remove();
  }
});

test('should_emit_change_when_editor_content_changes', async () => {
  const element = document.createElement(TAG);
  element.connect({ infrastructure: { events: createEvents() }, refs: baseRefs() });
  document.body.append(element);
  await settled();
  try {
    const seen = [];
    element.addEventListener('parsi-page-home:changed', (event) => {
      seen.push(event.detail);
      assert.equal(event.bubbles, true);
      assert.equal(event.composed, true);
    });
    element.setDocument('متن تازه');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].value, 'متن تازه');
    assert.equal(element.value, 'متن تازه');
  } finally {
    element.remove();
  }
});

function createDocuments(initial = []) {
  const docs = new Map(initial.map((document) => [document.id, { ...document }]));
  const folders = new Map();
  let counter = docs.size;
  let folderCounter = 0;
  const service = {
    calls: [],
    async listDocuments() {
      return [...docs.values()].sort((left, right) => right.updatedAt - left.updatedAt);
    },
    async listFolders() {
      return [...folders.values()];
    },
    async openDocument(id) {
      return docs.get(id) ?? null;
    },
    async saveDocument(input = {}) {
      const record = {
        id: input.id ?? `generated-${++counter}`,
        title: input.title ?? 't',
        content: input.content ?? '',
        folderId: input.folderId ?? null,
        updatedAt: Date.now(),
      };
      docs.set(record.id, record);
      service.calls.push(['save', record]);
      return record;
    },
    async createDocument(title, folderId = null) {
      return service.saveDocument({ title, content: '', folderId });
    },
    async setReadOnly(id, readOnly) {
      const record = docs.get(id) ?? null;
      if (!record) {
        return null;
      }
      const updated = { ...record, readOnly: readOnly === true, updatedAt: Date.now() };
      docs.set(id, updated);
      service.calls.push(['lock', { id, readOnly: updated.readOnly }]);
      return updated;
    },
    async createFolder(name, parentId = null) {
      const folder = { id: `folder-${++folderCounter}`, name, parentId: parentId ?? null, createdAt: Date.now() };
      folders.set(folder.id, folder);
      return folder;
    },
    async renameFolder(id, name) {
      const folder = folders.get(id) ?? null;
      if (!folder) {
        return null;
      }
      const renamed = { ...folder, name };
      folders.set(id, renamed);
      return renamed;
    },
    async deleteFolder(id) {
      folders.delete(id);
      for (const [docId, record] of docs) {
        if ((record.folderId ?? null) === id) {
          docs.delete(docId);
        }
      }
    },
    async moveDocument(id, folderId = null) {
      const record = docs.get(id) ?? null;
      if (!record) {
        return null;
      }
      const updated = { ...record, folderId: folderId ?? null, updatedAt: Date.now() };
      docs.set(id, updated);
      return updated;
    },
    async renameDocument(id, title) {
      const record = docs.get(id) ?? null;
      if (!record) {
        return null;
      }
      const duplicate = [...docs.values()].some((item) => item.title === title && item.id !== id);
      if (duplicate) {
        throw Object.assign(new Error('taken'), { code: 'DOCUMENT_TITLE_DUPLICATE' });
      }
      const renamed = { ...record, title, updatedAt: Date.now() };
      docs.set(id, renamed);
      service.calls.push(['rename', { id, title }]);
      return renamed;
    },
    async deleteDocument(id) {
      docs.delete(id);
      service.calls.push(['delete', id]);
    },
  };
  return service;
}

async function mountWithDocuments(documents, extraServices = {}) {
  const element = document.createElement(TAG);
  element.connect({
    infrastructure: { events: createEvents() },
    refs: { t: translate, assetBaseUrl: ASSET_BASE_URL, events: createEvents(), services: { 'parsinegar.documents.service': documents, ...extraServices } },
  });
  document.body.append(element);
  await settled();
  return element;
}

async function deleteViaMenu(element, id) {
  inChild(element, 'parsi-side-panel', `[data-doc-menu="${id}"]`).click();
  await settled();
  inChild(element, 'parsi-side-panel', `[data-file-delete="${id}"]`).click();
  await settled();
}

test('should_open_most_recent_when_mounted_with_documents', async () => {
  const documents = createDocuments([
    { id: 'old', title: 'قدیمی', content: 'متن قدیمی', updatedAt: 100 },
    { id: 'new', title: 'تازه', content: 'متن تازه', updatedAt: 300 },
  ]);
  const element = await mountWithDocuments(documents);
  try {
    assert.equal(element.value, 'متن تازه');
    const buttons = inChildAll(element, 'parsi-side-panel', '[data-doc-id]');
    assert.deepEqual(buttons.map((button) => button.getAttribute('data-doc-id')), ['new', 'old']);
  } finally {
    element.remove();
  }
});

test('should_create_welcome_when_mounted_empty', async () => {
  const documents = createDocuments();
  const element = await mountWithDocuments(documents);
  try {
    const saves = documents.calls.filter(([method]) => method === 'save');
    assert.equal(saves.length, 1);
    assert.ok(element.value.includes('پارسی‌نگار'));
  } finally {
    element.remove();
  }
});

test('should_switch_document_when_list_item_is_clicked', async () => {
  const documents = createDocuments([
    { id: 'first', title: 'اول', content: 'متن اول', updatedAt: 100 },
    { id: 'second', title: 'دوم', content: 'متن دوم', updatedAt: 300 },
  ]);
  const element = await mountWithDocuments(documents);
  try {
    assert.equal(element.value, 'متن دوم');
    inChild(element, 'parsi-side-panel', '[data-doc-id="first"]').click();
    await settled();
    assert.equal(element.value, 'متن اول');
  } finally {
    element.remove();
  }
});

test('should_autosave_content_when_edited', async (t) => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    element.setDocument('متن تازه');
    t.mock.timers.tick(1500);
    await new Promise((resolve) => setImmediate(resolve));
    const saves = documents.calls.filter(([method]) => method === 'save');
    assert.ok(saves.length >= 1, 'expected an autosave');
    const last = saves[saves.length - 1][1];
    assert.equal(last.id, 'd1');
    assert.equal(last.title, 't');
    assert.equal(last.content, 'متن تازه');
  } finally {
    t.mock.timers.reset();
    element.remove();
  }
});

test('should_render_no_title_input_when_mounted', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    assert.equal(element.shadowRoot.querySelector('[part="doc-title"]'), null);
  } finally {
    element.remove();
  }
});

test('should_drop_pending_save_when_disconnected', async (t) => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    element.setDocument('متن تازه');
    element.remove();
    t.mock.timers.tick(5000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(documents.calls, []);
  } finally {
    t.mock.timers.reset();
  }
});

test('should_reject_second_connect_when_already_connected', async () => {
  const element = document.createElement(TAG);
  element.connect({ infrastructure: { events: createEvents() }, refs: baseRefs() });
  document.body.append(element);
  await settled();
  try {
    assert.throws(() => {
      element.connect({ infrastructure: { events: createEvents() }, refs: baseRefs() });
    });
  } finally {
    element.remove();
  }
});

test('should_mount_editor_when_events_facade_is_absent', async () => {
  const element = document.createElement(TAG);
  element.connect({
    infrastructure: { events: createEvents() },
    refs: { t: translate, assetBaseUrl: ASSET_BASE_URL },
  });
  document.body.append(element);
  await settled();
  try {
    assert.ok(element.shadowRoot.querySelector('[part="editor-host"] .cm-editor'));
    assert.equal(child(element, 'parsi-menu-bar'), null);
    assert.equal(child(element, 'parsi-activity-rail'), null);
    assert.equal(child(element, 'parsi-side-panel'), null);
    assert.equal(child(element, 'parsi-status-bar'), null);
  } finally {
    element.remove();
  }
});

test('should_ignore_malformed_events_facade_when_connecting', async () => {
  const element = document.createElement(TAG);
  element.connect({
    infrastructure: { events: createEvents() },
    refs: { t: translate, assetBaseUrl: ASSET_BASE_URL, events: { subscribe: 'nope' } },
  });
  document.body.append(element);
  await settled();
  try {
    assert.ok(element.shadowRoot.querySelector('[part="editor-host"] .cm-editor'));
    assert.equal(child(element, 'parsi-menu-bar'), null);
  } finally {
    element.remove();
  }
});

test('should_create_document_when_new_is_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    inChild(element, 'parsi-side-panel', '[part="docs-new"]').click();
    await settled();
    assert.equal(element.value, '');
    assert.equal(inChildAll(element, 'parsi-side-panel', '[data-doc-id]').length, 2);
  } finally {
    element.remove();
  }
});

test('should_ask_confirmation_with_name_when_delete_is_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 'سند مهم', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    await deleteViaMenu(element, 'd1');
    const dialog = inChild(element, 'parsi-modal-dialog', '[part="modal-dialog"]');
    assert.ok(dialog, 'expected the confirmation modal');
    assert.equal(dialog.getAttribute('role'), 'alertdialog');
    assert.ok(dialog.textContent.includes('سند مهم'), 'expected the doc name');
    assert.deepEqual(documents.calls.filter(([method]) => method === 'delete'), []);
  } finally {
    element.remove();
  }
});

test('should_delete_current_when_confirmation_is_accepted', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    await deleteViaMenu(element, 'd1');
    inChild(element, 'parsi-modal-dialog', '[data-confirm-delete="yes"]').click();
    await settled();
    const deletes = documents.calls.filter(([method]) => method === 'delete');
    assert.deepEqual(deletes, [['delete', 'd1']]);
  } finally {
    element.remove();
  }
});

test('should_delete_menu_target_when_it_is_not_current', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'اول', content: 'متن اول', updatedAt: 100 },
    { id: 'd2', title: 'دوم', content: 'متن دوم', updatedAt: 300 },
  ]);
  const element = await mountWithDocuments(documents);
  try {
    assert.equal(element.value, 'متن دوم');
    await deleteViaMenu(element, 'd1');
    const dialog = inChild(element, 'parsi-modal-dialog', '[part="modal-dialog"]');
    assert.ok(dialog, 'expected the confirmation modal');
    assert.ok(dialog.textContent.includes('اول'), 'expected the menu target name');
    assert.ok(!dialog.textContent.includes('دوم'), 'expected no current-doc name');
    inChild(element, 'parsi-modal-dialog', '[data-confirm-delete="yes"]').click();
    await settled();
    const deletes = documents.calls.filter(([method]) => method === 'delete');
    assert.deepEqual(deletes, [['delete', 'd1']]);
    assert.equal(element.value, 'متن دوم', 'expected the open document untouched');
    assert.equal(inChildAll(element, 'parsi-side-panel', '[data-doc-id]').length, 1);
  } finally {
    element.remove();
  }
});

test('should_keep_sort_mode_when_document_opens', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 300 },
    { id: 'd2', title: 'اول', content: 'c2', updatedAt: 100 },
  ]);
  const element = await mountWithDocuments(documents);
  try {
    const order = () => inChildAll(element, 'parsi-side-panel', '[data-doc-id]')
      .map((button) => button.getAttribute('data-doc-id'));
    assert.deepEqual(order(), ['d1', 'd2']);
    inChild(element, 'parsi-side-panel', '[data-doc-sort]').click();
    await settled();
    inChild(element, 'parsi-side-panel', '[data-files-sort="name"]').click();
    await settled();
    assert.deepEqual(order(), ['d2', 'd1']);
    inChild(element, 'parsi-side-panel', '[data-doc-id="d1"]').click();
    await settled();
    assert.equal(element.value, 'c1');
    assert.deepEqual(order(), ['d2', 'd1'], 'expected the sort kept across open');
  } finally {
    element.remove();
  }
});

test('should_import_picked_file_when_document_import_arrives', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    child(element, 'parsi-side-panel').dispatchEvent(new CustomEvent('document-import', { bubbles: true }));
    await settled();
    const picker = element.shadowRoot.querySelector('input[type="file"]');
    assert.ok(picker, 'expected the file picker');
    assert.equal(picker.getAttribute('accept'), '.md,.markdown,.mdown,.txt');
    const file = new File(['# وارد\n'], 'notes.md', { type: 'text/markdown' });
    Object.defineProperty(picker, 'files', { value: [file], configurable: true });
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await settled();
    await settled();
    assert.equal(element.value, '# وارد\n');
    assert.equal(element.shadowRoot.querySelector('input[type="file"]'), null, 'expected the picker removed');
    const saves = documents.calls.filter(([method]) => method === 'save');
    assert.ok(saves.some(([, record]) => record.title === 'notes' && record.content === '# وارد\n'));
  } finally {
    element.remove();
  }
});

test('should_ignore_empty_pick_when_document_import_arrives', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    child(element, 'parsi-side-panel').dispatchEvent(new CustomEvent('document-import', { bubbles: true }));
    await settled();
    const picker = element.shadowRoot.querySelector('input[type="file"]');
    assert.ok(picker, 'expected the file picker');
    Object.defineProperty(picker, 'files', { value: [], configurable: true });
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await settled();
    assert.equal(element.value, 'c');
    assert.deepEqual(documents.calls.filter(([method]) => method === 'save'), []);
    assert.equal(element.shadowRoot.querySelector('input[type="file"]'), null, 'expected the picker removed');
  } finally {
    element.remove();
  }
});

test('should_open_about_doc_when_menu_action_arrives', async () => {
  const restore = stubBuiltinFetch({ './docs/ABOUT.md': '# درباره پارسی‌نگار\n\nمتن درباره' });
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'متن', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    await openHelpMenu(element);
    inChild(element, 'parsi-menu-bar', '[data-action="about"]').click();
    await settled();
    assert.ok(element.value.includes('درباره پارسی‌نگار'));
    assert.ok(inChild(element, 'parsi-status-bar', '[part="lock-chip"]'), 'expected the read-only chip');
  } finally {
    restore();
    element.remove();
  }
});

test('should_open_about_doc_when_rail_logo_is_clicked', async () => {
  const restore = stubBuiltinFetch({ './docs/ABOUT.md': '# درباره پارسی‌نگار' });
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'متن', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    inChild(element, 'parsi-activity-rail', '[data-about]').click();
    await settled();
    assert.ok(element.value.includes('درباره پارسی‌نگار'));
    assert.ok(inChild(element, 'parsi-status-bar', '[part="lock-chip"]'));
  } finally {
    restore();
    element.remove();
  }
});

function stubBuiltinFetch(texts = {}) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true,
    text: async () => texts[url] ?? `# mock for ${url}`,
  });
  return () => {
    globalThis.fetch = realFetch;
  };
}

async function openFileMenu(element) {
  inChild(element, 'parsi-menu-bar', '[data-menu="file"]').click();
  await settled();
}

async function openHelpMenu(element) {
  inChild(element, 'parsi-menu-bar', '[data-menu="help"]').click();
  await settled();
}

async function openViewMenu(element) {
  inChild(element, 'parsi-menu-bar', '[data-menu="view"]').click();
  await settled();
}

test('should_open_help_doc_when_menu_action_arrives', async () => {
  const restore = stubBuiltinFetch({ './docs/userGuide.md': '# راهنمای پارسی‌نگار' });
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'متن', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    await openHelpMenu(element);
    inChild(element, 'parsi-menu-bar', '[data-action="open-help"]').click();
    await settled();
    assert.ok(element.value.includes('راهنمای پارسی‌نگار'));
  } finally {
    restore();
    element.remove();
  }
});

test('should_return_to_document_when_back_is_clicked', async () => {
  const restore = stubBuiltinFetch({ './docs/ABOUT.md': '# درباره پارسی‌نگار' });
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'متن', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    await openHelpMenu(element);
    inChild(element, 'parsi-menu-bar', '[data-action="about"]').click();
    await settled();
    assert.ok(element.value.includes('درباره پارسی‌نگار'));
    await openHelpMenu(element);
    assert.ok(inChild(element, 'parsi-menu-bar', '[data-action="back-to-documents"]'), 'expected the back item');
    inChild(element, 'parsi-menu-bar', '[data-action="back-to-documents"]').click();
    await settled();
    assert.equal(element.value, 'متن');
    assert.equal(inChild(element, 'parsi-status-bar', '[part="lock-chip"]'), null);
  } finally {
    restore();
    element.remove();
  }
});

test('should_return_to_document_when_document_opens_from_builtin', async () => {
  const restore = stubBuiltinFetch({ './docs/ABOUT.md': '# درباره پارسی‌نگار' });
  const documents = createDocuments([
    { id: 'd1', title: 'اول', content: 'c1', updatedAt: 100 },
    { id: 'd2', title: 'دوم', content: 'c2', updatedAt: 300 },
  ]);
  const element = await mountWithDocuments(documents);
  try {
    await openHelpMenu(element);
    inChild(element, 'parsi-menu-bar', '[data-action="about"]').click();
    await settled();
    assert.ok(element.value.includes('درباره پارسی‌نگار'));
    inChild(element, 'parsi-side-panel', '[data-doc-id="d1"]').click();
    await settled();
    assert.equal(element.value, 'c1');
    assert.equal(inChild(element, 'parsi-status-bar', '[part="lock-chip"]'), null);
  } finally {
    restore();
    element.remove();
  }
});

test('should_keep_draft_clean_when_builtin_is_open', async () => {
  const restore = stubBuiltinFetch({ './docs/userGuide.md': '# راهنمای پارسی‌نگار' });
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'متن', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    await openHelpMenu(element);
    inChild(element, 'parsi-menu-bar', '[data-action="open-help"]').click();
    await settled();
    assert.ok(element.value.includes('راهنمای پارسی‌نگار'));
    // Loading the built-in must not park its content into the user draft:
    // switching back still shows the user text, and no save carried it.
    await openHelpMenu(element);
    inChild(element, 'parsi-menu-bar', '[data-action="back-to-documents"]').click();
    await settled();
    assert.equal(element.value, 'متن');
    const saves = documents.calls.filter(([method]) => method === 'save');
    assert.ok(saves.every(([, record]) => !String(record.content).includes('راهنما')), 'expected no builtin save');
  } finally {
    restore();
    element.remove();
  }
});

test('should_lock_and_unlock_when_toggle_is_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'متن', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    assert.equal(inChild(element, 'parsi-status-bar', '[part="lock-chip"]'), null);
    await openFileMenu(element);
    assert.ok(inChild(element, 'parsi-menu-bar', '[data-action="toggle-lock"]').textContent.includes('حالت خواندن'));
    inChild(element, 'parsi-menu-bar', '[data-action="toggle-lock"]').click();
    await settled();
    assert.ok(inChild(element, 'parsi-status-bar', '[part="lock-chip"]'), 'expected the chip while locked');
    await openFileMenu(element);
    assert.ok(inChild(element, 'parsi-menu-bar', '[data-action="toggle-lock"]').textContent.includes('حالت نوشتن'));
    inChild(element, 'parsi-menu-bar', '[data-action="toggle-lock"]').click();
    await settled();
    assert.equal(inChild(element, 'parsi-status-bar', '[part="lock-chip"]'), null);
    assert.deepEqual(documents.calls.filter(([method]) => method === 'lock'), [
      ['lock', { id: 'd1', readOnly: true }],
      ['lock', { id: 'd1', readOnly: false }],
    ]);
  } finally {
    element.remove();
  }
});

test('should_keep_lock_when_document_is_reopened', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'اول', content: 'c1', updatedAt: 100 },
    { id: 'd2', title: 'دوم', content: 'c2', updatedAt: 300 },
  ]);
  const element = await mountWithDocuments(documents);
  try {
    inChild(element, 'parsi-side-panel', '[data-doc-id="d1"]').click();
    await settled();
    await openFileMenu(element);
    inChild(element, 'parsi-menu-bar', '[data-action="toggle-lock"]').click();
    await settled();
    assert.ok(inChild(element, 'parsi-status-bar', '[part="lock-chip"]'));
    inChild(element, 'parsi-side-panel', '[data-doc-id="d2"]').click();
    await settled();
    assert.equal(inChild(element, 'parsi-status-bar', '[part="lock-chip"]'), null);
    inChild(element, 'parsi-side-panel', '[data-doc-id="d1"]').click();
    await settled();
    assert.equal(element.value, 'c1');
    assert.ok(inChild(element, 'parsi-status-bar', '[part="lock-chip"]'), 'expected the stored lock reapplied');
  } finally {
    element.remove();
  }
});

test('should_lock_and_unlock_when_mode_items_are_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'متن', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    await openViewMenu(element);
    // Unlocked: read-mode switches, write-mode is the active (disabled) one.
    inChild(element, 'parsi-menu-bar', '[data-action="read-mode"]').click();
    await settled();
    assert.ok(inChild(element, 'parsi-status-bar', '[part="lock-chip"]'), 'expected read-mode to lock');
    await openViewMenu(element);
    inChild(element, 'parsi-menu-bar', '[data-action="write-mode"]').click();
    await settled();
    assert.equal(inChild(element, 'parsi-status-bar', '[part="lock-chip"]'), null);
    assert.deepEqual(documents.calls.filter(([method]) => method === 'lock'), [
      ['lock', { id: 'd1', readOnly: true }],
      ['lock', { id: 'd1', readOnly: false }],
    ]);
  } finally {
    element.remove();
  }
});

test('should_toggle_lock_when_mode_toggle_is_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'متن', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    const toggle = () => inChild(element, 'parsi-menu-bar', '[data-mode-toggle]');
    assert.ok(toggle().innerHTML.includes('#edit'));
    toggle().click();
    await settled();
    assert.ok(inChild(element, 'parsi-status-bar', '[part="lock-chip"]'), 'expected the toggle to lock');
    assert.ok(toggle().innerHTML.includes('#visibility'));
    toggle().click();
    await settled();
    assert.equal(inChild(element, 'parsi-status-bar', '[part="lock-chip"]'), null);
  } finally {
    element.remove();
  }
});

test('should_keep_document_when_confirmation_is_cancelled', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    await deleteViaMenu(element, 'd1');
    inChild(element, 'parsi-modal-dialog', '[data-confirm-delete="no"]').click();
    await settled();
    assert.deepEqual(documents.calls.filter(([method]) => method === 'delete'), []);
    assert.equal(inChild(element, 'parsi-modal-dialog', '[part="modal-dialog"]'), null);
  } finally {
    element.remove();
  }
});

test('should_cancel_confirmation_when_backdrop_is_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    await deleteViaMenu(element, 'd1');
    assert.ok(inChild(element, 'parsi-modal-dialog', '[part="modal-dialog"]'));
    inChild(element, 'parsi-modal-dialog', '[part="modal-backdrop"]').click();
    await settled();
    assert.deepEqual(documents.calls.filter(([method]) => method === 'delete'), []);
    assert.equal(inChild(element, 'parsi-modal-dialog', '[part="modal-dialog"]'), null);
  } finally {
    element.remove();
  }
});

test('should_cancel_confirmation_when_escape_is_pressed', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    await deleteViaMenu(element, 'd1');
    assert.ok(inChild(element, 'parsi-modal-dialog', '[part="modal-dialog"]'));
    element.shadowRoot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settled();
    assert.deepEqual(documents.calls.filter(([method]) => method === 'delete'), []);
    assert.equal(inChild(element, 'parsi-modal-dialog', '[part="modal-dialog"]'), null);
  } finally {
    element.remove();
  }
});

test('should_render_rail_with_views_when_mounted', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: '# الف', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    const rail = inChildAll(element, 'parsi-activity-rail', '[data-view]');
    assert.deepEqual(rail.map((button) => button.getAttribute('data-view')), ['files', 'outline', 'mindmap', 'sync', 'settings']);
    assert.equal(inChild(element, 'parsi-activity-rail', '[data-view="files"]').getAttribute('aria-pressed'), 'true');
    assert.ok(child(element, 'parsi-side-panel'), 'expected the side panel');
  } finally {
    element.remove();
  }
});

test('should_switch_side_view_when_rail_is_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: '# الف\nمتن\n## ب', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    inChild(element, 'parsi-activity-rail', '[data-view="outline"]').click();
    await settled();
    const jumps = inChildAll(element, 'parsi-side-panel', '[data-line]');
    assert.deepEqual(jumps.map((button) => button.getAttribute('data-line')), ['1', '3']);
    assert.equal(inChild(element, 'parsi-activity-rail', '[data-view="outline"]').getAttribute('aria-pressed'), 'true');
  } finally {
    element.remove();
  }
});

test('should_toggle_side_when_active_rail_icon_is_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    assert.ok(child(element, 'parsi-side-panel'));
    inChild(element, 'parsi-activity-rail', '[data-view="files"]').click();
    await settled();
    assert.equal(child(element, 'parsi-side-panel'), null);
  } finally {
    element.remove();
  }
});

test('should_collapse_grid_when_side_is_closed', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    const workbench = element.shadowRoot.querySelector('[part="workbench"]');
    assert.equal(workbench?.getAttribute('data-side'), 'open');
    inChild(element, 'parsi-activity-rail', '[data-view="files"]').click();
    await settled();
    assert.equal(element.shadowRoot.querySelector('[part="workbench"]')?.getAttribute('data-side'), 'closed');
    const style = element.shadowRoot.querySelector('style[data-pey-stylesheet]');
    assert.ok(style?.textContent.includes('[part="workbench"][data-side="closed"]'));
  } finally {
    element.remove();
  }
});

test('should_jump_to_line_when_outline_item_is_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: '# الف\nمتن\n## ب', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    inChild(element, 'parsi-activity-rail', '[data-view="outline"]').click();
    await settled();
    inChild(element, 'parsi-side-panel', '[data-line="3"]').click();
    await settled();
    // jsdom cannot observe selections inside Shadow DOM; focus proves the
    // handler reached gotoLine, cursor placement is verified in Chromium.
    const inner = element.shadowRoot.activeElement;
    assert.ok(inner, 'expected focus inside the editor');
    assert.ok(element.shadowRoot.querySelector('.cm-editor').contains(inner));
  } finally {
    element.remove();
  }
});

test('should_render_menubar_when_mounted', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    const buttons = inChildAll(element, 'parsi-menu-bar', '[data-menu]');
    assert.deepEqual(buttons.map((button) => button.getAttribute('data-menu')), ['file', 'edit', 'insert', 'view', 'help']);
    assert.ok(inChild(element, 'parsi-menu-bar', '[part="menu-dropdown"][hidden]'), 'expected hidden dropdowns');
  } finally {
    element.remove();
  }
});

test('should_toggle_dropdown_when_menu_button_is_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    inChild(element, 'parsi-menu-bar', '[data-menu="file"]').click();
    await settled();
    assert.equal(inChild(element, 'parsi-menu-bar', '[data-menu="file"]').getAttribute('aria-expanded'), 'true');
    assert.equal(inChildAll(element, 'parsi-menu-bar', '[part="menu-dropdown"]:not([hidden])').length, 1);
    inChild(element, 'parsi-menu-bar', '[data-menu="file"]').click();
    await settled();
    assert.equal(inChild(element, 'parsi-menu-bar', '[data-menu="file"]').getAttribute('aria-expanded'), 'false');
  } finally {
    element.remove();
  }
});

test('should_hide_dropdown_with_styles_when_closed', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    await settled();
    const style = inChild(element, 'parsi-menu-bar', 'style');
    assert.ok(style?.textContent.includes('[part="menu-dropdown"][hidden]'));
  } finally {
    element.remove();
  }
});

test('should_stick_panels_with_styles_when_rendered', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    await settled();
    const style = element.shadowRoot.querySelector('style[data-pey-stylesheet]');
    assert.ok(style, 'expected the attached kit stylesheet');
    for (const part of ['workbench', 'center']) {
      assert.ok(style.textContent.includes(`[part="${part}"]`), `expected styles for ${part}`);
    }
    // Only the menubar (top) and status bar (bottom) stick; rail and side
    // slots stay static so rows join flush without a height-coupled offset.
    assert.equal((style.textContent.match(/position: sticky/g) ?? []).length, 2);
    assert.ok(style.textContent.includes('gap: 0'), 'expected flush panels without gaps');
  } finally {
    element.remove();
  }
});

test('should_fill_viewport_with_styles_when_rendered', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    await settled();
    const style = element.shadowRoot.querySelector('style[data-pey-stylesheet]');
    assert.ok(style, 'expected the attached kit stylesheet');
    assert.ok(style.textContent.includes('100dvh'), 'expected full viewport height');
    assert.ok(style.textContent.includes('minmax(0, 1fr)'), 'expected flexible middle row');
  } finally {
    element.remove();
  }
});

test('should_use_icon_rail_with_styles_when_rendered', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    await settled();
    const style = inChild(element, 'parsi-activity-rail', 'style');
    assert.ok(style?.textContent.includes('inline-size: 20px'), 'expected 20px rail icons');
    assert.ok(style?.textContent.includes('#5eead4'), 'expected accent color');
  } finally {
    element.remove();
  }
});

test('should_size_panels_with_styles_when_rendered', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    await settled();
    const style = inChild(element, 'parsi-side-panel', 'style');
    assert.ok(style?.textContent.includes('font-size: 14px'), 'expected 14px side titles');
    assert.ok(element.shadowRoot.querySelector('style[data-pey-stylesheet]')?.textContent.includes('max-inline-size: 800px'), 'expected 800px writing area');
  } finally {
    element.remove();
  }
});

test('should_close_menu_when_escape_is_pressed', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    inChild(element, 'parsi-menu-bar', '[data-menu="edit"]').click();
    await settled();
    assert.equal(inChildAll(element, 'parsi-menu-bar', '[part="menu-dropdown"]:not([hidden])').length, 1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settled();
    assert.equal(inChildAll(element, 'parsi-menu-bar', '[part="menu-dropdown"]:not([hidden])').length, 0);
  } finally {
    element.remove();
  }
});

test('should_create_document_when_menu_action_is_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    inChild(element, 'parsi-menu-bar', '[data-menu="file"]').click();
    await settled();
    inChild(element, 'parsi-menu-bar', '[data-action="new-document"]').click();
    await settled();
    assert.equal(inChildAll(element, 'parsi-side-panel', '[data-doc-id]').length, 2);
  } finally {
    element.remove();
  }
});

test('should_ask_confirmation_when_menu_delete_is_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 'سند مهم', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    inChild(element, 'parsi-menu-bar', '[data-menu="file"]').click();
    await settled();
    inChild(element, 'parsi-menu-bar', '[data-action="delete-document"]').click();
    await settled();
    const confirm = inChild(element, 'parsi-modal-dialog', '[part="modal-dialog"]');
    assert.ok(confirm, 'expected the confirmation modal');
    assert.ok(confirm.textContent.includes('سند مهم'), 'expected the doc name');
    assert.deepEqual(documents.calls.filter(([method]) => method === 'delete'), []);
  } finally {
    element.remove();
  }
});

test('should_undo_edit_when_menu_action_is_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'متن اول', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    element.setDocument('متن تازه');
    assert.equal(element.value, 'متن تازه');
    inChild(element, 'parsi-menu-bar', '[data-menu="edit"]').click();
    await settled();
    inChild(element, 'parsi-menu-bar', '[data-action="undo"]').click();
    await settled();
    assert.equal(element.value, 'متن اول');
  } finally {
    element.remove();
  }
});

test('should_toggle_panels_when_view_actions_are_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    assert.ok(child(element, 'parsi-status-bar'));
    inChild(element, 'parsi-menu-bar', '[data-menu="view"]').click();
    await settled();
    inChild(element, 'parsi-menu-bar', '[data-action="toggle-status"]').click();
    await settled();
    assert.equal(child(element, 'parsi-status-bar'), null);
    inChild(element, 'parsi-menu-bar', '[data-menu="view"]').click();
    await settled();
    inChild(element, 'parsi-menu-bar', '[data-action="toggle-side"]').click();
    await settled();
    assert.equal(child(element, 'parsi-side-panel'), null);
  } finally {
    element.remove();
  }
});

test('should_show_live_stats_when_mounted', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'یک دو\nسه', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    const value = (part) => inChild(element, 'parsi-status-bar', `[data-stat="${part}"]`)?.textContent;
    assert.equal(value('words'), '3');
    assert.equal(value('lines'), '2');
    element.setDocument('یک');
    await settled();
    assert.equal(value('words'), '1');
    assert.equal(value('lines'), '1');
  } finally {
    element.remove();
  }
});

test('should_update_outline_live_when_headings_are_typed', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'متن', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    inChild(element, 'parsi-activity-rail', '[data-view="outline"]').click();
    await settled();
    assert.equal(inChild(element, 'parsi-side-panel', '[part="outline-empty"]') !== null, true);
    element.setDocument('# الف\nمتن');
    await settled();
    assert.ok(inChild(element, 'parsi-side-panel', '[data-line="1"]'), 'expected the new heading without switching views');
  } finally {
    element.remove();
  }
});

test('should_update_outline_targets_when_lines_shift_while_typing', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: '# الف', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    inChild(element, 'parsi-activity-rail', '[data-view="outline"]').click();
    await settled();
    element.setDocument('مقدمه\n# الف');
    await settled();
    const jump = inChild(element, 'parsi-side-panel', '[data-line="2"]');
    assert.ok(jump, 'expected the shifted line number');
  } finally {
    element.remove();
  }
});

function createSettings(initial = { theme: 'device', direction: 'auto', fontSize: 16 }) {
  let current = { ...initial };
  const service = {
    calls: [],
    async getSettings() {
      return { ...current };
    },
    async saveSettings(patch = {}) {
      current = { ...current, ...patch };
      service.calls.push({ ...patch });
      return { ...current };
    },
  };
  return service;
}

async function mountWithSettings(documents, settings) {
  const element = document.createElement(TAG);
  element.connect({
    infrastructure: { events: createEvents() },
    refs: {
      t: translate,
      assetBaseUrl: ASSET_BASE_URL,
      events: createEvents(),
      services: {
        'parsinegar.documents.service': documents,
        'parsinegar.settings.service': settings,
      },
    },
  });
  document.body.append(element);
  await settled();
  return element;
}

test('should_align_english_right_when_stored_direction_is_rtl', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'Hello world', updatedAt: 1 }]);
  const settings = createSettings({ theme: 'device', direction: 'rtl', fontSize: 16 });
  const element = await mountWithSettings(documents, settings);
  try {
    const line = element.shadowRoot.querySelector('.cm-line');
    // jsdom does not compute bidi; the class is authoritative (the theme
    // mapping is covered by rule assertions in markdown-view.test.js).
    assert.ok(line.classList.contains('parsi-base-rtl'), 'expected the English line locked right');
    assert.ok(!line.classList.contains('parsi-dir-ltr'), 'expected no per-line ltr');
  } finally {
    element.remove();
  }
});

test('should_detect_per_line_when_stored_direction_is_auto', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'Hello world', updatedAt: 1 }]);
  const settings = createSettings({ theme: 'device', direction: 'auto', fontSize: 16 });
  const element = await mountWithSettings(documents, settings);
  try {
    const line = element.shadowRoot.querySelector('.cm-line');
    assert.ok(line.classList.contains('parsi-dir-ltr'), 'expected per-line detection in auto');
  } finally {
    element.remove();
  }
});

test('should_apply_stored_direction_and_font_size_when_mounted', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'متن', updatedAt: 1 }]);
  const settings = createSettings({ theme: 'device', direction: 'ltr', fontSize: 20 });
  const element = await mountWithSettings(documents, settings);
  try {
    assert.equal(element.shadowRoot.querySelector('.cm-editor')?.getAttribute('dir'), 'ltr');
    inChild(element, 'parsi-activity-rail', '[data-view="settings"]').click();
    await settled();
    assert.equal(inChild(element, 'parsi-side-panel', '[part="settings-value"]')?.textContent, '20');
  } finally {
    element.remove();
  }
});

test('should_persist_direction_when_settings_change_arrives', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'متن', updatedAt: 1 }]);
  const settings = createSettings({ theme: 'device', direction: 'rtl', fontSize: 16 });
  const element = await mountWithSettings(documents, settings);
  try {
    child(element, 'parsi-side-panel').dispatchEvent(
      new CustomEvent('settings-change', { bubbles: true, detail: { key: 'direction', value: 'ltr' } }),
    );
    await settled();
    await settled();
    assert.deepEqual(settings.calls, [{ direction: 'ltr' }]);
    assert.equal(element.shadowRoot.querySelector('.cm-editor')?.getAttribute('dir'), 'ltr');
  } finally {
    element.remove();
  }
});

test('should_step_font_size_when_settings_step_arrives', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'متن', updatedAt: 1 }]);
  const settings = createSettings({ theme: 'device', direction: 'rtl', fontSize: 16 });
  const element = await mountWithSettings(documents, settings);
  try {
    child(element, 'parsi-side-panel').dispatchEvent(
      new CustomEvent('settings-step', { bubbles: true, detail: { key: 'fontSize', delta: 1 } }),
    );
    await settled();
    await settled();
    assert.deepEqual(settings.calls, [{ fontSize: 17 }]);
  } finally {
    element.remove();
  }
});

test('should_ignore_unknown_setting_keys_when_event_arrives', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'متن', updatedAt: 1 }]);
  const settings = createSettings();
  const element = await mountWithSettings(documents, settings);
  try {
    child(element, 'parsi-side-panel').dispatchEvent(
      new CustomEvent('settings-change', { bubbles: true, detail: { key: 'nope', value: 'x' } }),
    );
    child(element, 'parsi-side-panel').dispatchEvent(
      new CustomEvent('settings-step', { bubbles: true, detail: { key: 'fontSize', delta: 5 } }),
    );
    await settled();
    await settled();
    assert.deepEqual(settings.calls, []);
  } finally {
    element.remove();
  }
});

test('should_apply_rapid_changes_in_order_when_events_arrive_together', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'متن', updatedAt: 1 }]);
  const settings = createSettings({ theme: 'device', direction: 'rtl', fontSize: 16 });
  const element = await mountWithSettings(documents, settings);
  try {
    const side = child(element, 'parsi-side-panel');
    side.dispatchEvent(
      new CustomEvent('settings-step', { bubbles: true, detail: { key: 'fontSize', delta: 1 } }),
    );
    side.dispatchEvent(
      new CustomEvent('settings-step', { bubbles: true, detail: { key: 'fontSize', delta: 1 } }),
    );
    await settled();
    await settled();
    await settled();
    assert.deepEqual(settings.calls, [{ fontSize: 17 }, { fontSize: 18 }]);
  } finally {
    element.remove();
  }
});

test('should_insert_mark_when_insert_action_arrives', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'متن', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    child(element, 'parsi-menu-bar').dispatchEvent(
      new CustomEvent('menu-action', { bubbles: true, detail: { action: 'insert-bold' } }),
    );
    await settled();
    assert.ok(element.value.startsWith('****'));
    child(element, 'parsi-menu-bar').dispatchEvent(
      new CustomEvent('menu-action', { bubbles: true, detail: { action: 'insert-mermaid' } }),
    );
    await settled();
    assert.ok(!element.value.includes('mermaid'));
  } finally {
    element.remove();
  }
});

test('should_insert_table_and_admonition_when_new_actions_arrive', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'متن', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    child(element, 'parsi-menu-bar').dispatchEvent(
      new CustomEvent('menu-action', { bubbles: true, detail: { action: 'insert-table' } }),
    );
    await settled();
    assert.ok(element.value.includes('|  |  |'));
    child(element, 'parsi-menu-bar').dispatchEvent(
      new CustomEvent('menu-action', { bubbles: true, detail: { action: 'insert-admonition-tip' } }),
    );
    await settled();
    assert.ok(element.value.includes('...راهنما'));
    child(element, 'parsi-menu-bar').dispatchEvent(
      new CustomEvent('menu-action', { bubbles: true, detail: { action: 'insert-unknown-kind' } }),
    );
    await settled();
    assert.ok(!element.value.includes('unknown-kind'));
  } finally {
    element.remove();
  }
});

test('should_highlight_first_heading_when_mounted_with_outline', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: '# الف\nمتن\n## ب', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    inChild(element, 'parsi-activity-rail', '[data-view="outline"]').click();
    await settled();
    // jsdom has no layout: the visible line is always 1, so the chain is
    // verified through the initial report (real scrolling is browser-verified).
    const current = inChild(element, 'parsi-side-panel', '[aria-current="true"]');
    assert.equal(current?.getAttribute('data-line'), '1');
  } finally {
    element.remove();
  }
});

test('should_keep_highlight_stable_when_center_scrolls_without_movement', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: '# الف\nمتن\n## ب', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    inChild(element, 'parsi-activity-rail', '[data-view="outline"]').click();
    await settled();
    const first = inChild(element, 'parsi-side-panel', '[aria-current="true"]');
    assert.equal(first?.getAttribute('data-line'), '1');
    element.shadowRoot.querySelector('[part="center"]').dispatchEvent(new Event('scroll'));
    await settled();
    await settled();
    assert.equal(inChild(element, 'parsi-side-panel', '[aria-current="true"]'), first);
  } finally {
    element.remove();
  }
});

test('should_clear_highlight_when_document_has_no_visible_heading', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'متن\n\n# الف', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    inChild(element, 'parsi-activity-rail', '[data-view="outline"]').click();
    await settled();
    assert.equal(inChild(element, 'parsi-side-panel', '[aria-current="true"]'), null);
  } finally {
    element.remove();
  }
});

async function openRenameEditor(element, id) {
  inChild(element, 'parsi-side-panel', `[data-doc-menu="${id}"]`).click();
  await settled();
  inChild(element, 'parsi-side-panel', `[data-file-rename="${id}"]`).click();
  await settled();
}

test('should_rename_when_valid_title_arrives', async () => {
  const documents = createDocuments([{ id: 'd1', title: 'قدیمی', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    await openRenameEditor(element, 'd1');
    child(element, 'parsi-side-panel').dispatchEvent(
      new CustomEvent('document-rename', { bubbles: true, detail: { id: 'd1', title: 'تازه' } }),
    );
    await settled();
    await settled();
    assert.deepEqual(documents.calls.filter(([method]) => method === 'rename'), [[
      'rename',
      { id: 'd1', title: 'تازه' },
    ]]);
    assert.equal(inChild(element, 'parsi-side-panel', '[data-rename-input="d1"]'), null);
    assert.ok(inChild(element, 'parsi-side-panel', '[data-doc-id="d1"]')?.textContent.includes('تازه'));
  } finally {
    element.remove();
  }
});

test('should_keep_editor_open_with_error_when_title_is_taken', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'اول', content: 'c', updatedAt: 1 },
    { id: 'd2', title: 'دوم', content: 'c', updatedAt: 2 },
  ]);
  const element = await mountWithDocuments(documents);
  try {
    await openRenameEditor(element, 'd1');
    child(element, 'parsi-side-panel').dispatchEvent(
      new CustomEvent('document-rename', { bubbles: true, detail: { id: 'd1', title: 'دوم' } }),
    );
    await settled();
    await settled();
    assert.ok(inChild(element, 'parsi-side-panel', '[data-rename-input="d1"]'), 'expected the editor open');
    assert.ok(inChild(element, 'parsi-side-panel', '[part="docs-error"]')?.textContent.includes('تکراری'));
  } finally {
    element.remove();
  }
});

test('should_cancel_rename_when_title_is_empty', async () => {
  const documents = createDocuments([{ id: 'd1', title: 'اول', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    await openRenameEditor(element, 'd1');
    child(element, 'parsi-side-panel').dispatchEvent(
      new CustomEvent('document-rename', { bubbles: true, detail: { id: 'd1', title: '   ' } }),
    );
    await settled();
    assert.deepEqual(documents.calls.filter(([method]) => method === 'rename'), []);
    assert.equal(inChild(element, 'parsi-side-panel', '[data-rename-input="d1"]'), null);
  } finally {
    element.remove();
  }
});

test('should_show_properties_when_properties_arrives', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'سند مهم', content: 'متن', createdAt: 100, updatedAt: 200 },
  ]);
  const element = await mountWithDocuments(documents);
  try {
    child(element, 'parsi-side-panel').dispatchEvent(
      new CustomEvent('document-properties', { bubbles: true, detail: { id: 'd1' } }),
    );
    await settled();
    await settled();
    const dialog = inChild(element, 'parsi-modal-dialog', '[part="modal-dialog"]');
    assert.ok(dialog, 'expected the properties modal');
    assert.equal(dialog.getAttribute('role'), 'dialog');
    assert.ok(dialog.textContent.includes('سند مهم'));
    assert.ok(dialog.textContent.includes('ویژگی‌های سند'));
    inChild(element, 'parsi-modal-dialog', '[data-close-props]').click();
    await settled();
    assert.equal(inChild(element, 'parsi-modal-dialog', '[part="modal-dialog"]'), null);
  } finally {
    element.remove();
  }
});

test('should_ignore_download_gracefully_when_unsupported', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    child(element, 'parsi-side-panel').dispatchEvent(
      new CustomEvent('document-download', { bubbles: true, detail: { id: 'd1' } }),
    );
    await settled();
    await settled();
    assert.equal(inChild(element, 'parsi-modal-dialog', '[part="modal-dialog"]'), null);
  } finally {
    element.remove();
  }
});

test('should_download_html_through_export_service_when_requested', async () => {
  const documents = createDocuments([{ id: 'd1', title: 'یادداشت', content: '# سلام', updatedAt: 1 }]);
  const calls = [];
  const element = await mountWithDocuments(documents, {
    'parsinegar.export.service': {
      async exportHtml(input) {
        calls.push(input);
        return { html: '<!DOCTYPE html>', filename: 'یادداشت.html', mime: 'text/html' };
      },
    },
  });
  const realCreateObjectURL = URL.createObjectURL;
  const realRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = () => 'blob:html';
  URL.revokeObjectURL = () => {};
  try {
    child(element, 'parsi-side-panel').dispatchEvent(
      new CustomEvent('document-download-html', { bubbles: true, detail: { id: 'd1' } }),
    );
    await settled();
    await settled();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].markdown, '# سلام');
    assert.equal(calls[0].title, 'یادداشت');
    assert.equal(calls[0].theme, 'light');
  } finally {
    URL.createObjectURL = realCreateObjectURL;
    URL.revokeObjectURL = realRevokeObjectURL;
    element.remove();
  }
});

function searchDropdown(element) {
  return inChild(element, 'parsi-menu-bar', '[part="search-dropdown"]');
}

function typeSearch(element, query, replace = '') {
  const menu = child(element, 'parsi-menu-bar');
  const queryInput = menu.shadowRoot.querySelector('[data-search-query]');
  queryInput.value = query;
  queryInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  if (replace !== '') {
    const replaceInput = menu.shadowRoot.querySelector('[data-search-replace]');
    replaceInput.value = replace;
    replaceInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  }
}

test('should_open_search_when_ctrl_f_is_pressed', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'یک دو یک', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    assert.equal(searchDropdown(element).hasAttribute('hidden'), true);
    const content = element.shadowRoot.querySelector('[part="editor-host"] .cm-content');
    content.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', ctrlKey: true, bubbles: true, composed: true }));
    await settled();
    assert.equal(searchDropdown(element).hasAttribute('hidden'), false);
    assert.equal(child(element, 'parsi-menu-bar').shadowRoot.activeElement?.getAttribute('data-search-query'), '');
  } finally {
    element.remove();
  }
});

test('should_focus_replace_when_ctrl_shift_f_is_pressed', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'یک دو یک', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    const content = element.shadowRoot.querySelector('[part="editor-host"] .cm-content');
    content.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', ctrlKey: true, shiftKey: true, bubbles: true, composed: true }));
    await settled();
    assert.equal(searchDropdown(element).hasAttribute('hidden'), false);
    assert.equal(child(element, 'parsi-menu-bar').shadowRoot.activeElement?.getAttribute('data-search-replace'), '');
  } finally {
    element.remove();
  }
});

test('should_count_matches_when_query_is_typed', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'یک دو یک', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    inChild(element, 'parsi-menu-bar', '[data-search-toggle]').click();
    await settled();
    typeSearch(element, 'یک');
    await settled();
    const count = inChild(element, 'parsi-menu-bar', '[data-search-count]').textContent;
    assert.ok(count.includes('1') && count.includes('2'), `expected 1-of-2 count, got: ${count}`);
  } finally {
    element.remove();
  }
});

test('should_step_and_replace_all_when_actions_are_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'یک دو یک', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    inChild(element, 'parsi-menu-bar', '[data-search-toggle]').click();
    await settled();
    typeSearch(element, 'یک', '۱');
    await settled();
    const menu = child(element, 'parsi-menu-bar');
    menu.shadowRoot.querySelector('[data-search-action="next"]').click();
    await settled();
    const count = inChild(element, 'parsi-menu-bar', '[data-search-count]').textContent;
    assert.ok(count.includes('2'), `expected to land on match 2, got: ${count}`);
    menu.shadowRoot.querySelector('[data-search-action="replace-all"]').click();
    await settled();
    assert.equal(element.value, '۱ دو ۱');
    const message = inChild(element, 'parsi-menu-bar', '[data-search-message]').textContent;
    assert.ok(message.includes('2'), `expected a 2-item confirmation, got: ${message}`);
  } finally {
    element.remove();
  }
});

test('should_clear_search_when_escape_is_pressed', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'یک دو یک', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    inChild(element, 'parsi-menu-bar', '[data-search-toggle]').click();
    await settled();
    typeSearch(element, 'یک');
    await settled();
    assert.equal(searchDropdown(element).hasAttribute('hidden'), false);
    const input = inChild(element, 'parsi-menu-bar', '[data-search-query]');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    await settled();
    assert.equal(searchDropdown(element).hasAttribute('hidden'), true);
    assert.equal(inChild(element, 'parsi-menu-bar', '[data-search-count]').textContent, '');
  } finally {
    element.remove();
  }
});

test('should_reset_search_when_document_is_switched', async () => {
  const documents = createDocuments([
    { id: 'first', title: 'اول', content: 'یک دو یک', updatedAt: 100 },
    { id: 'second', title: 'دوم', content: 'متن دوم', updatedAt: 300 },
  ]);
  const element = await mountWithDocuments(documents);
  try {
    inChild(element, 'parsi-side-panel', '[data-doc-id="first"]').click();
    await settled();
    inChild(element, 'parsi-menu-bar', '[data-search-toggle]').click();
    await settled();
    typeSearch(element, 'یک');
    await settled();
    assert.equal(searchDropdown(element).hasAttribute('hidden'), false);
    inChild(element, 'parsi-side-panel', '[data-doc-id="second"]').click();
    await settled();
    assert.equal(searchDropdown(element).hasAttribute('hidden'), true);
    assert.equal(inChild(element, 'parsi-menu-bar', '[data-search-count]').textContent, '');
  } finally {
    element.remove();
  }
});

test('should_download_current_markdown_when_menu_action_requests_it', async () => {
  const documents = createDocuments([{ id: 'd1', title: 'یادداشت', content: '# سلام', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  const blobs = [];
  const realCreateObjectURL = URL.createObjectURL;
  const realRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = (blob) => {
    blobs.push(blob);
    return 'blob:md';
  };
  URL.revokeObjectURL = () => {};
  try {
    child(element, 'parsi-menu-bar').dispatchEvent(new CustomEvent('menu-action', { bubbles: true, detail: { action: 'download-markdown' } }));
    await settled();
    await settled();
    assert.equal(blobs.length, 1);
    assert.equal(await blobs[0].text(), '# سلام');
  } finally {
    URL.createObjectURL = realCreateObjectURL;
    URL.revokeObjectURL = realRevokeObjectURL;
    element.remove();
  }
});

test('should_download_current_html_when_menu_action_requests_it', async () => {
  const documents = createDocuments([{ id: 'd1', title: 'یادداشت', content: '# سلام', updatedAt: 1 }]);
  const calls = [];
  const element = await mountWithDocuments(documents, {
    'parsinegar.export.service': {
      async exportHtml(input) {
        calls.push(input);
        return { html: '<!DOCTYPE html>', filename: 'یادداشت.html', mime: 'text/html' };
      },
    },
  });
  const realCreateObjectURL = URL.createObjectURL;
  const realRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = () => 'blob:html';
  URL.revokeObjectURL = () => {};
  try {
    child(element, 'parsi-menu-bar').dispatchEvent(new CustomEvent('menu-action', { bubbles: true, detail: { action: 'download-html' } }));
    await settled();
    await settled();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].markdown, '# سلام');
    assert.equal(calls[0].title, 'یادداشت');
  } finally {
    URL.createObjectURL = realCreateObjectURL;
    URL.revokeObjectURL = realRevokeObjectURL;
    element.remove();
  }
});

test('should_download_library_zip_with_folder_paths_when_menu_action_requests_it', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'ریشه', content: 'c1', updatedAt: 2 },
    { id: 'd2', title: 'تودرتو', content: 'c2', updatedAt: 1 },
  ]);
  const folder = await documents.createFolder('آموزش');
  await documents.moveDocument('d2', folder.id);
  const calls = [];
  const element = await mountWithDocuments(documents, {
    'parsinegar.export.service': {
      async exportHtml() {
        throw new Error('unexpected html export');
      },
      async exportZip(input) {
        calls.push(input);
        return { blob: new Blob(['zip']), filename: 'parsinegar-documents.zip', mime: 'application/zip' };
      },
    },
  });
  const realCreateObjectURL = URL.createObjectURL;
  const realRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = () => 'blob:zip';
  URL.revokeObjectURL = () => {};
  try {
    child(element, 'parsi-menu-bar').dispatchEvent(new CustomEvent('menu-action', { bubbles: true, detail: { action: 'download-zip' } }));
    await settled();
    await settled();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].documents, [
      { markdown: 'c2', title: 'تودرتو', path: 'آموزش' },
      { markdown: 'c1', title: 'ریشه', path: '' },
    ]);
  } finally {
    URL.createObjectURL = realCreateObjectURL;
    URL.revokeObjectURL = realRevokeObjectURL;
    element.remove();
  }
});

test('should_enter_and_exit_fullscreen_without_remounting_editor', async () => {
  const element = document.createElement(TAG);
  element.connect({ infrastructure: { events: createEvents() }, refs: baseRefs() });
  document.body.append(element);
  await settled();
  try {
    const host = element.shadowRoot.querySelector('[part="editor-host"]');
    assert.ok(host.querySelector('.cm-editor'), 'expected a mounted editor');
    child(element, 'parsi-menu-bar').dispatchEvent(new CustomEvent('menu-action', { bubbles: true, detail: { action: 'toggle-fullscreen' } }));
    await settled();
    assert.equal(element.shadowRoot.querySelector('[part="workbench"]').getAttribute('data-fullscreen'), 'on');
    const exit = element.shadowRoot.querySelector('[data-fullscreen-exit]');
    assert.ok(exit, 'expected the floating exit button');
    assert.equal(exit.getAttribute('aria-label'), 'خروج از تمام صفحه');
    assert.equal(element.shadowRoot.querySelector('[part="editor-host"]'), host, 'editor host must survive the toggle');
    assert.ok(inChild(element, 'parsi-menu-bar', '[data-fullscreen-toggle]').innerHTML.includes('#fullscreen-exit'));
    exit.click();
    await settled();
    assert.equal(element.shadowRoot.querySelector('[part="workbench"]').getAttribute('data-fullscreen'), 'off');
    assert.equal(element.shadowRoot.querySelector('[data-fullscreen-exit]'), null);
    assert.equal(element.shadowRoot.querySelector('[part="editor-host"]'), host, 'editor host must survive the exit');
  } finally {
    element.remove();
  }
});

test('should_restore_sort_order_after_reload_when_persisted', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 300 },
    { id: 'd2', title: 'اول', content: 'c2', updatedAt: 100 },
  ]);
  const settings = createSettings();
  const orderOf = (element) => inChildAll(element, 'parsi-side-panel', '[data-doc-id]')
    .map((button) => button.getAttribute('data-doc-id'));
  const first = await mountWithSettings(documents, settings);
  try {
    assert.deepEqual(orderOf(first), ['d1', 'd2']);
    inChild(first, 'parsi-side-panel', '[data-doc-sort]').click();
    await settled();
    inChild(first, 'parsi-side-panel', '[data-files-sort="name"]').click();
    await settled();
    assert.deepEqual(orderOf(first), ['d2', 'd1']);
    assert.ok(settings.calls.some((patch) => patch.filesSort === 'name'), 'expected the sort persisted');
  } finally {
    first.remove();
  }
  const second = await mountWithSettings(documents, settings);
  try {
    assert.deepEqual(orderOf(second), ['d2', 'd1'], 'expected the persisted sort after reload');
  } finally {
    second.remove();
  }
});

function createFilesystem(overrides = {}) {
  const calls = [];
  const service = {
    calls,
    async getCapabilities() {
      return overrides.caps ?? { directoryPicker: true, filePicker: true, writable: true };
    },
    async pickDirectory(picker) {
      if (typeof picker !== 'function') {
        return null;
      }
      return overrides.directory ?? null;
    },
    async pickFile(picker) {
      if (typeof picker !== 'function') {
        return null;
      }
      return overrides.file ?? null;
    },
    async listDirectory() {
      return overrides.entries ?? [];
    },
    async collectEntries(files) {
      return (files ?? [])
        .filter((file) => file?.name?.endsWith('.md'))
        .map((file) => ({ name: file.name, path: file.webkitRelativePath || file.name, file }));
    },
    async readEntry(entry) {
      calls.push(['read', entry.path]);
      return overrides.contents?.[entry.path] ?? `# ${entry.path}\n`;
    },
    async saveShadow(root, path, base, draft) {
      calls.push(['shadow-save', { root, path, base, draft }]);
      return { root, path, updatedAt: Date.now() };
    },
    async readShadow(root, path) {
      return overrides.shadows?.[`${root}\n${path}`] ?? null;
    },
    async clearShadow(root, path) {
      calls.push(['shadow-clear', { root, path }]);
    },
    async writeEntry(entry, content) {
      calls.push(['write', { path: entry.path, content }]);
      if (overrides.write === null) {
        return null;
      }
      if (overrides.writeDenied === true) {
        throw Object.assign(new Error('denied'), { code: 'FILESYSTEM_PERMISSION_DENIED' });
      }
      return { name: entry.name, path: entry.path };
    },
  };
  return service;
}

function diskFileHandle(name) {
  return { kind: 'file', name };
}

function menuAction(element, action) {
  child(element, 'parsi-menu-bar').dispatchEvent(
    new CustomEvent('menu-action', { bubbles: true, detail: { action } }),
  );
}

function diskEntries() {
  return [
    { name: 'a.md', path: 'a.md', handle: { kind: 'file', name: 'a.md' } },
    { name: 'sub/b.md', path: 'sub/b.md', handle: { kind: 'file', name: 'b.md' } },
  ];
}

function stubDirectoryPicker() {
  window.showDirectoryPicker = async () => ({ kind: 'directory', name: 'notes' });
}

test('should_import_folder_when_picker_returns_entries', async () => {
  stubDirectoryPicker();
  const filesystem = createFilesystem({
    directory: { name: 'notes', path: 'notes', handle: { kind: 'directory', name: 'notes' } },
    entries: diskEntries(),
    contents: { 'a.md': 'متن الف', 'sub/b.md': 'متن ب' },
  });
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'متن', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents, { 'pey.filesystem.service': filesystem });
  try {
    menuAction(element, 'open-folder');
    await settled();
    await settled();
    assert.equal(element.value, 'متن الف');
    assert.ok(inChild(element, 'parsi-side-panel', '[data-folder-toggle]'), 'expected the imported folder');
    assert.ok(inChild(element, 'parsi-side-panel', '[data-doc-id]'), 'expected imported documents listed');
  } finally {
    delete window.showDirectoryPicker;
    element.remove();
  }
});

test('should_update_changed_files_when_folder_is_reopened', async () => {
  stubDirectoryPicker();
  const overrides = {
    directory: { name: 'notes', path: 'notes', handle: { kind: 'directory', name: 'notes' } },
    entries: diskEntries(),
    contents: { 'a.md': 'اول', 'sub/b.md': 'ب' },
  };
  const filesystem = createFilesystem(overrides);
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'متن', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents, { 'pey.filesystem.service': filesystem });
  try {
    menuAction(element, 'open-folder');
    await settled();
    await settled();
    assert.equal(element.value, 'اول');
    overrides.contents = { 'a.md': 'دوم', 'sub/b.md': 'ب' };
    menuAction(element, 'open-folder');
    await settled();
    await settled();
    assert.equal(element.value, 'دوم', 'expected the changed file updated in place');
  } finally {
    delete window.showDirectoryPicker;
    element.remove();
  }
});

test('should_import_through_fallback_when_picker_is_missing', async () => {
  delete window.showDirectoryPicker;
  const filesystem = createFilesystem({});
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'متن', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents, { 'pey.filesystem.service': filesystem });
  try {
    menuAction(element, 'open-folder');
    await settled();
    const picker = element.shadowRoot.querySelector('input[type="file"]');
    assert.ok(picker, 'expected the fallback input');
    assert.equal(picker.getAttribute('webkitdirectory'), '');
    const file = new File(['# سلام\n'], 'a.md', { type: 'text/markdown' });
    Object.defineProperty(picker, 'files', { value: [file], configurable: true });
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await settled();
    await settled();
    assert.equal(element.value, '# سلام\n');
  } finally {
    element.remove();
  }
});

test('should_create_folder_when_header_button_is_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'متن', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    inChild(element, 'parsi-side-panel', '[part="docs-folder-new"]').click();
    await settled();
    await settled();
    const input = inChild(element, 'parsi-side-panel', '[data-rename-input^="folder:"]');
    assert.ok(input, 'expected the inline folder rename editor');
    input.value = 'کار';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settled();
    await settled();
    assert.ok(inChild(element, 'parsi-side-panel', '[data-folder-toggle]'), 'expected the created folder');
  } finally {
    element.remove();
  }
});

test('should_swap_center_to_mindmap_when_rail_selects_it', async () => {
  const documents = createDocuments([{ id: 'd1', title: 'نقشه', content: '- الف\n  - ب', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    child(element, 'parsi-activity-rail').dispatchEvent(new CustomEvent('view-select', { bubbles: true, detail: { id: 'mindmap' } }));
    await settled();
    await settled();
    assert.ok(element.shadowRoot.querySelector('[part="mindmap-host"]'), 'expected the mindmap host');
    assert.equal(element.shadowRoot.querySelector('[part="editor-host"]'), null);
    assert.ok(inChild(element, 'parsi-side-panel', '[data-doc-id="d1"]'), 'expected the map document listed');
    child(element, 'parsi-activity-rail').dispatchEvent(new CustomEvent('view-select', { bubbles: true, detail: { id: 'mindmap' } }));
    await settled();
    await settled();
    assert.ok(element.shadowRoot.querySelector('[part="editor-host"]'), 'expected the editor back');
    assert.equal(element.shadowRoot.querySelector('[part="mindmap-host"]'), null);
  } finally {
    element.remove();
  }
});

test('should_create_templated_document_when_mindmap_new_is_requested', async () => {
  const documents = createDocuments([{ id: 'd1', title: 'ریشه', content: '- الف', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    child(element, 'parsi-activity-rail').dispatchEvent(new CustomEvent('view-select', { bubbles: true, detail: { id: 'mindmap' } }));
    await settled();
    await settled();
    inChild(element, 'parsi-side-panel', '[data-mindmap-new]').click();
    await settled();
    await settled();
    // The editor is unmounted in mindmap mode, so value reads the draft the
    // template landed in (persistence itself rides the covered autosave).
    assert.ok(element.value.includes('- ایدهٔ اصلی'), 'expected the mindmap template draft');
    assert.ok(inChild(element, 'parsi-side-panel', '[part="docs-list"]').textContent.includes('سند تازه'));
  } finally {
    element.remove();
  }
});

test('should_return_to_editor_when_builtin_opens_from_mindmap', async () => {
  const documents = createDocuments([{ id: 'd1', title: 'نقشه', content: '- الف', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    child(element, 'parsi-activity-rail').dispatchEvent(new CustomEvent('view-select', { bubbles: true, detail: { id: 'mindmap' } }));
    await settled();
    await settled();
    assert.ok(element.shadowRoot.querySelector('[part="mindmap-host"]'), 'expected mindmap mode');
    element.shadowRoot.querySelector('[part="workbench"]').dispatchEvent(new CustomEvent('about-open', { bubbles: true, composed: true }));
    await settled();
    await settled();
    assert.ok(element.shadowRoot.querySelector('[part="editor-host"]'), 'expected the editor back');
    assert.equal(element.shadowRoot.querySelector('[part="mindmap-host"]'), null);
  } finally {
    element.remove();
  }
});

function createSyncService(overrides = {}) {
  const calls = [];
  return {
    calls,
    async configureBackend(input) {
      calls.push(['configureBackend', input]);
      return { ok: true, kind: 'git', repo: input?.params?.repo ?? null, branch: input?.params?.branch ?? null };
    },
    async removeBackend() {
      calls.push(['removeBackend']);
      return { ok: true };
    },
    async getStatus() {
      return { configured: true, kind: 'git', repo: 'u/r', branch: 'main', lastSyncAt: null, lastError: null };
    },
    async syncNow() {
      calls.push(['syncNow']);
      return { pushed: [], pulled: [], deletedRemote: [], deleteLocal: [], relocated: [], skipped: [], conflicts: [], completed: true };
    },
    async resolveConflict(input) {
      calls.push(['resolveConflict', input]);
      return { remaining: 0 };
    },
    ...overrides,
  };
}

test('should_configure_backend_when_sync_form_is_saved', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const syncer = createSyncService();
  const element = await mountWithDocuments(documents, { 'pey.sync.service': syncer });
  try {
    element.shadowRoot.querySelector('[part="workbench"]').dispatchEvent(new CustomEvent('sync-configure', { bubbles: true, detail: { repo: 'u/r', branch: 'main', token: 'tok' } }));
    await settled();
    await settled();
    assert.deepEqual(syncer.calls, [['configureBackend', { kind: 'git', params: { repo: 'u/r', branch: 'main', token: 'tok' } }]]);
  } finally {
    element.remove();
  }
});

test('should_ignore_sync_events_without_service_when_dispatched', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const element = await mountWithDocuments(documents);
  try {
    element.shadowRoot.querySelector('[part="workbench"]').dispatchEvent(new CustomEvent('sync-now', { bubbles: true, detail: {} }));
    await settled();
    await settled();
    assert.equal(element.value, 'c1');
  } finally {
    element.remove();
  }
});

test('should_show_conflict_modal_when_sync_reports_conflicts', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const syncer = createSyncService({
    async syncNow() {
      return {
        pushed: [],
        pulled: [],
        deletedRemote: [],
        deleteLocal: [],
        relocated: [],
        skipped: [],
        conflicts: [{
          collection: 'documents',
          id: 'd1',
          title: 'یادداشت',
          local: { updatedAt: 2, content: 'نسخه من' },
          remote: { updatedAt: 3, content: 'نسخه طرف' },
        }],
        completed: false,
      };
    },
  });
  const element = await mountWithDocuments(documents, { 'pey.sync.service': syncer });
  try {
    element.shadowRoot.querySelector('[part="workbench"]').dispatchEvent(new CustomEvent('sync-now', { bubbles: true, detail: {} }));
    await settled();
    await settled();
    assert.ok(inChild(element, 'parsi-modal-dialog', '[data-sync-resolve="local"]'), 'expected the keep-mine choice');
    assert.ok(inChild(element, 'parsi-modal-dialog', '[data-sync-resolve="remote"]'), 'expected the take-theirs choice');
    const text = inChild(element, 'parsi-modal-dialog', '[part="modal-dialog"]').textContent;
    assert.ok(text.includes('نسخه من'));
    assert.ok(text.includes('نسخه طرف'));
    inChild(element, 'parsi-modal-dialog', '[data-sync-resolve="local"]').click();
    await settled();
    await settled();
    assert.deepEqual(syncer.calls.filter(([name]) => name === 'resolveConflict'), [
      ['resolveConflict', { collection: 'documents', id: 'd1', choice: 'local' }],
    ]);
    assert.equal(inChild(element, 'parsi-modal-dialog', '[data-sync-resolve="local"]'), null);
  } finally {
    element.remove();
  }
});

test('should_refresh_editor_when_sync_pulls_open_document', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const syncCalls = [];
  const syncer = createSyncService({
    async syncNow(input) {
      syncCalls.push(input);
      await documents.saveDocument({ id: 'd1', title: 'یادداشت', content: 'pulled' });
      return { pushed: [], pulled: [{ collection: 'documents', id: 'd1' }], deletedRemote: [], deleteLocal: [], relocated: [], skipped: [], conflicts: [], completed: true };
    },
  });
  const element = await mountWithDocuments(documents, { 'pey.sync.service': syncer });
  try {
    assert.equal(element.value, 'c1');
    element.shadowRoot.querySelector('[part="workbench"]').dispatchEvent(new CustomEvent('sync-now', { bubbles: true, detail: {} }));
    await settled();
    await settled();
    assert.equal(element.value, 'pulled');
    assert.equal(syncCalls.length, 1);
    assert.deepEqual(
      syncCalls[0].scope.collections.map(({ collection }) => collection).sort(),
      ['documents', 'folders'],
    );
  } finally {
    element.remove();
  }
});

test('should_remove_backend_when_remove_is_dispatched', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const syncer = createSyncService();
  const element = await mountWithDocuments(documents, { 'pey.sync.service': syncer });
  try {
    element.shadowRoot.querySelector('[part="workbench"]').dispatchEvent(new CustomEvent('sync-remove', { bubbles: true, detail: {} }));
    await settled();
    await settled();
    assert.deepEqual(syncer.calls, [['removeBackend']]);
  } finally {
    element.remove();
  }
});

test('should_show_busy_state_while_configure_is_pending', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const syncer = createSyncService({
    async configureBackend() {
      return new Promise(() => {});
    },
    async getStatus() {
      return { configured: false, lastSyncAt: null, lastError: null };
    },
  });
  const element = await mountWithDocuments(documents, { 'pey.sync.service': syncer });
  try {
    child(element, 'parsi-activity-rail').dispatchEvent(new CustomEvent('view-select', { bubbles: true, detail: { id: 'sync' } }));
    await settled();
    await settled();
    element.shadowRoot.querySelector('[part="workbench"]').dispatchEvent(new CustomEvent('sync-configure', {
      bubbles: true,
      detail: { repo: 'u/r', branch: 'main', token: 'tok' },
    }));
    await settled();
    await settled();
    const panel = () => element.shadowRoot.querySelector('parsi-side-panel').shadowRoot;
    assert.ok(panel().querySelector('[data-sync-save]').disabled, 'expected the save button disabled while busy');
    assert.ok(panel().innerHTML.includes('در حال اتصال'), 'expected the connecting label');
  } finally {
    element.remove();
  }
});

test('should_repopulate_form_after_failed_configure_when_refreshed', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const syncer = createSyncService({
    async configureBackend() {
      throw { code: 'SYNC_AUTH_FAILED' };
    },
    async getStatus() {
      return { configured: false, lastSyncAt: null, lastError: { code: 'SYNC_AUTH_FAILED', message: 'nope', at: 1 } };
    },
  });
  const element = await mountWithDocuments(documents, { 'pey.sync.service': syncer });
  try {
    child(element, 'parsi-activity-rail').dispatchEvent(new CustomEvent('view-select', { bubbles: true, detail: { id: 'sync' } }));
    await settled();
    await settled();
    element.shadowRoot.querySelector('[part="workbench"]').dispatchEvent(new CustomEvent('sync-configure', {
      bubbles: true,
      detail: { repo: 'u/r', branch: 'dev', token: 'tok' },
    }));
    await settled();
    await settled();
    const panel = () => element.shadowRoot.querySelector('parsi-side-panel').shadowRoot;
    assert.equal(panel().querySelector('[data-sync-field="repo"]').value, 'u/r');
    assert.equal(panel().querySelector('[data-sync-field="branch"]').value, 'dev');
    assert.equal(panel().querySelector('[data-sync-field="token"]').value, '');
    assert.ok(panel().innerHTML.includes('nope'));
  } finally {
    element.remove();
  }
});

function syncDot(element) {
  return inChild(element, 'parsi-activity-rail', '[data-view="sync"] [data-sync-dot]')?.getAttribute('data-sync-dot') ?? null;
}

test('should_show_sync_view_with_form_when_rail_selects_it', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const syncer = createSyncService({
    async getStatus() {
      return { configured: false, lastSyncAt: null, lastError: null };
    },
  });
  const element = await mountWithDocuments(documents, { 'pey.sync.service': syncer });
  try {
    child(element, 'parsi-activity-rail').dispatchEvent(new CustomEvent('view-select', { bubbles: true, detail: { id: 'sync' } }));
    await settled();
    await settled();
    assert.equal(inChild(element, 'parsi-activity-rail', '[data-view="sync"]').getAttribute('aria-pressed'), 'true');
    assert.ok(inChild(element, 'parsi-side-panel', '[data-sync-field="repo"]'), 'expected the sync form');
    assert.ok(inChild(element, 'parsi-side-panel', '[data-sync-save]'), 'expected the save action');
  } finally {
    element.remove();
  }
});

test('should_show_stale_dot_when_never_synced', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const element = await mountWithDocuments(documents, { 'pey.sync.service': createSyncService() });
  try {
    await settled();
    await settled();
    assert.equal(syncDot(element), 'stale');
  } finally {
    element.remove();
  }
});

test('should_show_ok_dot_after_clean_sync', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const syncer = createSyncService({
    async getStatus() {
      return { configured: true, kind: 'git', repo: 'u/r', branch: 'main', lastSyncAt: 200, lastError: null };
    },
  });
  const element = await mountWithDocuments(documents, { 'pey.sync.service': syncer });
  try {
    await settled();
    await settled();
    assert.equal(syncDot(element), 'ok');
  } finally {
    element.remove();
  }
});

test('should_show_bad_dot_when_last_sync_failed', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const syncer = createSyncService({
    async getStatus() {
      return { configured: true, kind: 'git', repo: 'u/r', branch: 'main', lastSyncAt: null, lastError: { code: 'SYNC_NETWORK_FAILED', message: 'nope', at: 1 } };
    },
  });
  const element = await mountWithDocuments(documents, { 'pey.sync.service': syncer });
  try {
    await settled();
    await settled();
    assert.equal(syncDot(element), 'bad');
  } finally {
    element.remove();
  }
});

test('should_show_busy_dot_while_sync_runs', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const syncer = createSyncService({
    async syncNow() {
      return new Promise(() => {});
    },
  });
  const element = await mountWithDocuments(documents, { 'pey.sync.service': syncer });
  try {
    element.shadowRoot.querySelector('[part="workbench"]').dispatchEvent(new CustomEvent('sync-now', { bubbles: true, detail: {} }));
    await settled();
    await settled();
    assert.equal(syncDot(element), 'busy');
  } finally {
    element.remove();
  }
});
