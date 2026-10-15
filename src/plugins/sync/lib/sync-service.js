// pey.sync service: manual backend-neutral sync of storage collections.
//
// Local storage stays the source of truth; the remote is a mirror. Each
// syncNow round reads the remote manifest once, plans purely, applies,
// then rewrites the manifest and advances the snapshot only on clean
// completion — a partial failure simply retries from the same snapshot
// (all remote operations are idempotent).

import { syncError } from './error.js';
import { buildManifest, hashRecord, parseManifest, planSync } from './sync-engine.js';
import { json, markdown, sanitizePathSegment } from './serializers.js';
import { createGitAdapter } from '../adapters/git-adapter.js';

const SERVICE_NAME = 'pey.sync.service';
const BACKENDS_COLLECTION = 'sync_backends';
const STATE_COLLECTION = 'sync_state';
const BACKEND_ID = 'active';
const MANIFEST_PATH = 'sync-manifest.json';
const SERIALIZERS = { json, markdown };
const ADAPTER_FACTORIES = { git: createGitAdapter };

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
 * Maps a backend failure to the sync error contract. Adapter messages are
 * safe by contract (no secrets, no content); codes translate one to one.
 * @param {object} error Adapter error with a code.
 * @returns {object} Structured sync error.
 */
function toSyncError(error) {
  if (error?.code && String(error.code).startsWith('SYNC_')) {
    return error;
  }
  const mapping = {
    GIT_AUTH_FAILED: 'SYNC_AUTH_FAILED',
    GIT_NOT_FOUND: 'SYNC_REPO_NOT_FOUND',
    GIT_RATE_LIMITED: 'SYNC_RATE_LIMITED',
    GIT_REV_MISMATCH: 'SYNC_CONCURRENT_CHANGE',
    GIT_NETWORK_FAILED: 'SYNC_NETWORK_FAILED',
    GIT_REQUEST_FAILED: 'SYNC_NETWORK_FAILED',
    GIT_INVALID_CONFIG: 'SYNC_INVALID_CONFIG',
  };
  const code = mapping[error?.code] ?? 'SYNC_NETWORK_FAILED';
  return syncError(code, error?.message ?? 'Sync backend failed', {});
}

/**
 * Throws the mapped sync error (for promise-catch chains).
 * @param {object} error Adapter error with a code.
 * @returns {object} Never returns.
 * @throws {object} Always.
 */
function mapAdapterError(error) {
  throw toSyncError(error);
}

/**
 * Validates the sync scope: collections with known serializers.
 * @param {unknown} scope Caller scope.
 * @returns {Array} Normalized collection configs.
 * @throws {object} SYNC_INVALID_CONFIG.
 */
function normalizeScope(scope) {
  const collections = scope?.collections;
  if (!Array.isArray(collections) || collections.length === 0) {
    throw syncError('SYNC_INVALID_CONFIG', 'Sync scope needs at least one collection', {});
  }
  return collections.map((entry, index) => {
    if (!entry || typeof entry.collection !== 'string' || entry.collection.length === 0) {
      throw syncError('SYNC_INVALID_CONFIG', `Sync scope collection ${index} needs a name`, {});
    }
    const serializer = entry.serializer ?? 'json';
    if (!SERIALIZERS[serializer]) {
      throw syncError('SYNC_INVALID_CONFIG', `Unknown sync serializer: ${String(serializer)}`, {
        collection: entry.collection,
      });
    }
    const folders = entry.folders ?? null;
    if (folders !== null && (
      typeof folders.collection !== 'string' || typeof folders.nameField !== 'string'
    )) {
      throw syncError('SYNC_INVALID_CONFIG', 'Sync folder mapping needs collection and nameField', {
        collection: entry.collection,
      });
    }
    return {
      collection: entry.collection,
      idField: entry.idField ?? 'id',
      updatedAtField: entry.updatedAtField ?? 'updatedAt',
      serializer,
      titleField: entry.titleField ?? 'title',
      folders: folders === null ? null : {
        collection: folders.collection,
        idField: folders.idField ?? 'id',
        nameField: folders.nameField,
        parentField: folders.parentField ?? 'parentId',
        folderField: folders.folderField ?? 'folderId',
      },
    };
  });
}

