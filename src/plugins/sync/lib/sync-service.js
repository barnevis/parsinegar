// pey.sync service: manual backend-neutral sync of storage collections.
//
// Local storage stays the source of truth; the remote is a mirror. Each
// syncNow round captures local state plus the remote listing, plans
// purely, applies, then advances the path-keyed snapshot only on clean
// completion — a partial failure simply retries from the same snapshot
// (all remote operations are idempotent).
//
// Thin assembly over focused modules: scope (validation/shaping), paths,
// collect, remote, round, backend, state. Method bodies orchestrate;
// decisions live in the modules.
import { syncError } from './error.js';
import { collectLocal, withoutIgnored } from './sync-collect.js';
import { snapshotDiff } from './sync-engine.js';
import { extensionsOf, normalizeScope } from './sync-scope.js';
import { descriptorFor, instantiateBackend, mapAdapterError } from './sync-backend.js';
import {
  BACKENDS_COLLECTION,
  BACKEND_ID,
  SERVICE_NAME,
  STATE_COLLECTION,
  advanceSnapshot,
  clearError,
  publish,
  readScopeForResolve,
  recordError,
  requireBackend,
} from './sync-state.js';
import { requireStorage, store } from './sync-store.js';
import {
  applyLocalResolution,
  applyRemoteResolution,
  applyRoundPlan,
  captureRoundPlan,
  finalizeRound,
} from './sync-round.js';

// Custom commit messages cap at GitHub-practical length; longer input
// truncates instead of failing a whole run over prose.
const SYNC_MESSAGE_MAX = 200;

/**
 * Normalizes the optional custom commit message of one run: trimmed, capped;
 * empty or non-string input means "use the automatic messages".
 * @param {unknown} raw Sync envelope message.
 * @returns {string|null} Message for the round, or null for auto.
 */
function syncMessageOf(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim().slice(0, SYNC_MESSAGE_MAX);
  return text.length > 0 ? text : null;
}

/**
 * Creates the service closing over activation-bound references.
 * @param {object} state References ({ storage, events, fetchFn? }).
 * @returns {object} Service implementation.
 */
