// Remote manifest/file IO and pulled-record shaping for pey.sync.
//
// Talks to the backend adapter (list/read/write files, engine manifest)
// and shapes what comes back into storage records. Knows remote paths,
// never local storage layout beyond the passed folder maps.
import { buildManifest, parseManifest } from './sync-engine.js';
import { syncError } from './error.js';
import { SERIALIZERS, contentOf } from './sync-scope.js';
import { mapAdapterError } from './sync-backend.js';
import { resolvePathParts } from './sync-paths.js';

const MANIFEST_PATH = 'sync-manifest.json';

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

export {
  MANIFEST_PATH,
  buildPulledRecord,
  carryManifest,
  enrichConflicts,
  readManifest,
  readRevs,
  writeManifestEntry,
};
