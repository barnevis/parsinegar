// One sync round for pey.sync: plan, apply, finalize, and single-record
// conflict resolution.
//
// A round collects local state and the attributed remote listing (pure
// reads plus the snapshot migration), applies the plan, then advances the
// snapshot on clean completion; single-record conflict resolution
// replays the same shape. Remote files are read once per round (hash
// fill) and the raw contents ride along for pulls and previews. Reads
// storage and the backend, never the UI.
import { syncError } from './error.js';
import { planSync } from './sync-engine.js';
import { collectLocal, withoutIgnored } from './sync-collect.js';
import { contentOf, extensionsOf, serializeRecord, SERIALIZERS } from './sync-scope.js';
import { loadFolderMaps } from './sync-paths.js';
import {
  buildPulledRecord,
  cleanupLegacyArtifacts,
  hashRemoteFile,
  readRemoteListing,
} from './sync-remote.js';
import {
  BACKEND_ID,
  STATE_COLLECTION,
  advanceSnapshot,
  clearError,
  migrateSnapshot,
  publish,
  rememberScope,
  writeSnapshotEntry,
} from './sync-state.js';
import { store } from './sync-store.js';

/**
 * Gathers one round's inputs: local entries, the attributed remote
 * listing with hashes, the migrated snapshot and the pure plan. Pure
 * reads plus the on-the-spot snapshot migration — safe to retry.
 * @param {object} round Round context (storage, configs, adapter,
 *   descriptor, failMapped, report).
 * @returns {Promise<object>} `{ plan, local, listing, snapshot, contents,
 *   revs }`; contents maps remote paths to their raw read text, revs maps
 *   paths to listing revisions.
 * @throws {object} SYNC_PATH_COLLISION when two local records claim one
 *   path — planning stops before any remote write.
 */
async function captureRoundPlan(round) {
  const { storage, configs, adapter, report } = round;
  await rememberScope(storage, configs);
  const local = await collectLocal(storage, configs);
  report.relocated.push(...local.relocated);
  report.skipped.push(...local.skipped.map((item) => ({ collection: item.collection, id: item.id })));
  const listing = await readRemoteListing(adapter, configs, local.folderIgnores, extensionsOf(configs)).catch(round.failMapped);
  report.skipped.push(...listing.foreign.map((item) => ({ collection: null, id: null, path: item.path })));
  const saved = (await store(storage.read(STATE_COLLECTION, BACKEND_ID))) ?? {};
  const migrated = await migrateSnapshot(storage, saved.snapshot, listing.legacyManifestRecords);
  // Ignored records are out of the plan's jurisdiction entirely: an
  // entry dropping under a fresh ignore pattern must never read as a
  // local deletion to propagate.
  const snapshot = withoutIgnored(migrated.snapshot, configs, local.folderIgnores, extensionsOf(configs));
  const snapByPath = new Map(snapshot.map((entry) => [entry.path, entry]));
  const remote = [];
  const contents = new Map();
  const revs = new Map();
  for (const item of listing.entries) {
    if (typeof item.rev === 'string') {
      revs.set(item.path, item.rev);
    }
    const before = snapByPath.get(item.path);
    let hash;
    if (typeof item.rev === 'string' && before && typeof before.rev === 'string' && item.rev === before.rev) {
      // Revision shortcut: the listing signature equals the one already
      // hashed last round, so the remote bytes are unchanged.
      hash = before.hash;
    } else {
      const hashed = await hashRemoteFile(adapter, configs, item.collection, item.path, item.rev).catch(round.failMapped);
      if (!hashed || typeof hashed.hash !== 'string') {
        // Gone mid-round, or irrelevant to this serializer: not a plan
        // entry, reported as skipped and never touched.
        report.skipped.push({ collection: item.collection, id: item.id ?? null, path: item.path });
        continue;
      }
      hash = hashed.hash;
      contents.set(item.path, hashed.content);
      if (typeof hashed.rev === 'string') {
        revs.set(item.path, hashed.rev);
      }
    }
    remote.push({
      collection: item.collection,
      id: item.id ?? null,
      path: item.path,
      hash,
      rev: item.rev ?? null,
    });
  }
  const plan = planSync(snapshot, local.entries, remote);
  if (plan.collisions.length > 0) {
    throw syncError('SYNC_PATH_COLLISION', 'Two local records claim the same remote path', {
      collection: plan.collisions[0].collection,
      path: plan.collisions[0].path,
      ids: plan.collisions.map((item) => item.id),
    });
  }
  report.skipped.push(...plan.skipped.map((item) => ({ collection: item?.collection ?? null, id: item?.id ?? null })));
  return { plan, local, listing, snapshot, contents, revs };
}

