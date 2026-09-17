// Verifies the activity rail element.
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { TAG } from '../../../components/workbench/activity-rail.js';

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
