// Local entry collection and ignore filtering for pey.sync.
//
// Lists storage records as plan-ready entries (hashes, paths, titles) and
// drops ignored records from every plan input. Reads storage, never the
// network; outage mapping rides the shared store guard.
import { hashRecord, matchesIgnore } from './sync-engine.js';
import { sanitizePathSegment } from './serializers.js';
import { SERIALIZERS, extensionsOf, stripVolatile } from './sync-scope.js';
import { store } from './sync-store.js';
import { folderParts, loadFolderMaps, pathForRecord } from './sync-paths.js';

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
 * @returns {object} `{ entries, byKey, relocated, skipped, folderIgnores }`;
 *   byKey maps `collection::id` to `{ record, config }`.
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

export {
  collectLocal,
  withoutIgnored,
};
