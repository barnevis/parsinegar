// Verifies the home page renders the Persian shell and hosts the editor.
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { TAG } from '../../../src/ui/pages/home/home.js';
import catalog from '../../../src/ui/i18n/catalog.js';

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

test('should_render_title_and_editor_when_mounted', async () => {
  const element = document.createElement(TAG);
  element.connect({ infrastructure: { events: createEvents() }, refs: { t: translate } });
  document.body.append(element);
  await flush();
  try {
    const title = element.shadowRoot.querySelector('[part="title"]');
    assert.equal(title?.textContent, 'پارسی‌نگار');
    assert.ok(element.shadowRoot.querySelector('[part="editor-host"] .cm-editor'));
    assert.ok(element.value.includes('پارسی‌نگار'));
  } finally {
    element.remove();
  }
});

test('should_focus_editor_when_card_is_clicked', async () => {
  const element = document.createElement(TAG);
  element.connect({ infrastructure: { events: createEvents() }, refs: { t: translate } });
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
  element.connect({ infrastructure: { events: createEvents() }, refs: { t: translate } });
  document.body.append(element);
  await flush();
  try {
    const seen = [];
    element.addEventListener('parsi-page-home:change', (event) => seen.push(event.detail));
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
    refs: { t: translate, services: { 'parsinegar.documents.service': documents } },
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

test('should_autosave_title_and_content_when_edited', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'c', updatedAt: 1 }]);
  const element = await mountWithDocuments(documents);
  try {
    const input = element.shadowRoot.querySelector('[part="doc-title"]');
    input.value = 'عنوان تازه';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    element.setDocument('متن تازه');
    await new Promise((resolve) => setTimeout(resolve, 1300));
    const saves = documents.calls.filter(([method]) => method === 'save');
    assert.ok(saves.length >= 1, 'expected an autosave');
    const last = saves[saves.length - 1][1];
    assert.equal(last.id, 'd1');
    assert.equal(last.title, 'عنوان تازه');
    assert.equal(last.content, 'متن تازه');
  } finally {
    element.remove();
  }
}, { timeout: 10000 });

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
