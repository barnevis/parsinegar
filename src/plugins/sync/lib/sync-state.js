// Local persistence for pey.sync: guards, run errors, scope memory and
// the last-synced snapshot. Reads and writes the plugin's own stores
// through the storage outage guard; knows record shapes, never the
// network or the sync plan.
import { syncError } from './error.js';
import { normalizeScope } from './sync-scope.js';
import { collectLocal } from './sync-collect.js';
import { requireStorage, store } from './sync-store.js';

const SERVICE_NAME = 'pey.sync.service';
const BACKENDS_COLLECTION = 'sync_backends';
const STATE_COLLECTION = 'sync_state';
const BACKEND_ID = 'active';

/**
 * Requires a configured backend.
 * @param {object} state Activation state.
 * @returns {object} `{ backend, storage }`.
 * @throws {object} SYNC_NOT_CONFIGURED.
 */
async function requireBackend(state) {
  const storage = requireStorage(state);
  const backend = await store(storage.read(BACKENDS_COLLECTION, BACKEND_ID));
  if (!backend) {
    throw syncError('SYNC_NOT_CONFIGURED', 'No sync backend configured', {});
  }
  return { backend, storage };
}

/**
 * Publishes a sync event when the bus exists. Bus failures never fail a run.
 * @param {object} state Activation state.
 * @param {string} type Event type.
 * @param {object} data Event data.
 * @returns {void}
 */
function publish(state, type, data) {
  try {
    state.events?.publish(type, data);
  } catch {
    // Event bus issues never fail a sync.
  }
}

/**
 * Records a run failure for status display.
 * @param {object} storage Storage service.
 * @param {object} error Structured error.
 * @returns {Promise} Stored state.
 */
async function recordError(storage, error) {
  const saved = (await store(storage.read(STATE_COLLECTION, BACKEND_ID))) ?? {};
  return store(storage.write(STATE_COLLECTION, {
    ...saved,
    id: BACKEND_ID,
    lastError: { code: error?.code ?? 'UNKNOWN', message: error?.message ?? '', at: Date.now() },
  }));
}

/**
 * Clears the stored run error after clean completion.
 * @param {object} storage Storage service.
 * @returns {Promise} Stored state.
 */
async function clearError(storage) {
  const saved = (await store(storage.read(STATE_COLLECTION, BACKEND_ID))) ?? {};
  return store(storage.write(STATE_COLLECTION, { ...saved, id: BACKEND_ID, lastError: null }));
}

/**
 * Persists the scope that produced the current snapshot, so conflict
 * resolution replays the same field mapping without caller input.
 * @param {object} storage Storage service.
 * @param {Array} configs Normalized scope.
 * @returns {Promise} Stored state.
 */
async function rememberScope(storage, configs) {
  const saved = (await store(storage.read(STATE_COLLECTION, BACKEND_ID))) ?? {};
  return store(storage.write(STATE_COLLECTION, { ...saved, id: BACKEND_ID, scope: configs }));
}

/**
 * Advances the snapshot to current local state after clean completion.
 * Re-collects inside so resolve paths snapshot post-resolution truth,
 * never a stale pre-resolution listing.
 * @param {object} storage Storage service.
 * @param {Array} configs Normalized scope.
 * @returns {Promise} Stored state.
 */
async function advanceSnapshot(storage, configs) {
  const local = await collectLocal(storage, configs);
  const snapshot = local.entries.map((item) => ({
    collection: item.collection,
    id: item.id,
    updatedAt: item.updatedAt,
    path: item.path,
  }));
  const saved = (await store(storage.read(STATE_COLLECTION, BACKEND_ID))) ?? {};
  return store(storage.write(STATE_COLLECTION, {
    ...saved,
    id: BACKEND_ID,
    lastSyncAt: Date.now(),
    snapshot,
  }));
}

/**
 * Reads the stored scope for conflict resolution (recorded per run).
 * @param {object} storage Storage service.
 * @returns {Array} Normalized scope.
 * @throws {object} SYNC_INVALID_CONFIG when no scope was ever recorded.
 */
async function readScopeForResolve(storage) {
  const saved = await store(storage.read(STATE_COLLECTION, BACKEND_ID));
  if (!saved || !Array.isArray(saved.scope) || saved.scope.length === 0) {
    throw syncError('SYNC_INVALID_CONFIG', 'No recorded sync scope for this conflict', {});
  }
  return normalizeScope({ collections: saved.scope });
}

/**
 * Upserts or drops one snapshot entry.
 * @param {object} storage Storage service.
 * @param {object} saved State record.
 * @param {object|null} entry Entry to upsert, or null.
 * @param {object|null} drop Entry to drop, or null.
 * @returns {Promise} Stored state.
 */
async function writeSnapshotEntry(storage, saved, entry, drop) {
  const previous = Array.isArray(saved.snapshot) ? saved.snapshot : [];
  const snapshot = previous.filter((item) => {
    if (!item) {
      return false;
    }
    if (drop && item.collection === drop.collection && item.id === drop.id) {
      return false;
    }
    return !(entry && item.collection === entry.collection && item.id === entry.id);
  });
  if (entry) {
    snapshot.push(entry);
  }
  return store(storage.write(STATE_COLLECTION, { ...saved, id: BACKEND_ID, snapshot }));
}

export {
  BACKENDS_COLLECTION,
  BACKEND_ID,
  SERVICE_NAME,
  STATE_COLLECTION,
  advanceSnapshot,
  clearError,
  publish,
  readScopeForResolve,
  recordError,
  rememberScope,
  requireBackend,
  writeSnapshotEntry,
};