/**
 * Loads folder records indexed for path building and id resolution.
 * @param {object} storage Storage service.
 * @param {Array} configs Normalized scope.
 * @returns {Map} Folders collection name to { byId, mapping }.
 */
async function loadFolderMaps(storage, configs) {
  const maps = new Map();
  for (const config of configs) {
    if (!config.folders || maps.has(config.folders.collection)) {
      continue;
    }
    const records = await store(storage.query(config.folders.collection, {}));
    const byId = new Map();
    for (const folder of records ?? []) {
      if (folder && typeof folder[config.folders.idField] === 'string') {
        byId.set(String(folder[config.folders.idField]), folder);
      }
    }
    maps.set(config.folders.collection, { byId, mapping: config.folders });
  }
  return maps;
}

/**
 * Resolves a folder id to name parts from the root. Cycle-guarded; a broken
 * chain resolves to the reachable prefix and reports relocated.
 * @param {Map} byId Folder records by id.
 * @param {object} mapping Folder field mapping.
 * @param {unknown} folderId Starting folder.
 * @returns {object} `{ parts, broken }`.
 */
function folderParts(byId, mapping, folderId) {
  const parts = [];
  const seen = new Set();
  let current = folderId;
  while (typeof current === 'string' && current.length > 0 && !seen.has(current)) {
    seen.add(current);
    const folder = byId.get(current);
    if (!folder || typeof folder[mapping.nameField] !== 'string') {
      return { parts: parts.reverse(), broken: true };
    }
    parts.push(folder[mapping.nameField]);
    current = folder[mapping.parentField];
  }
  return { parts: parts.reverse(), broken: seen.has(current) };
}

/**
 * Builds the remote path for one record.
 * @param {object} record Storage record.
 * @param {object} config Normalized scope entry.
 * @param {Map} folderMaps Folder maps by collection.
 * @returns {object} `{ path, relocated }`.
 */
function pathForRecord(record, config, folderMaps) {
  if (config.serializer !== 'markdown') {
    return { path: `${config.collection}/${sanitizePathSegment(record[config.idField])}.json`, relocated: false };
  }
  const title = record[config.titleField];
  const file = `${sanitizePathSegment(typeof title === 'string' && title.length > 0 ? title : 'untitled')}.md`;
  if (!config.folders) {
    return { path: file, relocated: false };
  }
  const folders = folderMaps.get(config.folders.collection);
  const resolved = folders
    ? folderParts(folders.byId, folders.mapping, record[config.folders.folderField])
    : { parts: [], broken: false };
  const parts = [...resolved.parts.map(sanitizePathSegment), file];
  return { path: parts.join('/'), relocated: resolved.broken };
}

/**
 * Removes volatile stamps before hashing so re-saves without content
 * changes hash identically (hash-equal means converged, not conflicted).
 * @param {object} record Storage record.
 * @param {string} updatedAtField Volatile field.
 * @returns {object} Copy without the stamp.
 */
function stripVolatile(record, updatedAtField) {
  const { [updatedAtField]: _dropped, ...stable } = record;
  void _dropped;
  return stable;
}

/**
 * Builds plan-ready local entries with hashes, paths and titles.
 * @param {object} storage Storage service.
 * @param {Array} configs Normalized scope.
 * @returns {object} `{ entries, byKey, relocated, skipped }`; byKey maps
 *   `collection::id` to `{ record, config }`.
 */
