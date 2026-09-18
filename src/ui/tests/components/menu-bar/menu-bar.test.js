// Verifies the menu bar element (mounts directly, no page needed).
import '../../setup-dom.js';
import '../../setup-styles.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { TAG } from '../../../components/menu-bar/menu-bar.js';

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
    refs: { t: (key) => key, hasDocument: true, ...refs },
  });
  document.body.append(element);
  return element;
}

test('should_render_menus_and_brand_when_mounted', async () => {
  const element = mount();
  try {
    await flush();
    const buttons = [...element.shadowRoot.querySelectorAll('[data-menu]')];
    assert.deepEqual(buttons.map((button) => button.getAttribute('data-menu')), ['file', 'edit', 'insert', 'view']);
    assert.ok(element.shadowRoot.querySelector('[part="brand"]'));
    assert.equal(element.shadowRoot.querySelectorAll('[part="menu-dropdown"]:not([hidden])').length, 0);
  } finally {
    element.remove();
  }
});

test('should_toggle_dropdown_when_menu_button_is_clicked', async () => {
  const element = mount();
  try {
    await flush();
    const openButton = () => element.shadowRoot.querySelector('[data-menu="file"]');
    openButton().click();
    await flush();
    assert.equal(element.shadowRoot.querySelector('[data-menu="file"]').getAttribute('aria-expanded'), 'true');
    assert.equal(element.shadowRoot.querySelectorAll('[part="menu-dropdown"]:not([hidden])').length, 1);
    openButton().click();
    await flush();
    assert.equal(element.shadowRoot.querySelector('[data-menu="file"]').getAttribute('aria-expanded'), 'false');
  } finally {
    element.remove();
  }
});

test('should_emit_action_and_close_when_menu_item_is_clicked', async () => {
  const element = mount();
  try {
    await flush();
    const seen = [];
    element.addEventListener('menu-action', (event) => seen.push(event.detail));
    element.shadowRoot.querySelector('[data-menu="edit"]').click();
    await flush();
    element.shadowRoot.querySelector('[data-action="undo"]').click();
    await flush();
    assert.deepEqual(seen, [{ action: 'undo' }]);
    assert.equal(element.shadowRoot.querySelectorAll('[part="menu-dropdown"]:not([hidden])').length, 0);
  } finally {
    element.remove();
  }
});

test('should_disable_delete_without_document_when_configured', async () => {
  const element = mount({ hasDocument: false });
  try {
    await flush();
    const item = element.shadowRoot.querySelector('[data-action="delete-document"]');
    assert.ok(item.disabled);
  } finally {
    element.remove();
  }
});

test('should_close_dropdown_when_escape_is_pressed', async () => {
  const element = mount();
  try {
    await flush();
    element.shadowRoot.querySelector('[data-menu="view"]').click();
    await flush();
    assert.equal(element.shadowRoot.querySelectorAll('[part="menu-dropdown"]:not([hidden])').length, 1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    assert.equal(element.shadowRoot.querySelectorAll('[part="menu-dropdown"]:not([hidden])').length, 0);
  } finally {
    element.remove();
  }
});

test('should_close_dropdown_when_outside_is_clicked', async () => {
  const element = mount();
  try {
    await flush();
    element.shadowRoot.querySelector('[data-menu="view"]').click();
    await flush();
    document.body.click();
    await flush();
    assert.equal(element.shadowRoot.querySelectorAll('[part="menu-dropdown"]:not([hidden])').length, 0);
  } finally {
    element.remove();
  }
});

test('should_paint_chrome_surface_when_mounted', async () => {
  const element = mount();
  try {
    await flush();
    const styles = element.shadowRoot.querySelector('style')?.textContent ?? '';
    assert.ok(styles.includes('background-color: var(--pey-color-surface'));
    assert.ok(styles.includes('border-block-end: 1px solid var(--pey-color-border'));
  } finally {
    element.remove();
  }
});

test('should_keep_button_plain_when_menu_is_open', async () => {
  const element = mount();
  try {
    await flush();
    const openButton = () => element.shadowRoot.querySelector('[data-menu="file"]');
    openButton().click();
    await flush();
    assert.equal(openButton().getAttribute('aria-expanded'), 'true');
    const styles = element.shadowRoot.querySelector('style')?.textContent ?? '';
    assert.ok(!styles.includes('aria-expanded'), 'expected no expanded-state styling');
  } finally {
    element.remove();
  }
});

test('should_show_shortcuts_when_insert_menu_is_open', async () => {
  const element = mount();
  try {
    await flush();
    element.shadowRoot.querySelector('[data-menu="insert"]').click();
    await flush();
    const hints = [...element.shadowRoot.querySelectorAll('[part="menu-shortcut"]')].map((node) => node.textContent);
    assert.deepEqual(hints, [
      'Ctrl+H',
      'Ctrl+B',
      'Ctrl+I',
      'Ctrl+Shift+S',
      'Ctrl+Q',
      'Ctrl+K',
      'Ctrl+E',
      'Ctrl+Shift+U',
      'Ctrl+Shift+L',
    ]);
  } finally {
    element.remove();
  }
});