/**
 * Applies one planned round: pushes, pulls, propagates deletions, then
 * enriches conflicts with both-side content. No remote metadata writes
 * exist; every remote touch is a planned file. Idempotent per item.
 * @param {object} round Round context (see captureRoundPlan).
 * @param {object} context Gathering result.
 * @returns {Promise<void>}
 */
async function applyRoundPlan(round, context) {
  const { storage, configs, adapter, report } = round;
  const { plan, local, contents, revs } = context;
  for (const item of plan.push) {
    const held = local.byKey.get(`${item.collection}::${item.id}`);
    const content = serializeRecord(configs, item, held?.record);
    const written = await adapter.writeFile(item.path, content, revs.get(item.path) ?? null).catch(round.failMapped);
    if (written?.rev) {
      revs.set(item.path, written.rev);
    }
    report.pushed.push({ collection: item.collection, id: item.id });
  }
  for (const item of plan.pull) {
    let content = contents.get(item.path) ?? null;
    if (typeof content !== 'string') {
      const file = await adapter.readFile(item.path).catch(round.failMapped);
      content = file?.content ?? null;
    }
    if (typeof content !== 'string') {
      report.skipped.push({ collection: item.collection, id: item.id ?? null, path: item.path });
      continue;
    }
    // Folder maps reload per item: earlier pulls in this same loop may
    // have just created the folders this path resolves through.
    const folderMaps = await loadFolderMaps(storage, configs);
    const built = await buildPulledRecord(storage, folderMaps, configs, item, content, Date.now());
    if (!built) {
      report.skipped.push({ collection: item.collection, id: item.id ?? null, path: item.path });
      continue;
    }
    await store(storage.write(built.collection, built.record));
    report.pulled.push({ collection: built.collection, id: built.record.id });
  }
  for (const item of plan.deleteRemote) {
    await adapter.deleteFile(item.path, item.rev ?? null).catch(round.failMapped);
    report.deletedRemote.push({ collection: item.collection, id: item.id });
  }
  for (const item of plan.deleteLocal) {
    await store(storage.delete(item.collection, item.id));
    report.deleteLocal.push({ collection: item.collection, id: item.id });
  }
  const enriched = await enrichConflicts(round, context).catch(round.failMapped);
  report.conflicts.push(...enriched);
}

/**
 * Enriches conflicts with both-side content for the host prompt, reading
 * remote text straight from the round's own hash-fill reads.
 * @param {object} round Round context.
 * @param {object} context Gathering result.
 * @returns {Promise<Array>} Enriched conflicts shaped `{ collection, id,
 *   title, local: {content, updatedAt}|null, remote: {content}|null }`.
 */
async function enrichConflicts(round, context) {
  const { configs } = round;
  const { plan, local, contents } = context;
  const enriched = [];
  for (const conflict of plan.conflicts) {
    const held = local.byKey.get(`${conflict.collection}::${conflict.id}`);
    const config = configs.find((entry) => entry.collection === conflict.collection);
    const remoteContent = conflict.remote ? (contents.get(conflict.remote.path) ?? '') : '';
    enriched.push({
      collection: conflict.collection,
      id: conflict.id,
      title: titleOf(config, held?.record, conflict.remote),
      local: conflict.local ? {
        updatedAt: held?.record?.[config?.updatedAtField ?? 'updatedAt'] ?? null,
        content: held ? contentOf(configs, conflict.collection, held.record) : '',
      } : null,
      remote: conflict.remote ? {
        content: remoteContent,
      } : null,
    });
  }
  return enriched;
}

/**
 * Picks the display title: the local record's own title, else the remote
 * file name with the serializer extension stripped.
 * @param {object|null} config Normalized collection config.
 * @param {object|null} record Held local record.
 * @param {object|null} remote Remote entry.
 * @returns {string} Display title.
 */
function titleOf(config, record, remote) {
  const name = record?.[config?.titleField ?? 'title'];
  if (typeof name === 'string' && name.length > 0) {
    return name;
  }
  if (remote && typeof remote.path === 'string') {
    const extension = SERIALIZERS[config?.serializer]?.extension;
    if (typeof extension === 'string') {
      const fileName = remote.path.slice(remote.path.lastIndexOf('/') + 1);
      const suffix = `.${extension}`;
      if (fileName.toLowerCase().endsWith(suffix) && fileName.length > suffix.length) {
        return fileName.slice(0, -suffix.length);
      }
    }
    return remote.path.slice(remote.path.lastIndexOf('/') + 1);
  }
  return '|';
}

