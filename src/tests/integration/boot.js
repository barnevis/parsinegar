// Integration environment (bonyan-integration-testing): boots the real
// PeyCore from the real installed dependency with the real plugin set the
// real bootstrap.json declares, configured exactly as the app configures it.
// Faked per the skill — and only these: the three Runtime Host sources (the
// fake moduleLoader still loads every real manifest and imports every real
// entry), the device database engine (fake-indexeddb — the real
// IndexedDBAdapter runs unchanged on it: IndexedDB is external I/O, the
// adapter and plugin are not), the network (scenarios inject a fetch double)
// and the UI (a minimal entry whose only job is capturing the real bound
// services object; it never reimplements plugin behavior).

import { readFile } from 'node:fs/promises';
import 'fake-indexeddb/auto';
import { PeyCore } from '@pey/core';
import '../../ui/tests/setup-dom.js';

const ROOT_URL = new URL('../../../', import.meta.url);
const UI_REF = './src/ui';

/** The app's real bootstrap.json, read fresh from disk. */
export async function readBootstrapJson() {
  return JSON.parse(await readFile(new URL('bootstrap.json', ROOT_URL), 'utf8'));
}

/** A unit's real manifest.json, read fresh from disk by bootstrap ref. */
export async function readUnitManifest(ref) {
  const url = new URL(`${ref.replace(/^\.\//, '')}/manifest.json`, ROOT_URL);
  return JSON.parse(await readFile(url, 'utf8'));
}

/** Fake ConfigSource: the real bootstrap.json content, in memory. */
async function createConfigSource() {
  const content = await readBootstrapJson();
  return { async getConfig() { return content; } };
}

/** Fake EnvSource: the app's config declares no ${VAR} substitution. */
function createFakeEnvSource() {
  return { get() { return undefined; } };
}

/**
 * Fake ModuleLoader: real manifests and real entries from disk/import; the
 * UI unit serves a minimal fake entry (the real UI manifest still goes
 * through validation). `refused` lists refs whose manifest load throws for
 * dependency-failure cascade checks — per the two-step contract, loadEntry
 * is then never called for them.
 */
function createFakeModuleLoader({ refused = [], refusedEntries = [], uiEntry } = {}) {
  const calls = { manifests: [], entries: [] };
  return {
    calls,
    async loadManifest(ref) {
      calls.manifests.push(ref);
      if (refused.includes(ref)) {
        throw new Error(`test refused the manifest for ${ref}`);
      }
      const url = new URL(`${ref.replace(/^\.\//, '')}/manifest.json`, ROOT_URL);
      return JSON.parse(await readFile(url, 'utf8'));
    },
    async loadEntry(ref) {
      calls.entries.push(ref);
      if (ref === UI_REF) {
        return uiEntry;
      }
      if (refusedEntries.includes(ref)) {
        throw new Error(`test refused the entry for ${ref}`);
      }
      const url = new URL(`${ref.replace(/^\.\//, '')}/index.js`, ROOT_URL);
      return import(url.href);
    },
  };
}

/** Minimal fake UI entry: captures the real services Core binds, nothing more. */
function createFakeUiEntry() {
  const captured = { setups: 0, context: null, shutdowns: 0 };
  return {
    captured,
    entry: {
      setup(uiContext) {
        captured.setups += 1;
        captured.context = uiContext;
        uiContext.onShutdown = () => { captured.shutdowns += 1; };
        return undefined;
      },
    },
  };
}

/** Event type of a published event, regardless of the publish payload shape. */
export function eventType(event) {
  return typeof event === 'string' ? event : event?.type;
}

async function deleteTestDatabase(databaseName) {
  const request = indexedDB.deleteDatabase(databaseName);
  await new Promise((resolve) => {
    request.onsuccess = resolve;
    request.onerror = resolve;
    request.onblocked = resolve;
  });
}

/**
 * Boots one isolated real Core instance per call: fresh fakes, fresh event
 * list, the database engine emptied afterwards. Tests stay independent.
 * @param {object} [options]
 * @param {string[]} [options.refuse] Bootstrap refs whose manifest load is refused
 *   (declaration-level failure: fatal core:startup-failed, no core:ready).
 * @param {string[]} [options.refuseEntries] Bootstrap refs whose entry load is refused
 *   (activation-level failure: the plugin goes inactive and its dependents cascade).
 * @returns {Promise<object>} { ready, error, events, loader, ui, shutdown } —
 *   when ready, `ui.captured.context.services` carries the real bound services.
 */
export async function bootParsinegar({ refuse = [], refuseEntries = [], network = null } = {}) {
  const events = [];
  const onEvent = (event) => { events.push(event); };
  const ui = createFakeUiEntry();
  const loader = createFakeModuleLoader({ refused: refuse, refusedEntries: refuseEntries, uiEntry: ui.entry });
  const config = await createConfigSource();
  const core = new PeyCore({ configSource: config, envSource: createFakeEnvSource(), moduleLoader: loader });
  const databaseName = (await readBootstrapJson()).config['pey.storage'].databaseName;
  const originalFetch = globalThis.fetch;
  // The network double must be installed BEFORE start(): the sync entry
  // captures `globalThis.fetch` at import time. Unhandled URLs fall through
  // to the real fetch, so only the addressed endpoints are faked.
  if (network) {
    globalThis.fetch = async (input, init) => {
      const handled = await network(input, init);
      if (handled !== undefined) {
        return handled;
      }
      return originalFetch(input, init);
    };
  }
  const result = { events, loader, ui };
  // `ready` mirrors the real contract — the core:ready event, not the start()
  // resolution: a failed declaration graph still resolves start() (with a
  // shutdown fn) but never publishes core:ready.
  try {
    const { shutdown } = await core.start({ onEvent });
    result.ready = events.some((event) => eventType(event) === 'core:ready');
    result.error = null;
    result.shutdown = async () => {
      await shutdown();
      if (network) {
        globalThis.fetch = originalFetch;
      }
      await deleteTestDatabase(databaseName);
    };
  } catch (error) {
    result.ready = false;
    result.error = error;
    result.shutdown = async () => {
      if (network) {
        globalThis.fetch = originalFetch;
      }
      await deleteTestDatabase(databaseName);
    };
  }
  return result;
}
