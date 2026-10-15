// Pure sync decision logic for pey.sync: snapshot diffing, three-way
// planning, manifest build/parse and content hashing. No I/O, no state,
// no clock reads — the service supplies everything and applies the plan.

const MANIFEST_VERSION = 1;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * Builds the join key for one entry.
 * @param {object} entry Entry with collection and id.
 * @returns {string} Stable key.
 */
function keyOf(entry) {
  return `${entry.collection}::${entry.id}`;
}

/**
 * Checks a local/remote entry carries the fields planning needs.
 * @param {object} entry Candidate entry.
 * @returns {boolean} True when usable.
 */
function isPlannable(entry) {
  return (
    !!entry
    && typeof entry.collection === 'string'
    && entry.collection.length > 0
    && typeof entry.id === 'string'
    && entry.id.length > 0
    && typeof entry.updatedAt === 'number'
    && Number.isFinite(entry.updatedAt)
    && typeof entry.hash === 'string'
    && entry.hash.length > 0
    && typeof entry.path === 'string'
    && entry.path.length > 0
  );
}

/**
 * Checks a snapshot entry carries matchable identity.
 * @param {object} entry Candidate entry.
 * @returns {boolean} True when usable.
 */
function isSnapshotEntry(entry) {
  return (
    !!entry
    && typeof entry.collection === 'string'
    && entry.collection.length > 0
    && typeof entry.id === 'string'
    && entry.id.length > 0
  );
}

/**
 * Indexes entries by join key, collecting malformed ones aside.
 * @param {Array} entries Candidate entries.
 * @param {Function} isValid Validity predicate.
 * @returns {object} `{ byKey, skipped }`.
 */
function indexEntries(entries, isValid) {
  const byKey = new Map();
  const skipped = [];
  for (const entry of entries ?? []) {
    if (isValid(entry)) {
      byKey.set(keyOf(entry), entry);
    } else {
      skipped.push(entry);
    }
  }
  return { byKey, skipped };
}

/**
 * Compares a snapshot against current local state: created, updated,
 * deleted and moved (path changed) entries. A path change reports as a
 * move only — the push of the full content covers it.
 * @param {Array} snapshot Last-synced entries ({collection, id, updatedAt, path?}).
 * @param {Array} current Current entries (same shape).
 * @returns {object} `{ created, updated, deleted, moved, skipped }`; moved
 *   entries carry `{ collection, id, from, to }`, deleted `{ collection, id }`.
 */
export function snapshotDiff(snapshot, current) {
  const known = indexEntries(snapshot, isSnapshotEntry).byKey;
  const { byKey: now, skipped } = indexEntries(current, isSnapshotEntry);
  const created = [];
  const updated = [];
  const deleted = [];
  const moved = [];
  for (const [key, entry] of now) {
    const before = known.get(key);
    if (!before) {
      created.push(entry);
      continue;
    }
    if (typeof before.path === 'string' && typeof entry.path === 'string' && before.path !== entry.path) {
      moved.push({ collection: entry.collection, id: entry.id, from: before.path, to: entry.path });
    } else if (entry.updatedAt !== before.updatedAt) {
      updated.push(entry);
    }
  }
  for (const [key, entry] of known) {
    if (!now.has(key)) {
      deleted.push({ collection: entry.collection, id: entry.id });
    }
  }
  return { created, updated, deleted, moved, skipped };
}

/**
 * Plans one manual sync round from the last snapshot, current local state
 * and the remote manifest. Emits push/pull work, both-side deletions and
 * conflicts — never guesses a conflict away. A local rename surfaces as
 * push plus remote-old-path deletion, driven by the serializer paths the
 * service attaches; a divergence on one side while the other side dropped
 * the record is always a conflict, never a silent win.
 * @param {Array} snapshot Last-synced entries ({collection, id, updatedAt, path?}).
 * @param {Array} local Current local entries ({collection, id, updatedAt, hash, path}).
 * @param {Array} remote Remote manifest entries ({collection, id, updatedAt, path, hash}).
 * @returns {object} `{ push, pull, deleteRemote, deleteLocal, conflicts, skipped }`;
 *   deleteRemote entries carry the last-known remote `{ collection, id, path }`,
 *   conflicts `{ collection, id, local, remote }` with either side null on
 *   delete-vs-change.
 */
