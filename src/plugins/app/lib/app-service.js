// App-level service: operations that span the whole application and have no
// single plugin owner. The data reset wipes every collection the bootstrap
// declares in one atomic cross-collection transaction — it must live here,
// not in documents/settings/sync, because it crosses all of their stores.
import { appError } from './error.js';

const STORAGE_SERVICE = 'pey.storage.service';
const SERVICE_NAME = 'parsinegar.app.service';

// Every store bootstrap.json declares, with its keyPath field. A store added
// to bootstrap without landing here leaves its data behind a wipe — the
// plugin test pins the two lists together for exactly that reason.
const DATA_COLLECTIONS = [
  { collection: 'documents', keyField: 'id' },
  { collection: 'folders', keyField: 'id' },
  { collection: 'settings', keyField: 'id' },
  { collection: 'disk-drafts', keyField: 'key' },
  { collection: 'sync_backends', keyField: 'id' },
  { collection: 'sync_state', keyField: 'id' },
];

/**
 * Returns the bound storage service or fails clearly before activation.
 * @param {object} bound Activation-bound references.
 * @returns {object} Bound pey.storage.service.
 * @throws {object} Structured APP_STORAGE_UNAVAILABLE error.
 */
function requireStorage(bound) {
  if (!bound.storage) {
    throw appError(
      'APP_STORAGE_UNAVAILABLE',
      `Required service is unavailable: ${STORAGE_SERVICE}`,
      { service: STORAGE_SERVICE },
    );
  }
  return bound.storage;
}

/**
 * Builds the app service. The functions close over the activation-bound
 * references so index.js's lifecycle hooks drive what they see.
 * @param {object} bound Activation-bound references (mutated by activate).
 * @returns {object} parsinegar.app.service.
 */
export function createService(bound) {
  /**
   * Wipes every application collection in one atomic transaction: all records
   * of all stores disappear together or not at all. No domain event — the only
   * caller is the UI reset flow, which reloads the page right after, and
   * per-collection events (documents:changed and friends) would fire at
   * half-deleted state.
   * @returns {Promise<object>} `{ ok: true, cleared }` with per-collection
   *   record counts as they were before the wipe.
   */
  async function wipeAllData() {
    const storage = requireStorage(bound);
    const cleared = {};
    const operations = [];
    for (const { collection, keyField } of DATA_COLLECTIONS) {
      const records = await storage.query(collection, {});
      cleared[collection] = records.length;
      for (const record of records) {
        operations.push({ collection, method: 'delete', key: record[keyField] });
      }
    }
    if (operations.length > 0) {
      await storage.transaction(operations);
    }
    return { ok: true, cleared };
  }

  return { wipeAllData };
}

export { SERVICE_NAME, DATA_COLLECTIONS };