/**
 * Finalizes one round: advances the snapshot only on clean completion,
 * sweeps the legacy 0.2.0 artifacts, stamps the report and publishes the
 * outcome.
 * @param {object} state Activation state (event bus).
 * @param {object} storage Storage service.
 * @param {object} adapter Backend adapter (legacy artifact sweep).
 * @param {Array} configs Normalized scope.
 * @param {object} context Gathering result.
 * @param {object} report Mutable report.
 * @returns {object} Completed report.
 */
async function finalizeRound(state, storage, adapter, configs, context, report) {
  const clean = context.plan.conflicts.length === 0;
  if (clean) {
    await advanceSnapshot(storage, configs, context.revs);
    await clearError(storage);
    await cleanupLegacyArtifacts(adapter, context.listing.legacyManifestRecords);
  }
  report.completed = clean;
  publish(state, 'sync:changed', {
    pushed: report.pushed,
    pulled: report.pulled,
    conflicts: report.conflicts.map((conflict) => ({ collection: conflict.collection, id: conflict.id })),
  });
  if (!clean) {
    publish(state, 'sync:conflicts', {
      conflicts: report.conflicts.map((conflict) => ({ collection: conflict.collection, id: conflict.id })),
    });
  }
  return report;
}

/**
 * Applies the local side of one conflict: pushes it (freeing the old
 * path when the record moved mid-staleness), then pins the snapshot.
 * @param {object} round Round context.
 * @param {object} context Gathering result.
 * @param {object} saved Stored state record.
 * @param {object|null} before Snapshot entry, if any.
 * @param {string} collection Record collection.
 * @param {string} id Record id.
 * @returns {Promise<void>}
 * @throws {object} SYNC_INVALID_CONFIG when the record vanished mid-run.
 */
async function applyLocalResolution(round, context, saved, before, collection, id) {
  const { configs, adapter } = round;
  const local = context.local;
  const held = local.byKey.get(`${collection}::${id}`);
  const entry = local.entries.find((item) => item.collection === collection && item.id === id);
  if (!entry) {
    throw syncError('SYNC_INVALID_CONFIG', 'Local record vanished mid-resolution', { collection, id });
  }
  const content = serializeRecord(configs, entry, held?.record);
  const written = await adapter.writeFile(entry.path, content, context.revs.get(entry.path) ?? null).catch(round.failMapped);
  if (written?.rev) {
    context.revs.set(entry.path, written.rev);
  }
  if (before && typeof before.path === 'string' && before.path !== entry.path) {
    await adapter.deleteFile(before.path, context.revs.get(before.path) ?? null).catch(round.failMapped);
  }
  await writeSnapshotEntry(round.storage, saved, {
    collection,
    id,
    path: entry.path,
    hash: entry.hash,
    rev: written?.rev ?? context.revs.get(entry.path) ?? null,
  });
}

/**
 * Applies the remote side of one conflict: adopts it locally (or drops a
 * vanished path), then pins the snapshot.
 * @param {object} round Round context.
 * @param {object} context Gathering result.
 * @param {object} conflict Engine conflict with the remote entry.
 * @param {string} collection Record collection.
 * @param {string} id Record id.
 * @returns {Promise<void>}
 */
async function applyRemoteResolution(round, context, conflict, collection, id) {
  const { storage, configs } = round;
  const saved = (await store(storage.read(STATE_COLLECTION, BACKEND_ID))) ?? {};
  const remote = conflict.remote ?? null;
  if (!remote) {
    await writeSnapshotEntry(storage, saved, null, { collection, id });
    return;
  }
  let content = context.contents.get(remote.path) ?? null;
  if (typeof content !== 'string') {
    const file = await round.adapter.readFile(remote.path).catch(round.failMapped);
    content = file?.content ?? null;
  }
  if (typeof content !== 'string') {
    await writeSnapshotEntry(storage, saved, null, { collection, id });
    return;
  }
  const folderMaps = await loadFolderMaps(storage, configs);
  const built = await buildPulledRecord(storage, folderMaps, configs, {
    collection: remote.collection,
    id: conflict.id,
    path: remote.path,
  }, content, Date.now());
  if (built) {
    await store(storage.write(built.collection, built.record));
  }
  await writeSnapshotEntry(storage, saved, {
    collection,
    id,
    path: remote.path,
    hash: remote.hash,
    rev: remote.rev ?? null,
  });
}

export {
  applyLocalResolution,
  applyRemoteResolution,
  applyRoundPlan,
  captureRoundPlan,
  finalizeRound,
};
