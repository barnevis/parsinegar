// Verifies the home page shell: placeholders, child mounting, flows.
//
// Children (menu bar, rail, side panel, status bar) mount through the shared
// mount helper after render; behavior is asserted through their public surface
// (shadow content, CustomEvents), never their internals.
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

test('should_render_brand_and_editor_when_mounted', async () => {
  const element = document.createElement(TAG);
  element.connect({ infrastructure: { events: createEvents() }, refs: baseRefs() });
  document.body.append(element);
  await settled();
  try {
    const brand = inChild(element, 'parsi-menu-bar', '[part="brand"]');
    assert.equal(brand?.textContent, 'پارسی‌نگار');
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
    async deleteDocument(id) {
      docs.delete(id);
      service.calls.push(['delete', id]);
    },
  };
  return service;
}

async function mountWithDocuments(documents) {
  const element = document.createElement(TAG);
  element.connect({
    infrastructure: { events: createEvents() },
    refs: { t: translate, assetBaseUrl: ASSET_BASE_URL, events: createEvents(), services: { 'parsinegar.documents.service': documents } },
  });
  document.body.append(element);
  await settled();
  return element;
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
    inChild(element, 'parsi-side-panel', '[part="docs-delete"]').click();
    await settled();
    const dialog = element.shadowRoot.querySelector('[part="modal-dialog"]');
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
    inChild(element, 'parsi-side-panel', '[part="docs-delete"]').click();
    await settled();
    element.shadowRoot.querySelector('[data-confirm-delete="yes"]').click();
    await settled();
    const deletes = documents.calls.filter(([method]) => method === 'delete');
    assert.deepEqual(deletes, [['delete', 'd1']]);
  } finally {
    element.remove();
  }
});

test('should_keep_document_when_confirmation_is_cancelled', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    inChild(element, 'parsi-side-panel', '[part="docs-delete"]').click();
    await settled();
    element.shadowRoot.querySelector('[data-confirm-delete="no"]').click();
    await settled();
    assert.deepEqual(documents.calls.filter(([method]) => method === 'delete'), []);
    assert.equal(element.shadowRoot.querySelector('[part="modal-dialog"]'), null);
  } finally {
    element.remove();
  }
});

test('should_cancel_confirmation_when_backdrop_is_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    inChild(element, 'parsi-side-panel', '[part="docs-delete"]').click();
    await settled();
    assert.ok(element.shadowRoot.querySelector('[part="modal-dialog"]'));
    element.shadowRoot.querySelector('[part="modal-backdrop"]').click();
    await settled();
    assert.deepEqual(documents.calls.filter(([method]) => method === 'delete'), []);
    assert.equal(element.shadowRoot.querySelector('[part="modal-dialog"]'), null);
  } finally {
    element.remove();
  }
});

test('should_cancel_confirmation_when_escape_is_pressed', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    inChild(element, 'parsi-side-panel', '[part="docs-delete"]').click();
    await settled();
    assert.ok(element.shadowRoot.querySelector('[part="modal-dialog"]'));
    element.shadowRoot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settled();
    assert.deepEqual(documents.calls.filter(([method]) => method === 'delete'), []);
    assert.equal(element.shadowRoot.querySelector('[part="modal-dialog"]'), null);
  } finally {
    element.remove();
  }
});

test('should_render_rail_with_views_when_mounted', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: '# الف', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    const rail = inChildAll(element, 'parsi-activity-rail', '[data-view]');
    assert.deepEqual(rail.map((button) => button.getAttribute('data-view')), ['files', 'outline', 'settings']);
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
    assert.deepEqual(buttons.map((button) => button.getAttribute('data-menu')), ['file', 'edit', 'view']);
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
    const confirm = element.shadowRoot.querySelector('[part="modal-dialog"]');
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
