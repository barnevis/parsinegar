// pey.sync service: manual backend-neutral sync of storage collections.
//
// Local storage stays the source of truth; the remote is a mirror. Each
// syncNow round reads the remote manifest once, plans purely, applies,
// then rewrites the manifest and advances the snapshot only on clean
// completion — a partial failure simply retries from the same snapshot
// (all remote operations are idempotent).

import { syncError } from './error.js';
import { buildManifest, hashRecord, matchesIgnore, parseManifest, planSync, snapshotDiff } from './sync-engine.js';
import { FALLBACK_SEGMENT, json, markdown, sanitizePathSegment } from './serializers.js';
import { gitAdapterDescriptor } from '../adapters/git-adapter.js';

const SERVICE_NAME = 'pey.sync.service';
const BACKENDS_COLLECTION = 'sync_backends';
const STATE_COLLECTION = 'sync_state';
const BACKEND_ID = 'active';
const MANIFEST_PATH = 'sync-manifest.json';
const SERIALIZERS = { json, markdown };
// Backend kinds register here by default; a host entry point may pass its
// own `adapters` map on the service state to add kinds (e.g. WebDAV)
// without touching this file. See adapters/README.md for the descriptor.
const DEFAULT_ADAPTERS = { git: gitAdapterDescriptor };

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
 * Lists the file extensions of the scope serializers for ignore matching.
 * @param {Array} configs Normalized scope.
 * @returns {Array<string>} Unique extensions.
 */