function createService(state) {
  const service = {
    async configureBackend(input = {}) {
      const source = input && typeof input === 'object' ? input : {};
      const kind = source.kind;
      const params = source.params && typeof source.params === 'object' ? source.params : {};
      requireStorage(state);
      const descriptor = descriptorFor(state, kind);
      // Echo and storage mirror what the backend will actually use: the
      // descriptor may normalize params (e.g. the gitlab base URL).
      const normalized = typeof descriptor.normalizeParams === 'function'
        ? descriptor.normalizeParams(params)
        : params;
      let backend = null;
      try {
        backend = descriptor.create({ kind, ...params }, state.fetchFn ?? globalThis.fetch);
        await backend.open();
      } catch (error) {
        if (error?.code && String(error.code).startsWith('SYNC_')) {
          throw error;
        }
        const mapped = mapAdapterError(descriptor, error);
        try {
          const storage = requireStorage(state);
          await recordError(storage, mapped);
        } catch {
          // Storage outage already reported by its own code path below.
        }
        throw mapped;
      }
      const storage = requireStorage(state);
      await store(storage.write(BACKENDS_COLLECTION, {
        id: BACKEND_ID,
        kind,
        repo: normalized.repo ?? null,
        branch: normalized.branch ?? null,
        token: normalized.token ?? null,
        baseUrl: normalized.baseUrl ?? null,
        updatedAt: Date.now(),
      }));
      return { ok: true, kind, repo: normalized.repo ?? null, branch: normalized.branch ?? null, baseUrl: normalized.baseUrl ?? null };
    },

    async removeBackend() {
      const storage = requireStorage(state);
      await store(storage.delete(BACKENDS_COLLECTION, BACKEND_ID));
      await store(storage.delete(STATE_COLLECTION, BACKEND_ID));
      return { ok: true };
    },

    async getStatus() {
      const storage = requireStorage(state);
      const backend = await store(storage.read(BACKENDS_COLLECTION, BACKEND_ID));
      const saved = await store(storage.read(STATE_COLLECTION, BACKEND_ID));
      if (!backend) {
        return { configured: false, lastSyncAt: null, lastError: null };
      }
      return {
        configured: true,
        kind: backend.kind,
        repo: backend.repo ?? null,
        branch: backend.branch ?? null,
        baseUrl: backend.baseUrl ?? null,
        lastSyncAt: saved?.lastSyncAt ?? null,
        lastError: saved?.lastError ?? null,
      };
    },

    async hasPendingChanges(input = {}) {
      // Local-only preflight for the dirty dot: the same hash comparison
      // the next syncNow would run, but never any network. Unconfigured
      // means nothing can be pending, never an error.
      const configs = normalizeScope(input?.scope);
      const storage = requireStorage(state);
      const backend = await store(storage.read(BACKENDS_COLLECTION, BACKEND_ID));
      if (!backend) {
        return { pending: false };
      }
      const local = await collectLocal(storage, configs);
      const saved = (await store(storage.read(STATE_COLLECTION, BACKEND_ID))) ?? {};
      const rawSnapshot = Array.isArray(saved.snapshot) ? saved.snapshot : [];
      const snapshot = withoutIgnored(rawSnapshot, configs, local.folderIgnores, extensionsOf(configs));
      const diff = snapshotDiff(snapshot, local.entries);
      return {
        pending: diff.created.length > 0
          || diff.changed.length > 0
          || diff.deleted.length > 0,
      };
    },

    async syncNow(input = {}) {
      const configs = normalizeScope(input?.scope);
      const { backend, storage } = await requireBackend(state);
      const { adapter, descriptor } = instantiateBackend(state, backend);
      const round = buildRound(state, storage, configs, adapter, descriptor, syncMessageOf(input?.message));
      const fail = async (error) => {
        await recordError(storage, error);
        publish(state, 'sync:changed', {
          pushed: round.report.pushed,
          pulled: round.report.pulled,
          conflicts: round.report.conflicts.map((conflict) => ({ collection: conflict.collection, id: conflict.id })),
        });
        throw error;
      };
      try {
        const context = await captureRoundPlan(round);
        await applyRoundPlan(round, context);
        return finalizeRound(state, storage, adapter, configs, context, round.report);
      } catch (error) {
        if (error?.code && String(error.code).startsWith('SYNC_')) {
          return fail(error);
        }
        const mapped = mapAdapterError(descriptor, error);
        await recordError(storage, mapped);
        publish(state, 'sync:changed', { pushed: round.report.pushed, pulled: round.report.pulled, conflicts: [] });
        throw mapped;
      }
    },

    async resolveConflict(input = {}) {
      const source = input && typeof input === 'object' ? input : {};
      const { collection, id, choice } = source;
      if (typeof collection !== 'string' || typeof id !== 'string' || (choice !== 'local' && choice !== 'remote')) {
        throw syncError('SYNC_INVALID_CONFIG', 'Conflict resolution needs collection, id and local|remote', {});
      }
      const { backend, storage } = await requireBackend(state);
      const { adapter, descriptor } = instantiateBackend(state, backend);
      const configs = await readScopeForResolve(storage);
      const round = buildRound(state, storage, configs, adapter, descriptor);
      const context = await captureRoundPlan(round).catch((error) => {
        if (error?.code && String(error.code).startsWith('SYNC_')) {
          throw error;
        }
        throw mapAdapterError(descriptor, error);
      });
      const conflict = context.plan.conflicts.find((item) => item.collection === collection && item.id === id);
      if (!conflict) {
        throw syncError('SYNC_INVALID_CONFIG', 'No pending conflict for that record', { collection, id });
      }
      const saved = (await store(storage.read(STATE_COLLECTION, BACKEND_ID))) ?? {};
      const before = context.snapshot.find((item) => item?.collection === collection && item?.id === id);
      if (choice === 'local') {
        await applyLocalResolution(round, context, saved, before, collection, id);
      } else {
        await applyRemoteResolution(round, context, conflict, collection, id);
      }
      // One record one path: the resolution can only clear its own
      // conflict, so the remaining count comes straight from the plan.
      const remaining = context.plan.conflicts.length - 1;
      if (remaining === 0) {
        await advanceSnapshot(storage, configs, context.revs);
        await clearError(storage);
      }
      publish(state, 'sync:changed', { pushed: [], pulled: [], conflicts: [] });
      return { remaining };
    },
  };
  return service;
}

/**
 * Assembles a fresh round context (mutable report included).
 * @param {object} state Activation state.
 * @param {object} storage Storage service.
 * @param {Array} configs Normalized scope.
 * @param {object} adapter Backend adapter.
 * @param {object} descriptor Backend descriptor.
 * @param {string|null} [message] Custom commit message for this run's
 *   remote writes and deletes, or null for the backend's own defaults.
 * @returns {object} Round context.
 */
function buildRound(state, storage, configs, adapter, descriptor, message = null) {
  return {
    state,
    storage,
    configs,
    adapter,
    descriptor,
    message,
    failMapped: (error) => {
      throw mapAdapterError(descriptor, error);
    },
    report: {
      pushed: [],
      pulled: [],
      deletedRemote: [],
      deleteLocal: [],
      relocated: [],
      skipped: [],
      conflicts: [],
      completed: false,
    },
  };
}

export {
  BACKENDS_COLLECTION,
  SERVICE_NAME,
  STATE_COLLECTION,
  createService,
};
