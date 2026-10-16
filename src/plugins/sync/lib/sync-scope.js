// Scope validation and per-scope record shaping for pey.sync.
//
// Turns the caller scope into normalized collection configs and shapes
// records through them (serialize one record, extract comparable content,
// drop volatile stamps). Knows field names, never storage or network.
import { syncError } from './error.js';
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
  contentOf,
  extensionsOf,
  normalizeScope,
  serializeRecord,
  stripVolatile,
};