async function collectLocal(storage, configs) {
  const folderMaps = await loadFolderMaps(storage, configs);
  const entries = [];
  const byKey = new Map();
  const relocated = [];
  const skipped = [];
  for (const config of configs) {
    const serialize = SERIALIZERS[config.serializer].serialize;
    const records = await store(storage.query(config.collection, {}));
    for (const record of records ?? []) {
      const rawId = record?.[config.idField];
      if ((typeof rawId !== 'string' && typeof rawId !== 'number') || String(rawId).length === 0) {
        skipped.push({ collection: config.collection, id: null });
        continue;
      }
      const id = String(rawId);
      const updatedAt = typeof record[config.updatedAtField] === 'number' ? record[config.updatedAtField] : 0;
      let content = null;
      try {
        content = serialize(stripVolatile(record, config.updatedAtField));
      } catch {
        skipped.push({ collection: config.collection, id });
        continue;
      }
      const placed = pathForRecord(record, config, folderMaps);
      if (placed.relocated) {
        relocated.push({ collection: config.collection, id, path: placed.path });
      }
      const title = record[config.titleField];
      const entry = {
        collection: config.collection,
        id,
        updatedAt,
        path: placed.path,
        hash: hashRecord(content),
        title: typeof title === 'string' ? title : null,
      };
      entries.push(entry);
      byKey.set(`${config.collection}::${id}`, { record, config });
    }
  }
  return { entries, byKey, relocated, skipped };
}

/**
 * Builds a pulled record from a remote file: the manifest owns identity
 * and stamp, the file owns content, the path owns title and folder.
 * @param {object} folders Folder maps by collection.
 * @param {Array} configs Normalized scope.
 * @param {object} item Remote manifest entry.
 * @param {string} content File text.
 * @returns {object|null} `{ collection, record, relocated }` or null.
 */
function buildPulledRecord(folders, configs, item, content) {
  const config = configs.find((entry) => entry.collection === item.collection);
  if (!config) {
    return null;
  }
  let partial = null;
  try {
    partial = SERIALIZERS[config.serializer].deserialize(content);
  } catch {
    return null;
  }
  if (!partial || typeof partial !== 'object') {
    return null;
  }
  if (config.serializer === 'markdown') {
    const parts = item.path.split('/');
    const file = parts.pop() ?? '';
    const title = typeof item.title === 'string' && item.title.length > 0
      ? item.title
      : file.replace(/\.md$/, '');
    let folderId = null;
    let relocated = false;
    if (config.folders && parts.length > 0) {
      const resolved = resolvePathParts(folders.get(config.folders.collection), parts);
      folderId = resolved.folderId;
      relocated = resolved.relocated;
    }
    return {
      collection: item.collection,
      record: {
        [config.idField]: item.id,
        [config.titleField]: title,
        [config.folders?.folderField ?? 'folderId']: folderId,
        content: typeof partial.content === 'string' ? partial.content : '',
        [config.updatedAtField]: item.updatedAt,
      },
      relocated,
    };
  }
  if (typeof partial[config.idField] !== 'undefined' && String(partial[config.idField]) !== item.id) {
    return null;
  }
  return {
    collection: item.collection,
    record: {
      ...partial,
      [config.idField]: item.id,
      [config.updatedAtField]: item.updatedAt,
    },
    relocated: false,
  };
}

/**
 * Resolves path parts to a folder id through the folder maps.
 * @param {object|null} maps Folder maps entry ({ byId, mapping }).
 * @param {Array} parts Name parts from the root.
 * @returns {object} `{ folderId, relocated }`.
 */
function resolvePathParts(maps, parts) {
  if (!maps) {
    return { folderId: null, relocated: parts.length > 0 };
  }
  const children = new Map();
  for (const [id, folder] of maps.byId) {
    const parent = folder[maps.mapping.parentField];
    const parentKey = parent === null || parent === undefined ? '' : String(parent);
    const name = folder[maps.mapping.nameField];
    if (typeof name !== 'string') {
      continue;
    }
    if (!children.has(parentKey)) {
      children.set(parentKey, new Map());
    }
    children.get(parentKey).set(name, String(folder[maps.mapping.idField] ?? id));
  }
  let parentKey = '';
  for (const part of parts) {
    const next = children.get(parentKey)?.get(part);
    if (next === undefined) {
      return { folderId: parentKey === '' ? null : parentKey, relocated: true };
    }
    parentKey = next;
  }
  return { folderId: parentKey === '' ? null : parentKey, relocated: false };
}

/**
 * Enriches conflicts with both-side content for the host prompt.
 * @param {object} storage Storage service.
 * @param {Array} configs Normalized scope.
 * @param {object} adapter Backend adapter.
 * @param {Array} conflicts Engine conflicts.
 * @param {Map} byKey Local records by key.
 * @returns {Array} Enriched conflicts.
 */
