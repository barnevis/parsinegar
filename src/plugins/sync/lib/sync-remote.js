// Remote listing/file IO and pulled-record shaping for pey.sync.
//
// Talks to the backend adapter (list/read files, targeted writes) and
// shapes what comes back into storage records. The remote side owns no
// metadata: the file listing itself is the truth, hashed lazily on the
// local comparable basis. Knows remote paths, never local storage layout
// beyond the folder maps it is handed.
import { withoutIgnored } from './sync-collect.js';
import { attributePath, pathEncodedId, remoteHash, SERIALIZERS } from './sync-scope.js';
import { ensureFolderChain, makeId, resolvePathParts } from './sync-paths.js';

const LEGACY_MANIFEST_PATH = 'sync-manifest.json';

/**
 * Lists the remote tree and attributes every file path to a scope
 * collection. Foreign paths (no collection owns them) come back in
 * `foreign` so the caller can report them untouched; ignored paths are
 * dropped exactly like local ignored records. A legacy 0.2.0 manifest
 * found on the tree is read wholesale and handed over for migration and
 * cleanup; a corrupt or missing one is just absent — never a failure.
 * @param {object} adapter Backend adapter.
 * @param {Array} configs Normalized scope.
 * @param {Map} folderIgnores Folders collection name to ignore context.
 * @param {Array<string>} extensions Serializer extensions for matching.
 * @returns {Promise<object>} `{ entries, foreign, legacyManifestRecords }`;
 *   entries `{collection, id, path, rev}` (id null for path-minted pulls),
 *   foreign `{path}`.
 * @throws {object} Mapped SYNC error.
 */
async function readRemoteListing(adapter, configs, folderIgnores, extensions) {
  const files = await adapter.listDir('');
  const attributed = [];
  const foreign = [];
  let legacyManifestRecords = null;
  for (const file of files ?? []) {
    if (!file || typeof file.path !== 'string' || file.path.length === 0) {
      continue;
    }
    if (file.path === LEGACY_MANIFEST_PATH) {
      const raw = await adapter.readFile(LEGACY_MANIFEST_PATH).catch(() => null);
      if (raw && typeof raw.content === 'string') {
        try {
          const parsed = JSON.parse(raw.content);
          if (parsed && typeof parsed === 'object' && parsed.version === 1 && Array.isArray(parsed.records)) {
            legacyManifestRecords = parsed.records;
          }
        } catch {
          // A corrupt legacy manifest stays in place but is not a sync
          // failure: nothing references it meaningfully anymore.
        }
      }
      continue;
    }
    const config = attributePath(file.path, configs);
    if (!config) {
      foreign.push({ path: file.path });
      continue;
    }
    attributed.push({
      collection: config.collection,
      id: pathEncodedId(config, file.path),
      path: file.path,
      rev: file.rev ?? null,
    });
  }
  const entries = withoutIgnored(attributed, configs, folderIgnores, extensions);
  const kept = new Set(entries);
  for (const item of attributed) {
    if (!kept.has(item)) {
      foreign.push({ path: item.path });
    }
  }
  return { entries, foreign, legacyManifestRecords };
}

/**
 * Hashes one remote file on the local comparable basis.
 * @param {object} adapter Backend adapter.
 * @param {Array} configs Normalized scope.
 * @param {string} collection Attributed collection.
 * @param {string} path Remote path.
 * @param {string|null} revKnown Listing revision.
 * @returns {Promise<object|null>} `{ hash, rev, content }`, or null when
 *   the file is absent or undecodable for this serializer.
 * @throws {object} Adapter errors pass through for the caller to map.
 */
async function hashRemoteFile(adapter, configs, collection, path, revKnown) {
  const file = await adapter.readFile(path);
  if (!file || typeof file.content !== 'string') {
    return null;
  }
  return {
    hash: remoteHash(configs, collection, file.content),
    rev: file.rev ?? revKnown ?? null,
    content: file.content,
  };
}

