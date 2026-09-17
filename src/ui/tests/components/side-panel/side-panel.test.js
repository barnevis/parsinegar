// Verifies the side panel element.
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { TAG } from '../../../components/side-panel/side-panel.js';

function createEvents() {
  return {
    subscribe: () => () => {},
    publish: () => ({ success: true }),
  };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function mount(refs = {}) {
  const element = document.createElement(TAG);
  element.connect({
    infrastructure: { events: createEvents() },
    refs: {
      t: (key) => key,
      assetBaseUrl: 'http://localhost/assets/',
      activeView: 'files',
      items: [],
      currentId: null,
      documentText: '',
      ...refs,
    },
  });
  document.body.append(element);
  return element;
}

test('should_render_files_view_when_mounted', async () => {
  const element = mount({
    items: [{ id: 'a', title: 'اول' }],
    currentId: 'a',
  });
  try {
    await flush();
    assert.ok(element.shadowRoot.querySelector('[part="side"]'));
    assert.ok(element.shadowRoot.querySelector('[data-doc-id="a"]'));
  } finally {
    element.remove();
  }
});

test('should_emit_open_when_document_button_is_clicked', async () => {
  const element = mount({
    items: [{ id: 'a', title: 'اول' }],
    currentId: null,
  });
  try {
    await flush();
    const seen = [];
    element.addEventListener('document-open', (event) => seen.push(event.detail));
    element.shadowRoot.querySelector('[data-doc-id="a"]').click();
    await flush();
    assert.deepEqual(seen, [{ id: 'a' }]);
  } finally {
    element.remove();
  }
});

test('should_emit_create_and_delete_when_action_buttons_are_clicked', async () => {
  const element = mount({ items: [], currentId: null });
  try {
    await flush();
    const seen = [];
    for (const type of ['document-create', 'document-delete']) {
      element.addEventListener(type, (event) => seen.push(type));
    }
    element.shadowRoot.querySelector('[part="docs-new"]').click();
    await flush();
    element.shadowRoot.querySelector('[part="docs-delete"]').click();
    await flush();
    assert.deepEqual(seen, ['document-create', 'document-delete']);
  } finally {
    element.remove();
  }
});

test('should_emit_jump_when_outline_item_is_clicked', async () => {
  const element = mount({ activeView: 'outline', documentText: '# الف\nمتن' });
  try {
    await flush();
    const seen = [];
    element.addEventListener('outline-jump', (event) => seen.push(event.detail));
    element.shadowRoot.querySelector('[data-line="1"]').click();
    await flush();
    assert.deepEqual(seen, [{ line: 1 }]);
  } finally {
    element.remove();
  }
});

test('should_emit_close_when_close_button_is_clicked', async () => {
  const element = mount();
  try {
    await flush();
    const seen = [];
    element.addEventListener('side-close', () => seen.push('closed'));
    element.shadowRoot.querySelector('[part="side-close"]').click();
    await flush();
    assert.deepEqual(seen, ['closed']);
  } finally {
    element.remove();
  }
});

test('should_update_content_when_configured', async () => {
  const element = mount({ activeView: 'files', items: [], currentId: null });
  try {
    await flush();
    assert.equal(element.shadowRoot.querySelector('[data-doc-id="a"]'), null);
    element.configure({
      activeView: 'files',
      items: [{ id: 'a', title: 'اول' }],
      currentId: null,
      documentText: '',
    });
    await flush();
    assert.ok(element.shadowRoot.querySelector('[data-doc-id="a"]'));
  } finally {
    element.remove();
  }
});

test('should_skip_render_when_outline_is_unchanged', async () => {
  const items = [];
  const element = mount({ activeView: 'outline', items, documentText: '# الف' });
  try {
    await flush();
    const first = element.shadowRoot.querySelector('[data-line="1"]');
    assert.ok(first);
    element.configure({ activeView: 'outline', items, currentId: null, documentText: '# الف' });
    await flush();
    assert.equal(element.shadowRoot.querySelector('[data-line="1"]'), first);
  } finally {
    element.remove();
  }
});

test('should_render_settings_when_settings_view_is_active', async () => {
  const element = mount({
    activeView: 'settings',
    settings: { theme: 'dark', direction: 'rtl', fontSize: 18 },
    formatNumber: (value) => `【${value}】`,
  });
  try {
    await flush();
    const checked = element.shadowRoot.querySelector('input[data-setting="theme"]:checked');
    assert.equal(checked?.value, 'dark');
    assert.equal(
      element.shadowRoot.querySelector('input[data-setting="direction"]:checked')?.value,
      'rtl',
    );
    assert.equal(element.shadowRoot.querySelector('[part="settings-value"]')?.textContent, '【18】');
  } finally {
    element.remove();
  }
});

test('should_emit_setting_change_when_radio_changes', async () => {
  const element = mount({
    activeView: 'settings',
    settings: { theme: 'dark', direction: 'rtl', fontSize: 18 },
  });
  try {
    await flush();
    const seen = [];
    element.addEventListener('settings-change', (event) => seen.push(event.detail));
    const input = element.shadowRoot.querySelector('input[data-setting="theme"][value="light"]');
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    assert.deepEqual(seen, [{ key: 'theme', value: 'light' }]);
  } finally {
    element.remove();
  }
});

test('should_emit_setting_step_when_stepper_is_clicked', async () => {
  const element = mount({
    activeView: 'settings',
    settings: { theme: 'dark', direction: 'rtl', fontSize: 18 },
  });
  try {
    await flush();
    const seen = [];
    element.addEventListener('settings-step', (event) => seen.push(event.detail));
    element.shadowRoot.querySelector('[part="settings-more"]').click();
    await flush();
    assert.deepEqual(seen, [{ key: 'fontSize', delta: 1 }]);
  } finally {
    element.remove();
  }
});
