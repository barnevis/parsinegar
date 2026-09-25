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
    refs: { t: (key) => key, hasDocument: true, assetBaseUrl: 'http://localhost/assets/', ...refs },
  });
  document.body.append(element);
  return element;
}

function openSearch(element) {
  element.shadowRoot.querySelector('[data-search-toggle]').click();
  return flush();
}

test('should_render_menus_without_brand_when_mounted', async () => {
  const element = mount();
  try {
    await flush();
    const buttons = [...element.shadowRoot.querySelectorAll('[data-menu]')];
    assert.deepEqual(buttons.map((button) => button.getAttribute('data-menu')), ['file', 'edit', 'insert', 'view']);
    assert.equal(element.shadowRoot.querySelector('[part="brand"]'), null);
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

test('should_show_shortcuts_when_insert_menu_is_open', async () => {  const element = mount();
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

test('should_render_search_toggle_with_icon_when_mounted', async () => {
  const element = mount();
  try {
    await flush();
    const toggle = element.shadowRoot.querySelector('[data-search-toggle]');
    assert.ok(toggle);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.ok(toggle.innerHTML.includes('#search'));
    assert.equal(element.shadowRoot.querySelector('[part="search-dropdown"]').hasAttribute('hidden'), true);
    assert.ok(element.shadowRoot.querySelector('[data-search-form]'));
  } finally {
    element.remove();
  }
});

test('should_disable_search_toggle_without_document_when_configured', async () => {
  const element = mount({ hasDocument: false });
  try {
    await flush();
    assert.ok(element.shadowRoot.querySelector('[data-search-toggle]').disabled);
  } finally {
    element.remove();
  }
});

test('should_open_search_and_focus_query_when_toggled', async () => {
  const element = mount();
  try {
    await flush();
    await openSearch(element);
    const toggle = element.shadowRoot.querySelector('[data-search-toggle]');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(element.shadowRoot.querySelector('[part="search-dropdown"]').hasAttribute('hidden'), false);
    assert.equal(element.shadowRoot.activeElement?.getAttribute('data-search-query'), '');
  } finally {
    element.remove();
  }
});

test('should_emit_search_query_when_typing', async () => {
  const element = mount();
  try {
    await flush();
    await openSearch(element);
    const seen = [];
    element.addEventListener('search-query', (event) => seen.push(event.detail));
    const input = element.shadowRoot.querySelector('[data-search-query]');
    input.value = 'سلام';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await flush();
    assert.deepEqual(seen, [{
      query: 'سلام', replace: '', caseSensitive: false, wholeWord: false, regexp: false, inSelection: false,
    }]);
    assert.equal(element.shadowRoot.querySelector('[part="search-dropdown"]').hasAttribute('hidden'), false);
  } finally {
    element.remove();
  }
});

test('should_emit_search_flag_when_flag_is_changed', async () => {
  const element = mount();
  try {
    await flush();
    await openSearch(element);
    const seen = [];
    element.addEventListener('search-query', (event) => seen.push(event.detail));
    const flag = element.shadowRoot.querySelector('[data-search-flag="regexp"]');
    flag.checked = true;
    flag.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    await flush();
    assert.equal(seen.length, 1);
    assert.equal(seen[0].regexp, true);
  } finally {
    element.remove();
  }
});

test('should_emit_search_action_when_action_is_clicked', async () => {
  const element = mount();
  try {
    await flush();
    await openSearch(element);
    const seen = [];
    element.addEventListener('search-next', (event) => seen.push(event.detail));
    element.shadowRoot.querySelector('[data-search-action="next"]').click();
    await flush();
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].query, '');
    assert.equal(element.shadowRoot.querySelector('[part="search-dropdown"]').hasAttribute('hidden'), false);
  } finally {
    element.remove();
  }
});

test('should_step_on_enter_when_query_is_confirmed', async () => {
  const element = mount();
  try {
    await flush();
    await openSearch(element);
    const seen = [];
    element.addEventListener('search-next', (event) => seen.push(event.detail));
    const input = element.shadowRoot.querySelector('[data-search-query]');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
    await flush();
    assert.equal(seen.length, 1);
  } finally {
    element.remove();
  }
});

test('should_emit_search_close_when_escape_is_pressed_in_form', async () => {
  const element = mount();
  try {
    await flush();
    await openSearch(element);
    const seen = [];
    element.addEventListener('search-close', () => seen.push('closed'));
    const input = element.shadowRoot.querySelector('[data-search-query]');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    await flush();
    assert.deepEqual(seen, ['closed']);
    assert.equal(element.shadowRoot.querySelector('[part="search-dropdown"]').hasAttribute('hidden'), true);
  } finally {
    element.remove();
  }
});

test('should_hide_without_notify_when_outside_is_clicked', async () => {
  const element = mount();
  try {
    await flush();
    await openSearch(element);
    const seen = [];
    element.addEventListener('search-close', () => seen.push('closed'));
    document.body.click();
    await flush();
    assert.equal(element.shadowRoot.querySelector('[part="search-dropdown"]').hasAttribute('hidden'), true);
    assert.deepEqual(seen, []);
  } finally {
    element.remove();
  }
});

test('should_show_result_when_search_is_configured', async () => {
  const element = mount();
  try {
    await flush();
    await openSearch(element);
    element.configure({
      search: { query: 'a', count: { current: 1, total: 2 }, invalidRegexp: false, replaced: null },
    });
    await flush();
    const count = element.shadowRoot.querySelector('[data-search-count]');
    assert.ok(count.textContent.includes('parsinegar.search.count'));
    element.configure({ search: { query: '([', regexp: true, invalidRegexp: true } });
    await flush();
    assert.ok(element.shadowRoot.querySelector('[data-search-message]').textContent.includes('parsinegar.search.invalid-regexp'));
    element.configure({ search: { query: 'a', replaced: 3 } });
    await flush();
    assert.ok(element.shadowRoot.querySelector('[data-search-message]').textContent.includes('parsinegar.search.replaced'));
  } finally {
    element.remove();
  }
});

test('should_paint_search_chrome_when_mounted', async () => {
  const element = mount();
  try {
    await flush();
    const styles = element.shadowRoot.querySelector('style')?.textContent ?? '';
    assert.ok(styles.includes('margin-inline-start: auto'));
    assert.ok(styles.includes('inset-inline-end: 0'));
    assert.ok(styles.includes('inline-size: 17rem'));
  } finally {
    element.remove();
  }
});
