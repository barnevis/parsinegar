// Pure sync decision logic for pey.sync: path-keyed three-way planning
// over the last snapshot, current local state and the live remote
// listing. No I/O, no state, no clock reads — the service supplies
// everything and applies the plan. The sync identity is the remote
// path itself: no manifest, no remote metadata files.

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * Builds the identity key for one record (collection + id).
 * @param {object} entry Entry with collection and id.
 * @returns {string} Stable key.
 */
function ownerOf(entry) {
  return `${entry.collection}::${entry.id}`;
}

/**
 * Checks a local entry carries everything planning needs.
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
    && typeof entry.path === 'string'
    && entry.path.length > 0
    && typeof entry.hash === 'string'
    && entry.hash.length > 0
  );
}

/**
 * Checks a remote listing entry carries everything planning needs. The
 * hash is always supplied by the caller (rev-matched entries borrow the
 * snapshot hash), so planning stays decision-force without fetches.
 * @param {object} entry Candidate listing entry.
 * @returns {boolean} True when usable.
 */
function isListable(entry) {
  return (
    !!entry
    && typeof entry.collection === 'string'
    && entry.collection.length > 0
    && typeof entry.path === 'string'
    && entry.path.length > 0
    && typeof entry.hash === 'string'
    && entry.hash.length > 0
    && (entry.rev === undefined || entry.rev === null || typeof entry.rev === 'string')
  );
}

/**
 * Checks a snapshot entry carries matchable identity. Hash may be null
 * right after a legacy-snapshot migration: an unknown base always ranks
 * as changed on both sides unless local and remote content agree.
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
    && typeof entry.path === 'string'
    && entry.path.length > 0
    && (entry.hash === null || (typeof entry.hash === 'string' && entry.hash.length > 0))
    && (entry.rev === undefined || entry.rev === null || typeof entry.rev === 'string')
  );
}

/**
 * Compares a snapshot against current local state, path-keyed. A moved
 * record reads as a deletion at the old path and a creation at the new
 * one — the same shape the next sync round acts on, so this diff is
 * exactly the local pending set.
 * @param {Array} snapshot Last-synced entries ({collection, id, path, hash}).
 * @param {Array} current Current local entries ({collection, id, path, hash}).
 * @returns {object} `{ created, changed, deleted, skipped }`.
 */
export function snapshotDiff(snapshot, current) {
  const known = new Map();
  const skipped = [];
  for (const entry of snapshot ?? []) {
    if (isSnapshotEntry(entry) && !known.has(entry.path)) {
      known.set(entry.path, entry);
    } else {
      skipped.push(entry);
    }
  }
  const created = [];
  const changed = [];
  const deleted = [];
  const seen = new Set();
  for (const entry of current ?? []) {
    if (!isPlannable(entry)) {
      skipped.push(entry);
      continue;
    }
    if (seen.has(entry.path)) {
      skipped.push(entry);
      continue;
    }
    seen.add(entry.path);
    const before = known.get(entry.path);
    if (!before) {
      created.push(entry);
      continue;
    }
    if (before.hash !== entry.hash) {
      changed.push(entry);
    }
  }
  for (const [path, entry] of known) {
    if (!seen.has(path)) {
      deleted.push({ collection: entry.collection, id: entry.id, path });
    }
  }
  return { created, changed, deleted, skipped };
}

/**
 * Plans one manual sync round from the last snapshot, current local state
 * and the remote listing — all keyed by remote path. Emits push/pull work,
 * both-side deletions and conflicts; never guesses a conflict away. A
 * local rename surfaces as a push at the new path plus a remote deletion
 * at the old one (the old path loses its local occupant). Two local
 * entries travelling to one path are collisions: the plan reports them so
 * the service can fail loudly instead of silently writing one winner.
 * @param {Array} snapshot Last-synced entries ({collection, id, path, hash, rev?}).
 * @param {Array} local Current local entries ({collection, id, path, hash}).
 * @param {Array} remote Remote listing ({collection, path, hash, rev?}).
 * @returns {object} `{ push, pull, deleteRemote, deleteLocal, conflicts,
 *   collisions, skipped }`; push/pull entries carry `{collection, id,
 *   path, hash, rev}` (pull `id` null when nothing local lives there),
 *   deleteRemote carries the last-known remote `{collection, id, path,
 *   rev}`, conflicts `{collection, id, local, remote}` with either side
 *   null on delete-vs-change, collisions `{collection, id, path, otherId}`.
 */
