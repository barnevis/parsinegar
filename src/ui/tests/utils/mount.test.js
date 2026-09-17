// Verifies the shared child-composition helpers.
import '../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PeyElement } from 'pey.webui/base/pey-element';
import { mountComponent, scheduleAttachments } from '../../utils/mount.js';

class TestChild extends PeyElement {
  #refs = null;
  #label = '';
  #configureCalls = 0;

  onConnect(refs) {
    this.#refs = refs;
  }

  configure({ label }) {
    this.#configureCalls += 1;
    if (label !== undefined) {
      this.#label = label;
    }
    this.requestRender();
  }

  get refs() {
    return this.#refs;
  }

  get configureCalls() {
    return this.#configureCalls;
  }

  render() {
    return `<span>${this.#label}</span>`;
  }
}

customElements.define('parsi-test-child', TestChild);

function createEvents() {
  return {
    subscribe: () => () => {},
    publish: () => ({ success: true }),
  };
}

function createHost() {
  const host = document.createElement('div');
  host.attachShadow({ mode: 'open' });
  host.shadowRoot.innerHTML = '<div data-slot="child"></div>';
  document.body.append(host);
  return host;
}

function baseArgs(host, overrides = {}) {
  return {
    shadowRoot: host.shadowRoot,
    slot: '[data-slot="child"]',
    tag: 'parsi-test-child',
    infrastructure: { events: createEvents() },
    refs: { t: (key) => key, extra: 1 },
    ...overrides,
  };
}

async function nextFrame() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => globalThis.requestAnimationFrame(() => resolve()));
}

test('should_mount_connected_child_with_forwarded_refs_when_slot_is_empty', async () => {
  const host = createHost();
  try {
    const child = mountComponent({ ...baseArgs(host), configure: (element) => element.configure({ label: 'hi' }) });
    assert.ok(child instanceof TestChild);
    assert.ok(child.isConnected);
    assert.equal(child.refs.extra, 1);
    await nextFrame();
    assert.equal(child.shadowRoot.textContent, 'hi');
  } finally {
    host.remove();
  }
});

test('should_reuse_child_and_reconfigure_when_slot_is_filled', async () => {
  const host = createHost();
  try {
    const first = mountComponent({ ...baseArgs(host), configure: (element) => element.configure({ label: 'one' }) });
    const second = mountComponent({ ...baseArgs(host), configure: (element) => element.configure({ label: 'two' }) });
    assert.equal(second, first);
    assert.equal(first.configureCalls, 2);
    await nextFrame();
    assert.equal(first.shadowRoot.textContent, 'two');
    assert.equal(host.shadowRoot.querySelectorAll('parsi-test-child').length, 1);
  } finally {
    host.remove();
  }
});

test('should_throw_when_slot_is_missing', () => {
  const host = createHost();
  try {
    assert.throws(() => mountComponent({ ...baseArgs(host), slot: '[data-slot="nope"]' }), /placeholder not found/);
  } finally {
    host.remove();
  }
});

test('should_throw_when_tag_is_not_connectable', () => {
  const host = createHost();
  try {
    assert.throws(() => mountComponent({ ...baseArgs(host), tag: 'parsi-undefined-element' }), /not a connectable element/);
  } finally {
    host.remove();
  }
});

test('should_throw_when_arguments_are_invalid', () => {
  const host = createHost();
  try {
    const valid = baseArgs(host);
    assert.throws(() => mountComponent({ ...valid, shadowRoot: null }), /shadowRoot/);
    assert.throws(() => mountComponent({ ...valid, slot: '' }), /slot/);
    assert.throws(() => mountComponent({ ...valid, tag: '' }), /tag/);
    assert.throws(() => mountComponent({ ...valid, infrastructure: null }), /infrastructure/);
    assert.throws(() => mountComponent({ ...valid, refs: null }), /refs/);
    assert.throws(() => mountComponent({ ...valid, configure: 'nope' }), /configure/);
  } finally {
    host.remove();
  }
});

test('should_run_callback_after_render_when_scheduled', async () => {
  let ran = false;
  scheduleAttachments(() => {
    ran = true;
  });
  assert.equal(ran, false);
  await nextFrame();
  assert.equal(ran, true);
});

test('should_run_callback_without_animation_frame_when_missing', async () => {
  const frame = globalThis.requestAnimationFrame;
  const cancel = globalThis.cancelAnimationFrame;
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
  try {
    let ran = false;
    scheduleAttachments(() => {
      ran = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(ran, true);
  } finally {
    globalThis.requestAnimationFrame = frame;
    globalThis.cancelAnimationFrame = cancel;
  }
});

test('should_throw_when_callback_is_not_a_function', () => {
  assert.throws(() => scheduleAttachments(null), /callback/);
});
