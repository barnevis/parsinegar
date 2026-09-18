// Verifies the side panel element.
import '../../setup-dom.js';
import '../../setup-styles.js';
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

test('should_emit_create_when_new_button_is_clicked', async () => {
  const element = mount({ items: [], currentId: null });
  try {
    await flush();
    const seen = [];
    element.addEventListener('document-create', () => seen.push('created'));
    element.shadowRoot.querySelector('[part="docs-new"]').click();
    await flush();
    assert.deepEqual(seen, ['created']);
  } finally {
    element.remove();
  }
});

test('should_toggle_file_menu_when_menu_button_is_clicked', async () => {
  const element = mount({ items: [{ id: 'a', title: 'اول' }], currentId: null });
  try {
    await flush();
    assert.equal(element.shadowRoot.querySelector('[part="file-menu"]'), null);
    element.shadowRoot.querySelector('[data-doc-menu="a"]').click();
    await flush();
    assert.ok(element.shadowRoot.querySelector('[part="file-menu"]'));
    assert.equal(
      element.shadowRoot.querySelector('[data-doc-menu="a"]').getAttribute('aria-expanded'),
      'true',
    );
    element.shadowRoot.querySelector('[data-doc-menu="a"]').click();
    await flush();
    assert.equal(element.shadowRoot.querySelector('[part="file-menu"]'), null);
  } finally {
    element.remove();
  }
});

test('should_emit_file_actions_when_menu_items_are_clicked', async () => {
  const cases = [
    ['[data-file-download="a"]', 'document-download'],
    ['[data-file-properties="a"]', 'document-properties'],
    ['[data-file-delete="a"]', 'document-delete'],
  ];
  for (const [selector, type] of cases) {
    const element = mount({ items: [{ id: 'a', title: 'اول' }], currentId: null });
    try {
      await flush();
      const seen = [];
      element.addEventListener(type, (event) => seen.push(event.detail));
      element.shadowRoot.querySelector('[data-doc-menu="a"]').click();
      await flush();
      element.shadowRoot.querySelector(selector).click();
      await flush();
      assert.deepEqual(seen, [{ id: 'a' }]);
      assert.equal(element.shadowRoot.querySelector('[part="file-menu"]'), null);
    } finally {
      element.remove();
    }
  }
});

test('should_start_inline_rename_when_rename_is_chosen', async () => {
  const element = mount({ items: [{ id: 'a', title: 'اول' }], currentId: null });
  try {
    await flush();
    element.shadowRoot.querySelector('[data-doc-menu="a"]').click();
    await flush();
    element.shadowRoot.querySelector('[data-file-rename="a"]').click();
    await flush();
    const input = element.shadowRoot.querySelector('[data-rename-input="a"]');
    assert.ok(input);
    assert.equal(input.value, 'اول');
  } finally {
    element.remove();
  }
});

test('should_emit_rename_when_enter_is_pressed', async () => {
  const element = mount({ items: [{ id: 'a', title: 'اول' }], currentId: null });
  try {
    await flush();
    element.shadowRoot.querySelector('[data-doc-menu="a"]').click();
    await flush();
    element.shadowRoot.querySelector('[data-file-rename="a"]').click();
    await flush();
    const seen = [];
    element.addEventListener('document-rename', (event) => seen.push(event.detail));
    const input = element.shadowRoot.querySelector('[data-rename-input="a"]');
    input.value = 'تازه';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    assert.deepEqual(seen, [{ id: 'a', title: 'تازه' }]);
  } finally {
    element.remove();
  }
});

test('should_cancel_rename_when_escape_is_pressed', async () => {
  const element = mount({ items: [{ id: 'a', title: 'اول' }], currentId: null });
  try {
    await flush();
    element.shadowRoot.querySelector('[data-doc-menu="a"]').click();
    await flush();
    element.shadowRoot.querySelector('[data-file-rename="a"]').click();
    await flush();
    assert.ok(element.shadowRoot.querySelector('[data-rename-input="a"]'));
    const seen = [];
    element.addEventListener('document-rename', (event) => seen.push(event.detail));
    element.shadowRoot.querySelector('[data-rename-input="a"]').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await flush();
    assert.deepEqual(seen, []);
    assert.equal(element.shadowRoot.querySelector('[data-rename-input="a"]'), null);
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

test('should_highlight_outline_heading_when_active_line_is_configured', async () => {
  const element = mount({ activeView: 'outline', documentText: '# الف\nمتن\n## ب' });
  try {
    await flush();
    assert.equal(element.shadowRoot.querySelector('[aria-current="true"]'), null);
    element.configure({ activeLine: 3 });
    await flush();
    const current = element.shadowRoot.querySelector('[aria-current="true"]');
    assert.equal(current?.getAttribute('data-line'), '3');
  } finally {
    element.remove();
  }
});

test('should_skip_render_when_active_line_is_unchanged', async () => {
  const element = mount({ activeView: 'outline', documentText: '# الف\nمتن' });
  try {
    await flush();
    element.configure({ activeLine: 1 });
    await flush();
    const first = element.shadowRoot.querySelector('[data-line="1"]');
    assert.ok(first);
    element.configure({ activeLine: 1 });
    await flush();
    assert.equal(element.shadowRoot.querySelector('[data-line="1"]'), first);
  } finally {
    element.remove();
  }
});

test('should_collapse_children_when_toggle_is_clicked', async () => {
  const element = mount({ activeView: 'outline', documentText: '# الف\n## ب\n# ج' });
  try {
    await flush();
    assert.ok(element.shadowRoot.querySelector('[data-line="2"]'));
    element.shadowRoot.querySelector('[data-outline-toggle="1"]').click();
    await flush();
    assert.equal(element.shadowRoot.querySelector('[data-line="2"]'), null);
    assert.equal(element.shadowRoot.querySelector('[data-outline-toggle="1"]').getAttribute('aria-expanded'), 'false');
    assert.ok(element.shadowRoot.querySelector('[data-line="3"]'));
    element.shadowRoot.querySelector('[data-outline-toggle="1"]').click();
    await flush();
    assert.ok(element.shadowRoot.querySelector('[data-line="2"]'));
  } finally {
    element.remove();
  }
});

test('should_reset_collapse_when_document_changes', async () => {
  const element = mount({ activeView: 'outline', documentText: '# الف\n## ب' });
  try {
    await flush();
    element.shadowRoot.querySelector('[data-outline-toggle="1"]').click();
    await flush();
    assert.equal(element.shadowRoot.querySelector('[data-line="2"]'), null);
    element.configure({ documentText: '# تازه\n## نو' });
    await flush();
    assert.ok(element.shadowRoot.querySelector('[data-line="2"]'));
  } finally {
    element.remove();
  }
});

test('should_render_toggle_without_parent_event_when_clicked', async () => {
  const element = mount({ activeView: 'outline', documentText: '# الف\n## ب' });
  try {
    await flush();
    const seen = [];
    element.addEventListener('outline-jump', (event) => seen.push(event.detail));
    element.shadowRoot.querySelector('[data-outline-toggle="1"]').click();
    await flush();
    assert.deepEqual(seen, []);
  } finally {
    element.remove();
  }
});