async function enrichConflicts(storage, configs, adapter, conflicts, byKey) {
  void storage;
  const enriched = [];
  for (const conflict of conflicts) {
    const held = conflict.local ? byKey.get(`${conflict.collection}::${conflict.id}`) : null;
    const remote = conflict.remote ? await adapter.readFile(conflict.remote.path) : null;
    const titleOf = (record, fallback) => {
      const config = configs.find((entry) => entry.collection === conflict.collection);
      const name = record?.[config?.titleField ?? 'title'];
      if (typeof name === 'string' && name.length > 0) {
        return name;
      }
      return typeof fallback === 'string' && fallback.length > 0 ? fallback : conflict.id;
    };
    enriched.push({
      collection: conflict.collection,
      id: conflict.id,
      title: titleOf(held?.record, conflict.remote?.title),
      local: conflict.local ? {
        updatedAt: conflict.local.updatedAt,
        content: held ? contentOf(configs, conflict.collection, held.record) : '',
      } : null,
      remote: conflict.remote ? {
        updatedAt: conflict.remote.updatedAt,
        content: remote ? remote.content : '',
      } : null,
    });
  }
  return enriched;
}

/**
 * Extracts comparable content from a local record.
 * @param {Array} configs Normalized scope.
 * @param {string} collection Collection name.
 * @param {object} record Storage record.
 * @returns {string} Serialized content.
 */
function contentOf(configs, collection, record) {
  const config = configs.find((entry) => entry.collection === collection);
  if (!config) {
    return '';
  }
  try {
    return SERIALIZERS[config.serializer].serialize(stripVolatile(record, config.updatedAtField));
  } catch {
    return '';
  }
}

/**
 * Carries the remote manifest forward: drops deleted ids, overwrites with
 * fresh push/pull entries. Untouched entries ride along untouched.
 * @param {Array} previous Old manifest records.
 * @param {object} plan Applied plan.
 * @param {Array} pulled Pulled remote entries.
 * @param {Array} pruned Ids whose files vanished mid-run.
 * @returns {Array} New manifest records.
 */
