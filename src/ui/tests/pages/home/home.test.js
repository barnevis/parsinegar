// Verifies the home page renders the Persian shell and hosts the editor.
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

function translate(key) {
  return catalog.fa[key] ?? key;
}

const ASSET_BASE_URL = 'http://localhost/assets/';

function baseRefs(extra = {}) {
  return { t: translate, assetBaseUrl: ASSET_BASE_URL, ...extra };
}

test('should_render_title_and_editor_when_mounted', async () => {
  const element = document.createElement(TAG);
  element.connect({ infrastructure: { events: createEvents() }, refs: baseRefs() });
  document.body.append(element);
  await flush();
  try {
    const brand = element.shadowRoot.querySelector('[part="brand"]');
    assert.equal(brand?.textContent, 'پارسی‌نگار');
    assert.equal(element.shadowRoot.querySelector('[part="title"]'), null);
    assert.equal(element.shadowRoot.querySelector('[part="subtitle"]'), null);
    assert.ok(element.shadowRoot.querySelector('[part="editor-host"] .cm-editor'));
    assert.ok(element.value.includes('پارسی‌نگار'));
  } finally {
    element.remove();
  }
});

test('should_focus_editor_when_card_is_clicked', async () => {
  const element = document.createElement(TAG);
  element.connect({ infrastructure: { events: createEvents() }, refs: baseRefs() });
  document.body.append(element);
  await flush();
  try {
    element.shadowRoot.querySelector('[part="editor-host"]').click();
    await flush();
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
  await flush();
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
    refs: { t: translate, assetBaseUrl: ASSET_BASE_URL, services: { 'parsinegar.documents.service': documents } },
  });
  document.body.append(element);
  await flush();
  await flush();
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
    const buttons = [...element.shadowRoot.querySelectorAll('[data-doc-id]')];
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
    element.shadowRoot.querySelector('[data-doc-id="first"]').click();
    await flush();
    await flush();
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
  await flush();
  try {
    assert.throws(() => {
      element.connect({ infrastructure: { events: createEvents() }, refs: baseRefs() });
    });
  } finally {
    element.remove();
  }
});

test('should_create_document_when_new_is_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    element.shadowRoot.querySelector('[part="docs-new"]').click();
    await flush();
    await flush();
    assert.equal(element.value, '');
    assert.equal(element.shadowRoot.querySelectorAll('[data-doc-id]').length, 2);
  } finally {
    element.remove();
  }
});

test('should_delete_current_when_delete_is_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    element.shadowRoot.querySelector('[part="docs-delete"]').click();
    await flush();
    await flush();
    const deletes = documents.calls.filter(([method]) => method === 'delete');
    assert.deepEqual(deletes, [['delete', 'd1']]);
  } finally {
    element.remove();
  }
});

test('should_render_rail_with_views_when_mounted', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: '# الف', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    const rail = [...element.shadowRoot.querySelectorAll('[data-view]')];
    assert.deepEqual(rail.map((button) => button.getAttribute('data-view')), ['files', 'outline']);
    assert.equal(element.shadowRoot.querySelector('[data-view="files"]').getAttribute('aria-pressed'), 'true');
    assert.ok(element.shadowRoot.querySelector('[part="side"]'), 'expected the side panel');
  } finally {
    element.remove();
  }
});

test('should_switch_side_view_when_rail_is_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: '# الف\nمتن\n## ب', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    element.shadowRoot.querySelector('[data-view="outline"]').click();
    await flush();
    const jumps = [...element.shadowRoot.querySelectorAll('[data-line]')];
    assert.deepEqual(jumps.map((button) => button.getAttribute('data-line')), ['1', '3']);
    assert.equal(element.shadowRoot.querySelector('[data-view="outline"]').getAttribute('aria-pressed'), 'true');
  } finally {
    element.remove();
  }
});

test('should_toggle_side_when_active_rail_icon_is_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    assert.ok(element.shadowRoot.querySelector('[part="side"]'));
    element.shadowRoot.querySelector('[data-view="files"]').click();
    await flush();
    assert.equal(element.shadowRoot.querySelector('[part="side"]'), null);
  } finally {
    element.remove();
  }
});

test('should_jump_to_line_when_outline_item_is_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: '# الف\nمتن\n## ب', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    element.shadowRoot.querySelector('[data-view="outline"]').click();
    await flush();
    element.shadowRoot.querySelector('[data-line="3"]').click();
    await flush();
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
    const buttons = [...element.shadowRoot.querySelectorAll('[data-menu]')];
    assert.deepEqual(buttons.map((button) => button.getAttribute('data-menu')), ['file', 'edit', 'view']);
    assert.ok(element.shadowRoot.querySelector('[part="menu-dropdown"][hidden]'), 'expected hidden dropdowns');
  } finally {
    element.remove();
  }
});

