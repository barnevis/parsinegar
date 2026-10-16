// pey.sync service: manual backend-neutral sync of storage collections.
//
// Local storage stays the source of truth; the remote is a mirror. Each
// syncNow round reads the remote manifest once, plans purely, applies,
// then rewrites the manifest and advances the snapshot only on clean
// completion — a partial failure simply retries from the same snapshot
// (all remote operations are idempotent).
//
// Thin assembly over focused modules: scope (validation/shaping), paths,
// collect, remote, round, backend, state. Method bodies orchestrate;
// decisions live in the modules.
import { syncError } from './error.js';
import { collectLocal, withoutIgnored } from './sync-collect.js';
import { planSync, snapshotDiff } from './sync-engine.js';
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
import { MANIFEST_PATH, readManifest } from './sync-remote.js';
import {
  applyLocalResolution,
  applyRemoteResolution,
  countRemaining,
  fetchRoundPlan,
  finalizeRound,
  applyRoundPlan,
} from './sync-round.js';

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
        repo: params.repo ?? null,
        branch: params.branch ?? null,
        token: params.token ?? null,
        updatedAt: Date.now(),
      }));
      return { ok: true, kind, repo: params.repo ?? null, branch: params.branch ?? null };
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
        lastSyncAt: saved?.lastSyncAt ?? null,
        lastError: saved?.lastError ?? null,
      };
    },

    async hasPendingChanges(input = {}) {
      // Local-only preflight for the dirty dot: same stamp comparison the
      // next syncNow would run, but never any network. Unconfigured means
      // nothing can be pending, never an error.
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
          || diff.updated.length > 0
          || diff.deleted.length > 0
          || diff.moved.length > 0,
      };
    },

    async syncNow(input = {}) {
      const configs = normalizeScope(input?.scope);
      const { backend, storage } = await requireBackend(state);
      const { adapter, descriptor } = instantiateBackend(state, backend);
      const round = {
        state,
        storage,
        configs,
        adapter,
        descriptor,
        manifestPath: descriptor.manifestPath ?? MANIFEST_PATH,
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
        const { plan, manifestRead, local } = await fetchRoundPlan(round);
        await applyRoundPlan(round, plan, manifestRead, local);
        return finalizeRound(state, storage, configs, plan, round.report);
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
      const round = {
        state,
        storage,
        configs,
        adapter,
        descriptor,
        manifestPath: descriptor.manifestPath ?? MANIFEST_PATH,
        failMapped: (error) => {
          throw mapAdapterError(descriptor, error);
        },
      };
      const manifestRead = await readManifest(adapter, round.manifestPath).catch(round.failMapped);
      const local = await collectLocal(storage, configs);
      const saved = (await store(storage.read(STATE_COLLECTION, BACKEND_ID))) ?? {};
      const snapshot = Array.isArray(saved.snapshot) ? saved.snapshot : [];
      const plan = planSync(
        snapshot,
        local.entries,
        manifestRead.manifest.records,
      );
      const conflict = plan.conflicts.find((item) => item.collection === collection && item.id === id);
      if (!conflict) {
        throw syncError('SYNC_INVALID_CONFIG', 'No pending conflict for that record', { collection, id });
      }
      const before = snapshot.find((item) => item?.collection === collection && item?.id === id);
      if (choice === 'local') {
        await applyLocalResolution(round, local, manifestRead, saved, before, collection, id);
      } else {
        await applyRemoteResolution(round, manifestRead, saved, conflict, collection, id);
      }
      const remaining = await countRemaining(storage, configs, adapter, descriptor);
      if (remaining === 0) {
        await advanceSnapshot(storage, configs);
        await clearError(storage);
      }
      publish(state, 'sync:changed', { pushed: [], pulled: [], conflicts: [] });
      return { remaining };
    },
  };
  return service;
}

export {
  BACKENDS_COLLECTION,
  MANIFEST_PATH,
  SERVICE_NAME,
  STATE_COLLECTION,
  createService,
};
