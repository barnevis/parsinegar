// Verifies the UI entry point wires required services through to pages.
import './setup-dom.js';
import './setup-styles.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PEY_ROUTER_SERVICE } from 'pey.webui/contracts';
import { setup } from '../index.js';

function createEvents() {
  return {
    subscribe: () => () => {},
    publish: () => ({ success: true }),
  };
}

function createRouter(route = { pattern: '/', params: {}, query: {}, isNotFound: false }) {
  return {
    route,
    getCurrentRoute() {
      return this.route;
    },
    async navigate() {},
  };
}

function createDocuments(initial = []) {
  const docs = new Map(initial.map((document) => [document.id, { ...document }]));
  return {
    async listDocuments() {
      return [...docs.values()].sort((left, right) => right.updatedAt - left.updatedAt);
    },
    async openDocument(id) {
      return docs.get(id) ?? null;
    },
    async saveDocument(input = {}) {
      const record = { id: input.id ?? 'generated', title: input.title ?? 't', content: input.content ?? '', updatedAt: 1 };
      docs.set(record.id, record);
      return record;
    },
    async createDocument(title) {
      return this.saveDocument({ title, content: '' });
    },
    async deleteDocument(id) {
      docs.delete(id);
    },
  };
}

function createContext({ router, documents } = {}) {
  return {
    services: {
      [PEY_ROUTER_SERVICE]: router ?? createRouter(),
      'parsinegar.documents.service': documents ?? createDocuments(),
    },
    events: createEvents(),
    config: { theme: 'system', language: 'fa', direction: 'rtl', fallbackPath: '/', assetBaseUrl: './assets' },
    onShutdown: null,
  };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function settled() {
  await flush();
  await new Promise((resolve) => globalThis.requestAnimationFrame(() => resolve()));
  await flush();
  await flush();
}

async function waitFor(description, probe, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const result = probe();
    if (result) {
      return result;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out: ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('should_mount_shell_and_home_when_started', async () => {
  const context = createContext();
  await setup(context);
  try {
    await settled();
    assert.ok(document.querySelector('pey-app-shell'), 'expected the shell');
    assert.ok(document.querySelector('parsi-page-home'), 'expected the home page');
    assert.equal(typeof context.onShutdown, 'function');
  } finally {
    context.onShutdown?.();
    document.querySelector('pey-app-shell')?.remove();
    document.querySelector('parsi-page-home')?.remove();
  }
});

test('should_unmount_shell_when_shutdown_runs', async () => {
  const context = createContext();
  await setup(context);
  await flush();
  await flush();
  assert.ok(document.querySelector('pey-app-shell'), 'expected the shell');
  context.onShutdown?.();
  assert.equal(document.querySelector('pey-app-shell'), null);
  assert.equal(document.querySelector('parsi-page-home'), null);
});

test('should_deliver_documents_service_when_home_loads', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'متن ذخیره‌شده', updatedAt: 1 }]);
  const context = createContext({ documents });
  await setup(context);
  try {
    await settled();
    const home = document.querySelector('parsi-page-home');
    assert.ok(home, 'expected the home page');
    assert.equal(home.value, 'متن ذخیره‌شده');
  } finally {
    context.onShutdown?.();
    document.querySelector('pey-app-shell')?.remove();
    document.querySelector('parsi-page-home')?.remove();
  }
});

test('should_format_stats_with_persian_digits_when_home_loads', async () => {
  const documents = createDocuments([{ id: 'd1', title: 't', content: 'یک دو سه', updatedAt: 1 }]);
  const context = createContext({ documents });
  await setup(context);
  try {
    const words = await waitFor('status words with Persian digits', () => {
      const home = document.querySelector('parsi-page-home');
      const text = home?.shadowRoot
        ?.querySelector('parsi-status-bar')
        ?.shadowRoot?.querySelector('[data-stat="words"]')?.textContent ?? '';
      return /[۰-۹]/.test(text) ? text : null;
    });
    assert.match(words, /[۰-۹]/);
  } finally {
    context.onShutdown?.();
    document.querySelector('pey-app-shell')?.remove();
    document.querySelector('parsi-page-home')?.remove();
  }
});

test('should_fail_clearly_when_documents_service_is_missing', async () => {
  const context = createContext({ documents: undefined });
  delete context.services['parsinegar.documents.service'];
  const error = await setup(context).then(() => null, (failure) => failure);
  assert.equal(error?.code, 'PEY_WEBUI_REQUIRED_SERVICE_UNAVAILABLE');
});