/**
 * Builds a pulled record from a remote file: the path owns title and
 * folder chain (plus the json identity), the file owns content. Text
 * serializers without any local occupant mint their record id here.
 * Missing folder rows along the chain are created on the fly so the
 * record keeps its remote address.
 * @param {object} storage Storage service (folder chain creation).
 * @param {Map} folders Folder maps by collection name.
 * @param {Array} configs Normalized scope.
 * @param {object} item Pull entry `{collection, id, path}`.
 * @param {string} content File text.
 * @param {number} stampedAt Clock stamp for the pulled record.
 * @returns {Promise<object|null>} `{ collection, record }`, or null when
 *   the payload cannot shape into a record.
 */
async function buildPulledRecord(storage, folders, configs, item, content, stampedAt) {
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
    let folderId = null;
    const parts = item.path.split('/');
    parts.pop();
    if (config.folders && parts.length > 0) {
      const maps = folders.get(config.folders.collection) ?? null;
      const ensured = await ensureFolderChain(storage, maps, config.folders, parts);
      const resolved = resolvePathParts(ensured, parts);
      folderId = resolved.folderId;
    }
    return {
      collection: item.collection,
      record: {
        // Text serializers mint identity at apply time: the engine
        // cannot name a record that has never lived locally, and the
        // storage key (IndexedDB keyPath) rejects a null id.
        [config.idField]: item.id ?? makeId(),
        [config.titleField]: titleFromPath(config, item.path),
        [config.folders?.folderField ?? 'folderId']: folderId,
        [config.contentField]: typeof partial[config.contentField] === 'string' ? partial[config.contentField] : '',
        [config.updatedAtField]: stampedAt,
      },
    };
  }
  if (typeof partial[config.idField] !== 'undefined' && String(partial[config.idField]) !== String(item.id)) {
    // Path-encoded identity wins over the payload: a foreign file that
    // claims another id does not belong to this path.
    return null;
  }
  return {
    collection: item.collection,
    record: {
      ...partial,
      [config.idField]: item.id,
      [config.updatedAtField]: stampedAt,
    },
  };
}

/**
 * Derives the record title from the file name (extension stripped).
 * @param {object} config Normalized collection config.
 * @param {string} path Remote path.
 * @returns {string} Title.
 */
function titleFromPath(config, path) {
  const fileName = path.slice(path.lastIndexOf('/') + 1);
  const suffix = `.${SERIALIZERS[config.serializer]?.extension ?? 'md'}`;
  return fileName.toLowerCase().endsWith(suffix) && fileName.length > suffix.length
    ? fileName.slice(0, -suffix.length)
    : fileName;
}

/**
 * Removes the legacy 0.2.0-era artifacts from the remote: the manifest
 * and the folder-record files it referenced. Referenced-only heuristic —
 * never a glob — so an unrelated `folders/…` file from the host is never
 * deleted. Best effort: failures never fail the round.
 * @param {object} adapter Backend adapter.
 * @param {Array|null} legacyManifestRecords Legacy manifest records.
 * @returns {Promise<void>}
 */
async function cleanupLegacyArtifacts(adapter, legacyManifestRecords) {
  if (!Array.isArray(legacyManifestRecords)) {
    return;
  }
  const targets = [];
  for (const record of legacyManifestRecords) {
    if (record && record.collection === 'folders' && typeof record.path === 'string' && record.path.length > 0) {
      targets.push(record.path);
    }
  }
  for (const path of [...targets, LEGACY_MANIFEST_PATH]) {
    try {
      await adapter.deleteFile(path);
    } catch {
      // A leftover artifact is not worth failing the round for.
    }
  }
}

export {
  LEGACY_MANIFEST_PATH,
  buildPulledRecord,
  cleanupLegacyArtifacts,
  hashRemoteFile,
  readRemoteListing,
};