export function planSync(snapshot, local, remote) {
  const known = indexEntries(snapshot, isSnapshotEntry).byKey;
  const localIndex = indexEntries(local, isPlannable);
  const remoteIndex = indexEntries(remote, isPlannable);
  const push = [];
  const pull = [];
  const deleteRemote = [];
  const deleteLocal = [];
  const conflicts = [];
  const skipped = [...localIndex.skipped, ...remoteIndex.skipped];
  const keys = new Set([...localIndex.byKey.keys(), ...remoteIndex.byKey.keys()]);
  for (const key of keys) {
    const current = localIndex.byKey.get(key);
    const listed = remoteIndex.byKey.get(key);
    const before = known.get(key);
    if (current && !listed) {
      if (!before) {
        push.push(current);
      } else if (diverged(current, before)) {
        conflicts.push({ collection: current.collection, id: current.id, local: current, remote: null });
      } else {
        deleteLocal.push({ collection: current.collection, id: current.id });
      }
      continue;
    }
    if (listed && !current) {
      if (!before) {
        pull.push(listed);
      } else if (diverged(listed, before)) {
        conflicts.push({ collection: listed.collection, id: listed.id, local: null, remote: listed });
      } else {
        deleteRemote.push({ collection: listed.collection, id: listed.id, path: listed.path });
      }
      continue;
    }
    if (current && listed) {
      const localChanged = !before || current.updatedAt !== before.updatedAt || movedAside(current.path, before.path);
      const remoteChanged = !before || listed.updatedAt !== before.updatedAt || movedAside(listed.path, before.path);
      if (!localChanged && !remoteChanged) {
        continue;
      }
      if (localChanged && !remoteChanged) {
        push.push(current);
        if (before && typeof before.path === 'string' && current.path !== before.path) {
          deleteRemote.push({ collection: current.collection, id: current.id, path: before.path });
        }
        continue;
      }
      if (remoteChanged && !localChanged) {
        pull.push(listed);
        continue;
      }
      if (current.hash === listed.hash) {
        continue;
      }
      conflicts.push({ collection: current.collection, id: current.id, local: current, remote: listed });
    }
  }
  return { push, pull, deleteRemote, deleteLocal, conflicts, skipped };
}

/**
 * Reports whether an entry diverged from its snapshot (content stamp or,
 * when both paths are known, location).
 * @param {object} entry Current entry.
 * @param {object} before Snapshot entry.
 * @returns {boolean} True when changed or moved.
 */
function diverged(entry, before) {
  return entry.updatedAt !== before.updatedAt || movedAside(entry.path, before.path);
}

/**
 * Reports a location change when both paths are known strings.
 * @param {unknown} path Current path.
 * @param {unknown} before Snapshot path.
 * @returns {boolean} True on a real move.
 */
function movedAside(path, before) {
  return typeof path === 'string' && typeof before === 'string' && path !== before;
}

/**
 * Checks one manifest record carries every field sync needs. Title rides
 * along as opaque host metadata (round-trip fidelity for name-derived
 * paths) and is never interpreted here.
 * @param {object} entry Candidate record.
 * @returns {boolean} True when usable.
 */
function isManifestRecord(entry) {
  return (
    !!entry
    && typeof entry.collection === 'string'
    && entry.collection.length > 0
    && typeof entry.id === 'string'
    && entry.id.length > 0
    && typeof entry.path === 'string'
    && entry.path.length > 0
    && typeof entry.updatedAt === 'number'
    && Number.isFinite(entry.updatedAt)
    && typeof entry.hash === 'string'
    && entry.hash.length > 0
    && (entry.title === undefined || entry.title === null || typeof entry.title === 'string')
  );
}

/**
 * Builds a remote manifest from validated records.
 * @param {Array} records Manifest records.
 * @returns {object} `{ manifest: { version, records }, skipped }`.
 */
export function buildManifest(records) {
  const valid = [];
  const skipped = [];
  for (const entry of records ?? []) {
    if (isManifestRecord(entry)) {
      valid.push({
        collection: entry.collection,
        id: entry.id,
        path: entry.path,
        updatedAt: entry.updatedAt,
        hash: entry.hash,
        title: typeof entry.title === 'string' ? entry.title : null,
      });
    } else {
      skipped.push(entry);
    }
  }
  return { manifest: { version: MANIFEST_VERSION, records: valid }, skipped };
}

/**
 * Parses and validates a remote manifest. Structural failure returns null
 * (the service maps it to SYNC_CORRUPT_MANIFEST); single bad records are
 * skipped, never fatal.
 * @param {unknown} data Decoded remote payload.
 * @returns {object|null} `{ manifest: { version, records }, skipped }` or null.
 */
export function parseManifest(data) {
  if (!data || typeof data !== 'object' || data.version !== MANIFEST_VERSION || !Array.isArray(data.records)) {
    return null;
  }
  const valid = [];
  const skipped = [];
  for (const entry of data.records) {
    if (isManifestRecord(entry)) {
      valid.push({
        collection: entry.collection,
        id: entry.id,
        path: entry.path,
        updatedAt: entry.updatedAt,
        hash: entry.hash,
        title: typeof entry.title === 'string' ? entry.title : null,
      });
    } else {
      skipped.push(entry);
    }
  }
  return { manifest: { version: data.version, records: valid }, skipped };
}

/**
 * Hashes file content for change comparison (FNV-1a, synchronous).
 * @param {string} content Serialized file content.
 * @returns {string} Eight hex characters.
 * @throws {TypeError} When content is not a string.
 */
export function hashRecord(content) {
  if (typeof content !== 'string') {
    throw new TypeError('hashRecord requires a string');
  }
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
