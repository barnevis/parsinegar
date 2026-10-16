// Storage access guard for pey.sync.
//
// Maps any storage outage to the structured error callers know. Leaf
// module on purpose: collection, paths and state all guard through it,
// so it must depend on nothing plugin-internal but the error shapes.
import { syncError } from './error.js';

/**
 * Wraps storage access: any outage becomes a structured error callers
 * (and the manifest) know.
 * @param {Promise} task Storage promise.
 * @returns {Promise} Its value.
 * @throws {object} SYNC_STORAGE_UNAVAILABLE.
 */
async function store(task) {
  try {
    return await task;
  } catch (error) {
    throw syncError('SYNC_STORAGE_UNAVAILABLE', 'Sync storage unreachable', {
      cause: error?.code ?? 'UNKNOWN',
    });
  }
}

/**
 * Requires the storage dependency.
 * @param {object} state Activation state.
 * @returns {object} Storage service.
 * @throws {object} SYNC_STORAGE_UNAVAILABLE.
 */
function requireStorage(state) {
  if (!state.storage) {
    throw syncError('SYNC_STORAGE_UNAVAILABLE', 'Storage service is unavailable', {});
  }
  return state.storage;
}

export {
  requireStorage,
  store,
};
