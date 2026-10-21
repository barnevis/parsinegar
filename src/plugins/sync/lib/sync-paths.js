// Folder maps and remote path building for pey.sync.
//
// Resolves folder chains to name parts and places records on remote paths.
// Reads folder records, never sync state; chains pulled from the remote
// are materialized locally so a record keeps its remote address.
import { store } from './sync-store.js';
import { FALLBACK_SEGMENT, sanitizePathSegment } from './serializers.js';
import { SERIALIZERS } from './sync-scope.js';

/**
 * Builds a fresh unique record id (host-independent, no path encoding).
 * @returns {string} Unique id.
 */
function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Creates the missing folder records along a name-chain from the root, so
 * a pulled record can live at its remote address. Existing folders pass
 * untouched; ids mint fresh and rows write straight through the extent
 * guard.
 * @param {object} storage Storage service.
 * @param {object|null} maps Folder maps entry ({ byId, mapping }).
 * @param {object} mapping Folder field mapping ({collection, idField,
 *   nameField, parentField}).
 * @param {Array<string>} parts Name parts from the root.
 * @returns {Promise<object>} `{ byId, mapping }` maps including new rows.
 */
async function ensureFolderChain(storage, maps, mapping, parts) {
  const byId = maps?.byId ?? new Map();
  const working = { byId, mapping };
  const children = indexChildren(working);
  let parentKey = '';
  for (const part of parts) {
    let next = children.get(parentKey)?.get(part);
    if (next === undefined) {
      next = makeId();
      const record = {
        [mapping.idField]: next,
        [mapping.nameField]: part,
        [mapping.parentField]: parentKey === '' ? null : parentKey,
      };
      byId.set(next, record);
      children.get(parentKey)?.set(part, next);
      if (!children.has(next)) {
        children.set(next, new Map());
      }
      await store(storage.write(mapping.collection, record));
    }
    parentKey = next;
  }
  return { byId, mapping };
}

/**
 * Indexes folder records by parent key for walk-order resolution.
 * @param {object} maps Maps entry ({ byId, mapping }).
 * @returns {Map} Parent key to (name to folder id).
 */
function indexChildren(maps) {
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
  return children;
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

export {
  ensureFolderChain,
  folderParts,
  loadFolderMaps,
  makeId,
  pathForRecord,
  resolvePathParts,
};