test('should_toggle_dropdown_when_menu_button_is_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    const button = element.shadowRoot.querySelector('[data-menu="file"]');
    button.click();
    await flush();
    assert.equal(element.shadowRoot.querySelector('[data-menu="file"]').getAttribute('aria-expanded'), 'true');
    assert.equal(element.shadowRoot.querySelectorAll('[part="menu-dropdown"]:not([hidden])').length, 1);
    button.click();
    await flush();
    assert.equal(element.shadowRoot.querySelector('[data-menu="file"]').getAttribute('aria-expanded'), 'false');
  } finally {
    element.remove();
  }
});

test('should_hide_dropdown_with_styles_when_closed', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    await flush();
    const style = element.shadowRoot.querySelector('style[data-pey-stylesheet]');
    assert.ok(style, 'expected the attached kit stylesheet');
    assert.ok(style.textContent.includes('[part="menu-dropdown"][hidden]'));
  } finally {
    element.remove();
  }
});

test('should_stick_panels_with_styles_when_rendered', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    await flush();
    const style = element.shadowRoot.querySelector('style[data-pey-stylesheet]');
    assert.ok(style, 'expected the attached kit stylesheet');
    for (const part of ['menubar', 'rail', 'side', 'statusbar']) {
      assert.ok(style.textContent.includes(`[part="${part}"]`), `expected styles for ${part}`);
    }
    assert.equal((style.textContent.match(/position: sticky/g) ?? []).length, 4);
    assert.ok(style.textContent.includes('gap: 0'), 'expected flush panels without gaps');
  } finally {
    element.remove();
  }
});

test('should_fill_viewport_with_styles_when_rendered', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    await flush();
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
    await flush();
    const style = element.shadowRoot.querySelector('style[data-pey-stylesheet]');
    assert.ok(style, 'expected the attached kit stylesheet');
    assert.ok(style.textContent.includes('inline-size: 20px'), 'expected 20px rail icons');
    assert.ok(style.textContent.includes('#5eead4'), 'expected accent color');
  } finally {
    element.remove();
  }
});

test('should_size_panels_with_styles_when_rendered', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    await flush();
    const style = element.shadowRoot.querySelector('style[data-pey-stylesheet]');
    assert.ok(style, 'expected the attached kit stylesheet');
    assert.ok(style.textContent.includes('font-size: 14px'), 'expected 14px side titles');
    assert.ok(style.textContent.includes('max-inline-size: 800px'), 'expected 800px writing area');
  } finally {
    element.remove();
  }
});

test('should_close_menu_when_escape_is_pressed', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    element.shadowRoot.querySelector('[data-menu="edit"]').click();
    await flush();
    assert.equal(element.shadowRoot.querySelectorAll('[part="menu-dropdown"]:not([hidden])').length, 1);
    element.shadowRoot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    assert.equal(element.shadowRoot.querySelectorAll('[part="menu-dropdown"]:not([hidden])').length, 0);
  } finally {
    element.remove();
  }
});

test('should_create_document_when_menu_action_is_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    element.shadowRoot.querySelector('[data-menu="file"]').click();
    await flush();
    element.shadowRoot.querySelector('[data-action="new-document"]').click();
    await flush();
    await flush();
    assert.equal(element.shadowRoot.querySelectorAll('[data-doc-id]').length, 2);
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
    element.shadowRoot.querySelector('[data-menu="edit"]').click();
    await flush();
    element.shadowRoot.querySelector('[data-action="undo"]').click();
    await flush();
    assert.equal(element.value, 'متن اول');
  } finally {
    element.remove();
  }
});

test('should_toggle_panels_when_view_actions_are_clicked', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    assert.ok(element.shadowRoot.querySelector('[part="statusbar"]'));
    element.shadowRoot.querySelector('[data-menu="view"]').click();
    await flush();
    element.shadowRoot.querySelector('[data-action="toggle-status"]').click();
    await flush();
    assert.equal(element.shadowRoot.querySelector('[part="statusbar"]'), null);
    element.shadowRoot.querySelector('[data-menu="view"]').click();
    await flush();
    element.shadowRoot.querySelector('[data-action="toggle-side"]').click();
    await flush();
    assert.equal(element.shadowRoot.querySelector('[part="side"]'), null);
  } finally {
    element.remove();
  }
});

test('should_show_live_stats_when_mounted', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'یک دو\nسه', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    const value = (part) => element.shadowRoot.querySelector(`[data-stat="${part}"]`)?.textContent;
    assert.equal(value('words'), '3');
    assert.equal(value('lines'), '2');
    element.setDocument('یک');
    await flush();
    assert.equal(value('words'), '1');
    assert.equal(value('lines'), '1');
  } finally {
    element.remove();
  }
});
