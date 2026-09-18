// Verifies the activity rail element.
import '../../setup-dom.js';
import '../../setup-styles.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { TAG } from '../../../components/activity-rail/activity-rail.js';

const VIEWS = [
  { id: 'files', icon: 'files', labelKey: 'parsinegar.views.files' },
  { id: 'outline', icon: 'outline', labelKey: 'parsinegar.views.outline' },
];

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
    refs: { t: (key) => key, assetBaseUrl: 'http://localhost/assets/', ...refs },
  });
  document.body.append(element);
  return element;
}

test('should_render_views_with_active_state_when_mounted', async () => {
  const element = mount({ views: VIEWS, activeView: 'files' });
  try {
    await flush();
    const buttons = [...element.shadowRoot.querySelectorAll('[data-view]')];
    assert.deepEqual(buttons.map((button) => button.getAttribute('data-view')), ['files', 'outline']);
    assert.equal(element.shadowRoot.querySelector('[data-view="files"]').getAttribute('aria-pressed'), 'true');
    assert.equal(element.shadowRoot.querySelector('[data-view="outline"]').getAttribute('aria-pressed'), 'false');
  } finally {
    element.remove();
  }
});

test('should_emit_select_when_button_is_clicked', async () => {
  const element = mount({ views: VIEWS, activeView: 'files' });
  try {
    await flush();
    const seen = [];
    element.addEventListener('view-select', (event) => seen.push(event.detail));
    element.shadowRoot.querySelector('[data-view="outline"]').click();
    await flush();
    assert.deepEqual(seen, [{ id: 'outline' }]);
  } finally {
    element.remove();
  }
});

test('should_update_active_view_when_configured', async () => {
  const element = mount({ views: VIEWS, activeView: 'files' });
  try {
    await flush();
    const target = element;
    target.configure({ activeView: 'outline' });
    await flush();
    assert.equal(element.shadowRoot.querySelector('[data-view="outline"]').getAttribute('aria-pressed'), 'true');
  } finally {
    element.remove();
  }
});

test('should_pin_end_aligned_views_when_mounted', async () => {
  const element = mount({
    views: [...VIEWS, { id: 'settings', icon: 'gear', labelKey: 'parsinegar.views.settings', align: 'end' }],
    activeView: 'files',
  });
  try {
    await flush();
    const end = element.shadowRoot.querySelector('[part="rail-end"]');
    assert.ok(end, 'expected the end group');
    assert.equal(end.querySelector('[data-view="settings"]')?.getAttribute('data-view'), 'settings');
    assert.equal(element.shadowRoot.querySelector('[part="rail"] > [data-view="settings"]'), null);
    assert.ok(element.shadowRoot.querySelector('[part="rail"] > [data-view="files"]'));
  } finally {
    element.remove();
  }
});

test('should_omit_end_group_when_no_end_views_exist', async () => {
  const element = mount({ views: VIEWS, activeView: 'files' });
  try {
    await flush();
    assert.equal(element.shadowRoot.querySelector('[part="rail-end"]'), null);
  } finally {
    element.remove();
  }
});

test('should_paint_chrome_surface_when_mounted', async () => {
  const element = mount({ views: VIEWS, activeView: 'files' });
  try {
    await flush();
    const styles = element.shadowRoot.querySelector('style')?.textContent ?? '';
    assert.ok(styles.includes('background-color: var(--pey-color-surface'));
    assert.ok(styles.includes('border-inline-end: 1px solid var(--pey-color-border'));
  } finally {
    element.remove();
  }
});