function extensionsOf(configs) {
  const seen = [];
  for (const config of configs ?? []) {
    const extension = SERIALIZERS[config.serializer]?.extension;
    if (typeof extension === 'string' && extension.length > 0 && !seen.includes(extension)) {
      seen.push(extension);
    }
  }
  return seen;
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
    const ignore = entry.ignore ?? [];
    if (!Array.isArray(ignore) || ignore.some((pattern) => typeof pattern !== 'string' || pattern.trim().length === 0)) {
      throw syncError('SYNC_INVALID_CONFIG', 'Sync ignore needs an array of non-empty patterns', {
        collection: entry.collection,
      });
    }
    return {
      collection: entry.collection,
      idField: entry.idField ?? 'id',
      updatedAtField: entry.updatedAtField ?? 'updatedAt',
      serializer,
      titleField: entry.titleField ?? 'title',
      contentField: entry.contentField ?? 'content',
      ignore: ignore.map((pattern) => pattern.trim()),
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
  const segment = sanitizePathSegment(typeof title === 'string' && title.length > 0 ? title : FALLBACK_SEGMENT);
  const file = `${segment}.${SERIALIZERS[config.serializer]?.extension ?? 'md'}`;
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
 * Reports whether a folders-collection record is ignored by display path
 * (sanitized folder chain, e.g. `آموزش/زیر`), so ignoring a folder drops
 * the folder itself and not just the documents under it. The id-based
 * placed path can never match a name pattern.
 * @param {Map} folderIgnores Folders collection name to { byId, mapping, patterns }.
 * @param {string} collection Record collection.
 * @param {string} id Record id.
 * @returns {boolean} True when ignored.
 */
function isIgnoredFolderDisplay(folderIgnores, collection, id) {
  const known = folderIgnores.get(collection);
  if (!known || known.patterns.length === 0) {
    return false;
  }
  const resolved = folderParts(known.byId, known.mapping, id);
  if (resolved.parts.length === 0) {
    return false;
  }
  return matchesIgnore(resolved.parts.map(sanitizePathSegment).join('/'), known.patterns);
}

/**
 * Drops ignored records from plan inputs (remote manifest or stored
 * snapshot): own-collection patterns against the placed path, plus folder
 * display paths resolved through local folder state. Unknown collections
 * pass through untouched, as before.
 * @param {Array} records `{ collection, id, path }` entries.
 * @param {Array} configs Normalized scope.
 * @param {Map} folderIgnores Folders collection name to { byId, mapping, patterns }.
 * @param {Array<string>} extensions Suffixes to strip before matching.
 * @returns {Array} Kept entries (same references).
 */
function withoutIgnored(records, configs, folderIgnores, extensions = ['md']) {
  const byCollection = new Map(configs.map((config) => [config.collection, config]));
  return (records ?? []).filter((item) => {
    const config = byCollection.get(item?.collection);
    if (!config) {
      return true;
    }
    if (matchesIgnore(item?.path ?? '', config.ignore, extensions)) {
      return false;
    }
    const known = folderIgnores.get(item?.collection);
    if (known && known.patterns.length > 0 && typeof item?.id === 'string') {
      const resolved = folderParts(known.byId, known.mapping, item.id);
      if (resolved.parts.length > 0
        && matchesIgnore(resolved.parts.map(sanitizePathSegment).join('/'), known.patterns)) {
        return false;
      }
    }
    return true;
  });
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
  const extensions = extensionsOf(configs);
  // Union of ignore patterns per folders collection, keyed from the
  // referencing document configs (plus the folders collection's own).
  const folderIgnores = new Map();
  for (const config of configs) {
    if (!config.folders) {
      continue;
    }
    const maps = folderMaps.get(config.folders.collection);
    if (!maps) {
      continue;
    }
    const known = folderIgnores.get(config.folders.collection);
    if (known) {
      known.patterns.push(...config.ignore);
    } else {
      folderIgnores.set(config.folders.collection, { byId: maps.byId, mapping: config.folders, patterns: [...config.ignore] });
    }
  }
  for (const config of configs) {
    const known = folderIgnores.get(config.collection);
    if (known && config.ignore.length > 0) {
      known.patterns.push(...config.ignore);
    }
  }
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
        content = serialize(stripVolatile(record, config.updatedAtField), config.contentField);
      } catch {
        skipped.push({ collection: config.collection, id });
        continue;
      }
      const placed = pathForRecord(record, config, folderMaps);
      if (matchesIgnore(placed.path, config.ignore, extensions)
        || isIgnoredFolderDisplay(folderIgnores, config.collection, id)) {
        skipped.push({ collection: config.collection, id });
        continue;
      }
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
  return { entries, byKey, relocated, skipped, folderIgnores };
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
    partial = SERIALIZERS[config.serializer].deserialize(content, config.contentField);
  } catch {
    return null;
  }
  if (!partial || typeof partial !== 'object') {
    return null;
  }
  if (config.serializer === 'markdown') {
    const parts = item.path.split('/');
    const file = parts.pop() ?? '';
    const extension = SERIALIZERS[config.serializer]?.extension ?? 'md';
    const title = typeof item.title === 'string' && item.title.length > 0
      ? item.title
      : file.replace(new RegExp(`\\.${extension}$`, 'i'), '');
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
        [config.contentField]: typeof partial[config.contentField] === 'string' ? partial[config.contentField] : '',
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
    return SERIALIZERS[config.serializer].serialize(stripVolatile(record, config.updatedAtField), config.contentField);
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
 * Fetches one sync round plan: remembers the scope, lists local entries,
 * reads the remote manifest and diffs all three sides. Pure reads, no
 * writes — safe to retry.
 * @param {object} round Round context (storage, configs, adapter,
 *   descriptor, manifestPath, failMapped, report).
 * @returns {object} `{ plan, manifestRead, local }`.
 */
async function fetchRoundPlan(round) {
  const { storage, configs, adapter, report } = round;
  await rememberScope(storage, configs);
  const local = await collectLocal(storage, configs);
  report.relocated.push(...local.relocated);
  report.skipped.push(...local.skipped.map((item) => ({ collection: item.collection, id: item.id })));
  const manifestRead = await readManifest(adapter, round.manifestPath).catch(round.failMapped);
  const remote = withoutIgnored(manifestRead.manifest.records, configs, local.folderIgnores, extensionsOf(configs));
  for (const item of manifestRead.manifest.records) {
    if (!remote.includes(item)) {
      report.skipped.push({ collection: item?.collection ?? null, id: item?.id ?? null });
    }
  }
  const savedBefore = (await store(storage.read(STATE_COLLECTION, BACKEND_ID))) ?? {};
  const snapshot = Array.isArray(savedBefore.snapshot) ? savedBefore.snapshot : [];
  const plan = planSync(snapshot, local.entries, remote);
  report.skipped.push(...plan.skipped.map((item) => ({ collection: item?.collection ?? null, id: item?.id ?? null })));
  return { plan, manifestRead, local };
}

/**
 * Applies one planned round: pushes, pulls, propagates deletions, then
 * rewrites the remote manifest when it changed. Idempotent per item.
 * @param {object} round Round context (see fetchRoundPlan).
 * @param {object} plan Engine plan.
 * @param {object} manifestRead Current `{ manifest, rev }`.
 * @param {object} local Collected local entries.
 * @returns {Promise<void>}
 */
async function applyRoundPlan(round, plan, manifestRead, local) {
  const { storage, configs, adapter, descriptor, report } = round;
  const revs = await readRevs(adapter).catch(round.failMapped);
  for (const item of plan.push) {
    const held = local.byKey.get(`${item.collection}::${item.id}`);
    const content = serializeRecord(configs, item, held?.record);
    await adapter.writeFile(item.path, content, revs.get(item.path) ?? null).catch(round.failMapped);
    report.pushed.push({ collection: item.collection, id: item.id });
  }
  const pulledRecords = [];
  const pruned = [];
  for (const item of plan.pull) {
    const file = await adapter.readFile(item.path).catch(round.failMapped);
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
    await adapter.deleteFile(item.path).catch(round.failMapped);
    report.deletedRemote.push({ collection: item.collection, id: item.id });
  }
  for (const item of plan.deleteLocal) {
    await store(storage.delete(item.collection, item.id));
    report.deleteLocal.push({ collection: item.collection, id: item.id });
  }
  const enriched = await enrichConflicts(storage, configs, adapter, plan.conflicts, local.byKey).catch(round.failMapped);
  report.conflicts.push(...enriched);
  const carried = carryManifest(manifestRead.manifest.records, plan, pulledRecords, pruned);
  const { manifest } = buildManifest(carried);
  // Skip the rewrite when nothing changed: keeps revs stable and repeat
  // runs write-free (idempotent).
  if (JSON.stringify(manifest.records) !== JSON.stringify(manifestRead.manifest.records)) {
    await adapter.writeFile(descriptor.manifestPath ?? MANIFEST_PATH, JSON.stringify(manifest), manifestRead.rev).catch((error) => {
      if (descriptor.revMismatchCode && error?.code === descriptor.revMismatchCode) {
        throw syncError('SYNC_CONCURRENT_CHANGE', 'Remote changed underneath this sync; run again', {});
      }
      throw mapAdapterError(descriptor, error);
    });
  }
}

/**
 * Finalizes one round: advances the snapshot only on clean completion,
 * stamps the report and publishes the outcome.
 * @param {object} state Activation state (event bus).
 * @param {object} storage Storage service.
 * @param {Array} configs Normalized scope.
 * @param {object} plan Engine plan.
 * @param {object} report Mutable report.
 * @returns {object} Completed report.
 */
async function finalizeRound(state, storage, configs, plan, report) {
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
      const manifestPath = descriptor.manifestPath ?? MANIFEST_PATH;
      const failMapped = (error) => {
        throw mapAdapterError(descriptor, error);
      };
      const configs = await readScopeForResolve(storage);
      const manifestRead = await readManifest(adapter, manifestPath).catch(failMapped);
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
        const revs = await readRevs(adapter).catch(failMapped);
        await adapter.writeFile(path, content, revs.get(path) ?? null).catch(failMapped);
        if (before && typeof before.path === 'string' && before.path !== path) {
          await adapter.deleteFile(before.path).catch(failMapped);
        }
        const entry = local.entries.find((item) => item.collection === collection && item.id === id);
        await writeManifestEntry(adapter, descriptor, manifestRead, { ...entry, path });
        await writeSnapshotEntry(storage, saved, { ...entry, path });
      } else {
        const file = conflict.remote ? await adapter.readFile(conflict.remote.path).catch(failMapped) : null;
        if (!file) {
          await writeManifestEntry(adapter, descriptor, manifestRead, null, { collection, id });
          await writeSnapshotEntry(storage, saved, null, { collection, id });
        } else {
          const folderMaps = await loadFolderMaps(storage, configs);
          const built = buildPulledRecord(folderMaps, configs, conflict.remote, file.content);
          if (built) {
            await store(storage.write(built.collection, built.record));
          }
          await writeManifestEntry(adapter, descriptor, manifestRead, conflict.remote);
          await writeSnapshotEntry(storage, saved, {
            collection,
            id,
            updatedAt: conflict.remote.updatedAt,
            path: conflict.remote.path,
          });
        }
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
 * @param {string} manifestPath Engine manifest path on this backend.
 * @returns {object} `{ manifest, rev }`.
 * @throws {object} SYNC_CORRUPT_MANIFEST.
 */
async function readManifest(adapter, manifestPath) {
  const files = await adapter.listDir('');
  const entry = (files ?? []).find((item) => item?.path === manifestPath);
  if (!entry) {
    return { manifest: { version: 1, records: [] }, rev: null };
  }
  const file = await adapter.readFile(manifestPath);
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
  return SERIALIZERS[config.serializer].serialize(record, config.contentField);
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
 * @param {object} descriptor Backend descriptor (manifest path, rev code).
 * @param {object} manifestRead Current `{ manifest, rev }`.
 * @param {object|null} entry Entry to upsert, or null.
 * @param {object|null} drop Entry to drop, or null.
 * @returns {object} Fresh `{ manifest, rev }`.
 * @throws {object} SYNC_CONCURRENT_CHANGE on rev mismatch.
 */
async function writeManifestEntry(adapter, descriptor, manifestRead, entry, drop) {
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
    const written = await adapter.writeFile(descriptor.manifestPath ?? MANIFEST_PATH, JSON.stringify(manifest), manifestRead.rev);
    return { manifest, rev: written.rev };
  } catch (error) {
    if (descriptor.revMismatchCode && error?.code === descriptor.revMismatchCode) {
      throw syncError('SYNC_CONCURRENT_CHANGE', 'Remote changed underneath this sync; run again', {});
    }
    throw mapAdapterError(descriptor, error);
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
 * @param {object} descriptor Backend descriptor.
 * @returns {number} Open conflict count.
 */
async function countRemaining(storage, configs, adapter, descriptor) {
  const manifestRead = await readManifest(adapter, descriptor.manifestPath ?? MANIFEST_PATH).catch((error) => {
    throw mapAdapterError(descriptor, error);
  });
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