function carryManifest(previous, plan, pulledRecords, pruned) {
  const dropped = new Set([
    ...plan.deleteRemote.map((item) => `${item.collection}::${item.id}`),
    ...plan.deleteLocal.map((item) => `${item.collection}::${item.id}`),
    ...(pruned ?? []).map((item) => `${item.collection}::${item.id}`),
  ]);
  const next = new Map();
  for (const item of previous ?? []) {
    if (item && !dropped.has(`${item.collection}::${item.id}`)) {
      next.set(`${item.collection}::${item.id}`, item);
    }
  }
  for (const item of [...plan.push, ...pulledRecords]) {
    next.set(`${item.collection}::${item.id}`, {
      collection: item.collection,
      id: item.id,
      path: item.path,
      updatedAt: item.updatedAt,
      hash: item.hash,
      title: item.title ?? null,
    });
  }
  return [...next.values()];
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
      const factory = ADAPTER_FACTORIES[kind];
      if (typeof factory !== 'function') {
        throw syncError('SYNC_INVALID_CONFIG', `Unknown sync backend: ${String(kind)}`, {});
      }
      let backend = null;
      try {
        backend = factory({ ...params, fetchFn: state.fetchFn ?? globalThis.fetch });
        await backend.open();
      } catch (error) {
        if (error?.code && String(error.code).startsWith('SYNC_')) {
          throw error;
        }
        const mapped = toSyncError(error);
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

    async syncNow(input = {}) {
      const configs = normalizeScope(input?.scope);
      const { backend, storage } = await requireBackend(state);
      const adapter = instantiateBackend(backend, state.fetchFn ?? globalThis.fetch);
      const report = {
        pushed: [],
        pulled: [],
        deletedRemote: [],
        deleteLocal: [],
        relocated: [],
        skipped: [],
        conflicts: [],
        completed: false,
      };
      const fail = async (error) => {
        await recordError(storage, error);
        publish(state, 'sync:changed', {
          pushed: report.pushed,
          pulled: report.pulled,
          conflicts: report.conflicts.map((conflict) => ({ collection: conflict.collection, id: conflict.id })),
        });
        throw error;
      };
      try {
        await rememberScope(storage, configs);
        const local = await collectLocal(storage, configs);
        report.relocated.push(...local.relocated);
        report.skipped.push(...local.skipped.map((item) => ({ collection: item.collection, id: item.id })));
        const manifestRead = await readManifest(adapter).catch(mapAdapterError);
        console.log('DBG manifest:', JSON.stringify(manifestRead.manifest.records));
        const savedBefore = (await store(storage.read(STATE_COLLECTION, BACKEND_ID))) ?? {};
        const snapshot = Array.isArray(savedBefore.snapshot) ? savedBefore.snapshot : [];
        const plan = planSync(
          snapshot,
          local.entries,
          manifestRead.manifest.records,
        );
        report.skipped.push(...plan.skipped.map((item) => ({ collection: item?.collection ?? null, id: item?.id ?? null })));
        const revs = await readRevs(adapter).catch(mapAdapterError);
        for (const item of plan.push) {
          const held = local.byKey.get(`${item.collection}::${item.id}`);
          const content = serializeRecord(configs, item, held?.record);
          await adapter.writeFile(item.path, content, revs.get(item.path) ?? null).catch(mapAdapterError);
          report.pushed.push({ collection: item.collection, id: item.id });
        }
        const pulledRecords = [];
        const pruned = [];
        for (const item of plan.pull) {
          const file = await adapter.readFile(item.path).catch(mapAdapterError);
          if (!file) {
            pruned.push({ collection: item.collection, id: item.id });
            report.skipped.push({ collection: item.collection, id: item.id });
            continue;
          }
          // Folder maps reload per item: earlier pulls in this same loop may
          // have just created the folders this path resolves through.
          const folderMaps = await loadFolderMaps(storage, configs);
          const built = buildPulledRecord(folderMaps, configs, item, file.content);
          if (!built) {
            report.skipped.push({ collection: item.collection, id: item.id });
            continue;
          }
          await store(storage.write(built.collection, built.record));
          if (built.relocated) {
            report.relocated.push({ collection: item.collection, id: item.id, path: item.path });
          }
          pulledRecords.push(item);
          report.pulled.push({ collection: item.collection, id: item.id });
        }
        for (const item of plan.deleteRemote) {
          await adapter.deleteFile(item.path).catch(mapAdapterError);
          report.deletedRemote.push({ collection: item.collection, id: item.id });
        }
        for (const item of plan.deleteLocal) {
          await store(storage.delete(item.collection, item.id));
          report.deleteLocal.push({ collection: item.collection, id: item.id });
        }
        const enriched = await enrichConflicts(storage, configs, adapter, plan.conflicts, local.byKey).catch(mapAdapterError);
        report.conflicts.push(...enriched);
        const carried = carryManifest(manifestRead.manifest.records, plan, pulledRecords, pruned);
        const { manifest } = buildManifest(carried);
        // Skip the rewrite when nothing changed: keeps revs stable and
        // repeat runs write-free (idempotent).
        let manifestRev = manifestRead.rev;
        if (JSON.stringify(manifest.records) !== JSON.stringify(manifestRead.manifest.records)) {
          const written = await adapter.writeFile(MANIFEST_PATH, JSON.stringify(manifest), manifestRead.rev).catch((error) => {
            if (error?.code === 'GIT_REV_MISMATCH') {
              throw syncError('SYNC_CONCURRENT_CHANGE', 'Remote changed underneath this sync; run again', {});
            }
            throw mapAdapterError(error);
          });
          manifestRev = written.rev;
        }
        void manifestRev;
        if (plan.conflicts.length === 0) {
          await advanceSnapshot(storage, configs);
          await clearError(storage);
        }
        report.completed = plan.conflicts.length === 0;
        publish(state, 'sync:changed', {
          pushed: report.pushed,
          pulled: report.pulled,
          conflicts: report.conflicts.map((conflict) => ({ collection: conflict.collection, id: conflict.id })),
        });
        if (plan.conflicts.length > 0) {
          publish(state, 'sync:conflicts', {
            conflicts: report.conflicts.map((conflict) => ({ collection: conflict.collection, id: conflict.id })),
          });
        }
        return report;
      } catch (error) {
        if (error?.code && String(error.code).startsWith('SYNC_')) {
          return fail(error);
        }
        await recordError(storage, syncError('SYNC_NETWORK_FAILED', 'Sync run failed', {}));
        publish(state, 'sync:changed', { pushed: report.pushed, pulled: report.pulled, conflicts: [] });
        throw error;
      }
    },

    async resolveConflict(input = {}) {
      const source = input && typeof input === 'object' ? input : {};
      const { collection, id, choice } = source;
      if (typeof collection !== 'string' || typeof id !== 'string' || (choice !== 'local' && choice !== 'remote')) {
        throw syncError('SYNC_INVALID_CONFIG', 'Conflict resolution needs collection, id and local|remote', {});
      }
      const { backend, storage } = await requireBackend(state);
      const adapter = instantiateBackend(backend, state.fetchFn ?? globalThis.fetch);
      const configs = await readScopeForResolve(storage);
      const manifestRead = await readManifest(adapter).catch(mapAdapterError);
        console.log('DBG manifest:', JSON.stringify(manifestRead.manifest.records));
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
        const held = local.byKey.get(`${collection}::${id}`);
        const content = serializeRecord(configs, { collection, id }, held?.record);
        const path = local.entries.find((item) => item.collection === collection && item.id === id)?.path;
        if (!path) {
          throw syncError('SYNC_INVALID_CONFIG', 'Local record vanished mid-resolution', { collection, id });
        }
        const revs = await readRevs(adapter).catch(mapAdapterError);
        await adapter.writeFile(path, content, revs.get(path) ?? null).catch(mapAdapterError);
        if (before && typeof before.path === 'string' && before.path !== path) {
          await adapter.deleteFile(before.path).catch(mapAdapterError);
        }
        const entry = local.entries.find((item) => item.collection === collection && item.id === id);
        await writeManifestEntry(adapter, manifestRead, { ...entry, path });
        await writeSnapshotEntry(storage, saved, { ...entry, path });
      } else {
        const file = conflict.remote ? await adapter.readFile(conflict.remote.path).catch(mapAdapterError) : null;
        if (!file) {
          await writeManifestEntry(adapter, manifestRead, null, { collection, id });
          await writeSnapshotEntry(storage, saved, null, { collection, id });
        } else {
          const folderMaps = await loadFolderMaps(storage, configs);
          const built = buildPulledRecord(folderMaps, configs, conflict.remote, file.content);
          if (built) {
            await store(storage.write(built.collection, built.record));
          }
          await writeManifestEntry(adapter, manifestRead, conflict.remote);
          await writeSnapshotEntry(storage, saved, {
            collection,
            id,
            updatedAt: conflict.remote.updatedAt,
            path: conflict.remote.path,
          });
        }
      }
      const remaining = await countRemaining(storage, configs, adapter);
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
 * Instantiates the backend adapter for a stored config.
 * @param {object} backend Stored backend record.
 * @param {Function} fetchFn Fetch implementation.
 * @returns {object} Backend adapter.
 * @throws {object} SYNC_INVALID_CONFIG.
 */
function instantiateBackend(backend, fetchFn) {
  const factory = ADAPTER_FACTORIES[backend?.kind];
  if (typeof factory !== 'function') {
    throw syncError('SYNC_INVALID_CONFIG', `Unknown sync backend: ${String(backend?.kind)}`, {});
  }
  return factory({ repo: backend.repo, branch: backend.branch, token: backend.token, fetchFn });
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
 * Reads the remote manifest, tolerating a first-run absence.
 * @param {object} adapter Backend adapter.
 * @returns {object} `{ manifest, rev }`.
 * @throws {object} SYNC_CORRUPT_MANIFEST.
 */
async function readManifest(adapter) {
  const files = await adapter.listDir('');
  const entry = (files ?? []).find((item) => item?.path === MANIFEST_PATH);
  if (!entry) {
    return { manifest: { version: 1, records: [] }, rev: null };
  }
  const file = await adapter.readFile(MANIFEST_PATH);
  if (!file) {
    return { manifest: { version: 1, records: [] }, rev: null };
  }
  let parsed = null;
  try {
    parsed = parseManifest(JSON.parse(file.content));
  } catch {
    parsed = null;
  }
  if (!parsed) {
    throw syncError('SYNC_CORRUPT_MANIFEST', 'Remote sync manifest is unreadable', {});
  }
  return { manifest: parsed.manifest, rev: entry.rev ?? file.rev ?? null };
}

/**
 * Reads path-to-revision mapping for safe overwrites.
 * @param {object} adapter Backend adapter.
 * @returns {Map} Path to rev.
 */
async function readRevs(adapter) {
  const files = await adapter.listDir('');
  const map = new Map();
  for (const file of files ?? []) {
    if (file && typeof file.path === 'string') {
      map.set(file.path, file.rev ?? null);
    }
  }
  return map;
}

/**
 * Serializes one local record for upload.
 * @param {Array} configs Normalized scope.
 * @param {object} item Plan entry ({collection, id}).
 * @param {object|null} record Storage record.
 * @returns {string} File content.
 * @throws {object} SYNC_INVALID_CONFIG when the record vanished mid-run.
 */
function serializeRecord(configs, item, record) {
  const config = configs.find((entry) => entry.collection === item.collection);
  if (!config || !record) {
    throw syncError('SYNC_INVALID_CONFIG', 'Sync record vanished mid-run', {
      collection: item.collection,
      id: item.id,
    });
  }
  return SERIALIZERS[config.serializer].serialize(record);
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
 * Upserts or drops one manifest entry and rewrites the remote manifest.
 * @param {object} adapter Backend adapter.
 * @param {object} manifestRead Current `{ manifest, rev }`.
 * @param {object|null} entry Entry to upsert, or null.
 * @param {object|null} drop Entry to drop, or null.
 * @returns {object} Fresh `{ manifest, rev }`.
 * @throws {object} SYNC_CONCURRENT_CHANGE on rev mismatch.
 */
async function writeManifestEntry(adapter, manifestRead, entry, drop) {
  const records = manifestRead.manifest.records.filter((item) => {
    if (!item) {
      return false;
    }
    if (drop && item.collection === drop.collection && item.id === drop.id) {
      return false;
    }
    return !(entry && item.collection === entry.collection && item.id === entry.id);
  });
  if (entry) {
    records.push(entry);
  }
  const { manifest } = buildManifest(records);
  try {
    const written = await adapter.writeFile(MANIFEST_PATH, JSON.stringify(manifest), manifestRead.rev);
    return { manifest, rev: written.rev };
  } catch (error) {
    if (error?.code === 'GIT_REV_MISMATCH') {
      throw syncError('SYNC_CONCURRENT_CHANGE', 'Remote changed underneath this sync; run again', {});
    }
    throw mapAdapterError(error);
  }
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

/**
 * Counts remaining conflicts from fresh reads.
 * @param {object} storage Storage service.
 * @param {Array} configs Normalized scope.
 * @param {object} adapter Backend adapter.
 * @returns {number} Open conflict count.
 */
async function countRemaining(storage, configs, adapter) {
  const manifestRead = await readManifest(adapter).catch(mapAdapterError);
        console.log('DBG manifest:', JSON.stringify(manifestRead.manifest.records));
  const local = await collectLocal(storage, configs);
  const saved = (await store(storage.read(STATE_COLLECTION, BACKEND_ID))) ?? {};
  const snapshot = Array.isArray(saved.snapshot) ? saved.snapshot : [];
  return planSync(
    snapshot,
    local.entries,
    manifestRead.manifest.records,
  ).conflicts.length;
}

export {
  BACKENDS_COLLECTION,
  MANIFEST_PATH,
  SERVICE_NAME,
  STATE_COLLECTION,
  createService,
};
