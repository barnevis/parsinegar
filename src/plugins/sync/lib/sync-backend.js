// Backend kind registry and error mapping for pey.sync.
//
// Kinds register through descriptors (factory, error map, manifest path,
// rev-mismatch signal); the engine never names a backend technology, so a
// new kind plugs in from the host entry point without touching the engine.
import { syncError } from './error.js';
import { gitAdapterDescriptor } from '../adapters/git-adapter.js';

// Backend kinds register here by default; a host entry point may pass its
// own `adapters` map on the service state to add kinds (e.g. WebDAV)
// without touching this file. See adapters/README.md for the descriptor.
const DEFAULT_ADAPTERS = { git: gitAdapterDescriptor };

/**
 * Maps a backend failure to the sync error contract through the backend
 * descriptor, preserving the adapter code for diagnosis. Adapter messages
 * are safe by contract (no secrets, no content).
 * @param {object} descriptor Backend descriptor (kind, errorMap).
 * @param {object} error Adapter error with a code.
 * @returns {object} Structured sync error.
 */
function mapAdapterError(descriptor, error) {
  if (error?.code && String(error.code).startsWith('SYNC_')) {
    return error;
  }
  const code = descriptor?.errorMap?.[error?.code] ?? 'SYNC_NETWORK_FAILED';
  return syncError(code, error?.message ?? 'Sync backend failed', {
    adapterCode: error?.code ?? null,
    kind: descriptor?.kind ?? null,
  });
}

/**
 * Resolves the backend descriptor for a kind from the state registry.
 * @param {object} state Activation state with optional adapters map.
 * @param {unknown} kind Backend kind.
 * @returns {object} Backend descriptor.
 * @throws {object} SYNC_INVALID_CONFIG for unknown kinds.
 */
function descriptorFor(state, kind) {
  const registry = state.adapters ?? DEFAULT_ADAPTERS;
  const descriptor = registry[kind];
  if (!descriptor || typeof descriptor.create !== 'function') {
    throw syncError('SYNC_INVALID_CONFIG', `Unknown sync backend: ${String(kind)}`, {});
  }
  return descriptor;
}

/**
 * Instantiates the backend adapter for a stored config.
 * @param {object} state Activation state with optional adapters map.
 * @param {object} backend Stored backend record.
 * @returns {object} `{ adapter, descriptor }`.
 * @throws {object} SYNC_INVALID_CONFIG.
 */
function instantiateBackend(state, backend) {
  const descriptor = descriptorFor(state, backend?.kind);
  return {
    adapter: descriptor.create({ ...backend }, state.fetchFn ?? globalThis.fetch),
    descriptor,
  };
}

export {
  DEFAULT_ADAPTERS,
  descriptorFor,
  instantiateBackend,
  mapAdapterError,
};
