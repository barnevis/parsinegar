// Scope validation and per-scope record shaping for pey.sync.
//
// Turns the caller scope into normalized collection configs and shapes
// records through them (serialize one record, extract comparable content,
// drop volatile stamps). Knows field names, never storage or network.
import { syncError } from './error.js';
import { hashRecord } from './sync-engine.js';
import { json, markdown } from './serializers.js';

const SERIALIZERS = { json, markdown };

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
    // Remote file placement: explicit basePath wins; json collections
    // default to their own directory (path-encoded identity), text
    // serializers default to the repo root.
    let basePath = typeof entry.basePath === 'string' ? entry.basePath.trim() : '';
    basePath = basePath.replace(/^\/+|\/+$/g, '');
    if (basePath.length === 0 && entry.basePath === undefined && SERIALIZERS[serializer].extension === 'json') {
      basePath = entry.collection;
    }
    return {
      collection: entry.collection,
      idField: entry.idField ?? 'id',
      updatedAtField: entry.updatedAtField ?? 'updatedAt',
      serializer,
      basePath,
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
 * Reports whether a path ends with one serializer extension. Case
 * sensitive and not case-sensitive: Windows and Gate exports rarely agree
 * (e.g. when writing telephone numbers from another device).
 * @param {string} path Remote path.
 * @param {string} extension Serializer extension without dot.
 * @returns {boolean} True when matching.
 */
function matchesExtension(path, extension) {
  const suffix = `.${extension.toLowerCase()}`;
  return typeof path === 'string' && path.length > suffix.length
    && path.toLowerCase().endsWith(suffix);
}

/**
 * Attributes one remote file path to a scope collection. Candidates must
 * carry the serializer extension and live inside the collection basePath
 * (json identity lives in `<collection>/…`); when deeper bases contend,
 * the deepest unique one wins — nests belong to nested collections, and
 * equally deep contention stays unattributed. Root-based collections only
 * claim extensions nobody deeper owns, so unowned files stay untouched.
 * @param {string} path Remote path.
 * @param {Array} configs Normalized scope.
 * @returns {object|null} Matching collection config, or null for foreign files.
 */
function attributePath(path, configs) {
  const candidates = (configs ?? []).filter((config) => {
    const serializer = SERIALIZERS[config.serializer];
    if (!serializer || !matchesExtension(path, serializer.extension)) {
      return false;
    }
    if (config.basePath === '') {
      return true;
    }
    return path.startsWith(`${config.basePath}/`);
  });
  const deepest = Math.max(0, ...candidates.map((config) => (config.basePath === '' ? 0 : config.basePath.split('/').length)));
  const winners = candidates.filter((config) => (config.basePath === '' ? 0 : config.basePath.split('/').length) === deepest);
  return winners.length === 1 ? winners[0] : null;
}

/**
 * Extracts the record id encoded in a remote file path for path-atomic
 * serializers (json: `<base>/<id>.json`). Text serializers have no
 * path-encoded identity — their ids are minted on pull.
 * @param {object} config Normalized collection config.
 * @param {string} path Remote path.
 * @returns {string|null} Record id, or null when nothing is encoded.
 */
function pathEncodedId(config, path) {
  if (config.serializer !== 'json') {
    return null;
  }
  const extension = SERIALIZERS[config.serializer].extension;
  const base = path.slice(config.basePath === '' ? 0 : config.basePath.length + 1);
  const file = base.slice(base.lastIndexOf('/') + 1);
  const suffix = `.${extension}`;
  return file.length > suffix.length && file.toLowerCase().endsWith(suffix)
    ? file.slice(0, -suffix.length)
    : null;
}

/**
 * Hashes a remote file on the local comparable basis: records land as
 * serialized bytes with a volatile stamp; stripping it and re-expanding
 * (the round-trip serializer) yields exactly the same hash as the same
 * record coming in locally. A file this scope cannot decode never counts.
 * @param {Array} configs Normalized scope.
 * @param {string} collection Collection name.
 * @param {string} content Raw remote file text.
 * @returns {string|null} Stable hash, or null when undecodable.
 */
function remoteHash(configs, collection, content) {
  const config = (configs ?? []).find((entry) => entry.collection === collection);
  if (!config || typeof content !== 'string') {
    return null;
  }
  try {
    const partial = SERIALIZERS[config.serializer].deserialize(content, config.contentField);
    if (!partial || typeof partial !== 'object') {
      return null;
    }
    return hashRecord(SERIALIZERS[config.serializer].serialize(stripVolatile(partial, config.updatedAtField), config.contentField));
  } catch {
    return null;
  }
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

export {
  SERIALIZERS,
  attributePath,
  contentOf,
  extensionsOf,
  normalizeScope,
  pathEncodedId,
  remoteHash,
  serializeRecord,
  stripVolatile,
};