export function planSync(snapshot, local, remote) {
  const snapByPath = new Map();
  const localOwners = new Map();
  const localByPath = new Map();
  const remoteByPath = new Map();
  const skipped = [];
  for (const entry of snapshot ?? []) {
    if (isSnapshotEntry(entry) && !snapByPath.has(entry.path)) {
      snapByPath.set(entry.path, entry);
    } else {
      skipped.push(entry);
    }
  }
  for (const entry of local ?? []) {
    if (!isPlannable(entry)) {
      skipped.push(entry);
      continue;
    }
    if (localByPath.has(entry.path)) {
      skipped.push({ ...entry, collisionWith: localByPath.get(entry.path).id });
      continue;
    }
    localByPath.set(entry.path, entry);
    if (!localOwners.has(ownerOf(entry))) {
      localOwners.set(ownerOf(entry), entry);
    }
  }
  for (const entry of remote ?? []) {
    if (!isListable(entry)) {
      skipped.push(entry);
      continue;
    }
    if (!remoteByPath.has(entry.path)) {
      remoteByPath.set(entry.path, entry);
    } else {
      skipped.push(entry);
    }
  }
  const push = [];
  const pull = [];
  const deleteRemote = [];
  const deleteLocal = [];
  const conflicts = [];
  const collisions = [];
  for (let index = skipped.length - 1; index >= 0; index -= 1) {
    const entry = skipped[index];
    if (entry?.collisionWith) {
      collisions.push({
        collection: entry.collection,
        id: entry.id,
        path: entry.path,
        otherId: entry.collisionWith,
      });
      skipped.splice(index, 1);
    }
  }
  const paths = new Set([...localByPath.keys(), ...remoteByPath.keys(), ...snapByPath.keys()]);
  for (const path of paths) {
    const current = localByPath.get(path) ?? null;
    const listed = remoteByPath.get(path) ?? null;
    const before = snapByPath.get(path) ?? null;
    if (current && listed) {
      if (!before) {
        // Both sides grew the path since the last sync: agreement is a
        // silent convergence, divergence asks.
        if (current.hash !== listed.hash) {
          conflicts.push({ collection: current.collection, id: current.id, local: current, remote: listed });
        }
        continue;
      }
      if (ownerOf(current) !== ownerOf(before)) {
        if (localOwners.has(ownerOf(before))) {
          // The snapshot owner still lives locally somewhere else (it
          // moved): this local record takes the path over and rewrites
          // the file it used to leave behind.
          push.push(current);
        } else {
          // The old owner vanished locally while the remote file stayed:
          // a real ambiguity — the remote content may be the owner's
          // edited version, and the local record may be the owner's
          // rewrite. Asking is the only safe move.
          conflicts.push({ collection: current.collection, id: current.id, local: current, remote: listed });
        }
        continue;
      }
      const localChanged = current.hash !== before.hash;
      const remoteChanged = listed.hash !== before.hash;
      if (!localChanged && !remoteChanged) {
        continue;
      }
      if (localChanged && !remoteChanged) {
        push.push(current);
        continue;
      }
      if (remoteChanged && !localChanged) {
        pull.push({
          collection: listed.collection,
          id: listed.id ?? current.id,
          path,
          hash: listed.hash,
          rev: listed.rev ?? null,
        });
        continue;
      }
      if (current.hash === listed.hash) {
        // Both sides converged to the same content; nothing to do.
        continue;
      }
      conflicts.push({ collection: current.collection, id: current.id, local: current, remote: listed });
      continue;
    }
    if (current && !listed) {
      // Remote dropped the path (or never had it); the local record is
      // new content there. When the snapshot holds a foreign owner, the
      // local record simply took the path over.
      if (!before || before.id !== current.id) {
        push.push(current);
      } else if (current.hash !== before.hash) {
        conflicts.push({ collection: current.collection, id: current.id, local: current, remote: null });
      } else {
        deleteLocal.push({ collection: current.collection, id: current.id, path });
      }
      continue;
    }
    if (!current && listed) {
      if (!before) {
        pull.push({
          collection: listed.collection,
          id: listed.id ?? null,
          path,
          hash: listed.hash,
          rev: listed.rev ?? null,
        });
      } else if (listed.hash !== before.hash) {
        // The local record left the path (deleted, or moved away) while
        // the remote content was edited in the meantime: keep-mine frees
        // the file, take-theirs revives it.
        conflicts.push({ collection: before.collection, id: before.id, local: null, remote: listed });
      } else {
        deleteRemote.push({
          collection: before.collection,
          id: before.id,
          path,
          rev: listed.rev ?? null,
        });
      }
      continue;
    }
    // Local and remote both lost the path: nothing on either side; the
    // snapshot entry drops on the next clean advance.
  }
  return { push, pull, deleteRemote, deleteLocal, conflicts, collisions, skipped };
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

/**
 * Escapes one glob segment to a full-match regex (`*` stays inside its
 * segment, `?` is one non-slash character).
 * @param {string} segment Glob segment.
 * @returns {RegExp} Full-match pattern.
 */
function segmentPattern(segment) {
  let out = '';
  for (const character of segment) {
    if (character === '*') {
      out += '[^/]*';
    } else if (character === '?') {
      out += '[^/]';
    } else {
      out += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

/**
 * Matches path segments against pattern segments (`**` spans zero or more
 * whole segments on either side).
 * @param {Array<string>} patternSegs Pattern segments.
 * @param {Array<string>} pathSegs Path segments.
 * @returns {boolean} True on full match.
 */
function matchSegments(patternSegs, pathSegs) {
  if (patternSegs.length === 0) {
    return pathSegs.length === 0;
  }
  const [head, ...tail] = patternSegs;
  if (head === '**') {
    for (let skip = 0; skip <= pathSegs.length; skip += 1) {
      if (matchSegments(tail, pathSegs.slice(skip))) {
        return true;
      }
    }
    return false;
  }
  if (pathSegs.length === 0 || !segmentPattern(head).test(pathSegs[0])) {
    return false;
  }
  return matchSegments(tail, pathSegs.slice(1));
}

/**
 * Matches one synced path against one pattern, gitignore-style subset:
 * `*`/`?` inside a segment, `**` across segments, a slashless pattern hits
 * any single segment at any depth, and a trailing slash takes the whole
 * subtree. No negation (`!` is literal). Case-sensitive, like the host.
 * @param {string} path Relative synced path.
 * @param {string} pattern Single pattern.
 * @returns {boolean} True when ignored.
 */
function matchOne(path, pattern) {
  const dir = pattern.endsWith('/');
  const base = pattern.replace(/^\/+/, '').replace(/\/+$/, '');
  if (base.length === 0) {
    return false;
  }
  const pathSegs = path.split('/');
  if (!base.includes('/')) {
    const segment = segmentPattern(base);
    return pathSegs.some((part) => segment.test(part));
  }
  const patternSegs = base.split('/');
  if (dir) {
    patternSegs.push('**');
  }
  return matchSegments(patternSegs, pathSegs);
}

/**
 * Reports whether a synced path is ignored by the given patterns. Document
 * paths are matched extension-free (hosts map their own extensions; the
 * default covers the mandated `.md`), falling back to the full path so a
 * typed suffix still hits instead of silently missing.
 * @param {string} path Relative synced path.
 * @param {Array<string>} patterns Ignore patterns.
 * @param {Array<string>} [extensions] Suffixes to strip before matching.
 * @returns {boolean} True when ignored.
 */
export function matchesIgnore(path, patterns, extensions = ['md']) {
  if (typeof path !== 'string' || path.length === 0 || !Array.isArray(patterns)) {
    return false;
  }
  const suffixes = Array.isArray(extensions) && extensions.length > 0 ? extensions : [];
  let stripped = path;
  const lowered = path.toLowerCase();
  for (const extension of suffixes) {
    if (typeof extension !== 'string' || extension.length === 0) {
      continue;
    }
    const suffix = `.${extension.toLowerCase()}`;
    if (lowered.endsWith(suffix) && stripped.length > suffix.length) {
      stripped = stripped.slice(0, -suffix.length);
      break;
    }
  }
  const candidates = stripped !== path ? [stripped, path] : [path];
  for (const raw of patterns) {
    if (typeof raw !== 'string') {
      continue;
    }
    const pattern = raw.trim();
    if (pattern.length === 0) {
      continue;
    }
    if (candidates.some((candidate) => matchOne(candidate, pattern))) {
      return true;
    }
  }
  return false;
}
