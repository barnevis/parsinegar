// Verifies the modal dialog element.
import '../../setup-dom.js';
import '../../setup-styles.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { TAG } from '../../../components/modal-dialog/modal-dialog.js';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function mount() {
  const element = document.createElement(TAG);
  element.connect({
    infrastructure: { events: { subscribe: () => () => {}, publish: () => ({ success: true }) } },
    refs: {
      t: (key, params) => key.replace(/\{(\w+)\}/g, (_, name) => params?.[name] ?? `{${name}}`),
      assetBaseUrl: 'http://localhost/assets/',
    },
  });
  document.body.append(element);
  return element;
}

test('should_render_nothing_when_modal_is_null', async () => {
  const element = mount();
  try {
    await flush();
    element.configure({ modal: null });
    await flush();
    assert.equal(element.shadowRoot.querySelector('[part="modal-dialog"]'), null);
  } finally {
    element.remove();
  }
});

test('should_emit_accepted_when_confirm_yes_is_clicked', async () => {
  const element = mount();
  try {
    await flush();
    element.configure({ modal: { kind: 'confirm', title: 'سند مهم' } });
    await flush();
    const dialog = element.shadowRoot.querySelector('[part="modal-dialog"]');
    assert.ok(dialog, 'expected the confirmation modal');
    assert.ok(
      element.shadowRoot.querySelector('[data-confirm-delete="yes"]'),
      'expected the confirm button',
    );
    const seen = [];
    element.addEventListener('modal-confirm', (event) => seen.push(event.detail));
    element.shadowRoot.querySelector('[data-confirm-delete="yes"]').click();
    assert.deepEqual(seen, [{ accepted: true }]);
  } finally {
    element.remove();
  }
});

test('should_emit_rejected_when_confirm_no_is_clicked', async () => {
  const element = mount();
  try {
    await flush();
    element.configure({ modal: { kind: 'confirm', title: 't' } });
    await flush();
    const seen = [];
    element.addEventListener('modal-confirm', (event) => seen.push(event.detail));
    element.shadowRoot.querySelector('[data-confirm-delete="no"]').click();
    assert.deepEqual(seen, [{ accepted: false }]);
  } finally {
    element.remove();
  }
});

test('should_render_properties_when_configured', async () => {
  const element = mount();
  try {
    await flush();
    element.configure({
      modal: {
        kind: 'properties',
        title: 't',
        createdText: 'c',
        updatedText: 'u',
        sizeText: 's',
      },
    });
    await flush();
    const dialog = element.shadowRoot.querySelector('[part="modal-dialog"]');
    assert.ok(dialog, 'expected the properties modal');
    assert.ok(dialog.textContent.includes('t'));
  } finally {
    element.remove();
  }
});

test('should_emit_dismiss_when_backdrop_is_clicked', async () => {
  const element = mount();
  try {
    await flush();
    element.configure({ modal: { kind: 'confirm', title: 't' } });
    await flush();
    const seen = [];
    element.addEventListener('modal-dismiss', () => seen.push(true));
    element.shadowRoot.querySelector('[part="modal-backdrop"]').click();
    assert.deepEqual(seen, [true]);
  } finally {
    element.remove();
  }
});

test('should_emit_dismiss_when_properties_close_is_clicked', async () => {
  const element = mount();
  try {
    await flush();
    element.configure({
      modal: {
        kind: 'properties',
        title: 't',
        createdText: 'c',
        updatedText: 'u',
        sizeText: 's',
      },
    });
    await flush();
    const seen = [];
    element.addEventListener('modal-dismiss', () => seen.push(true));
    element.shadowRoot.querySelector('[data-close-props]').click();
    assert.deepEqual(seen, [true]);
  } finally {
    element.remove();
  }
});
