// One sync round for pey.sync: plan, apply, finalize.
//
// A round reads (fetch), writes (apply), then stamps the outcome
// (finalize); single-record conflict resolution replays the same apply
// shape. Reads storage and the backend, never the UI.
import { buildManifest, planSync } from './sync-engine.js';
import { syncError } from './error.js';
import { collectLocal, withoutIgnored } from './sync-collect.js';
import { loadFolderMaps } from './sync-paths.js';
import {
  MANIFEST_PATH,
  buildPulledRecord,
  carryManifest,
  enrichConflicts,
  readManifest,
  readRevs,
  writeManifestEntry,
} from './sync-remote.js';
import { extensionsOf, serializeRecord } from './sync-scope.js';
import { mapAdapterError } from './sync-backend.js';
import {
  BACKEND_ID,
  STATE_COLLECTION,
  advanceSnapshot,
  clearError,
  publish,
  rememberScope,
  writeSnapshotEntry,
} from './sync-state.js';
import { store } from './sync-store.js';

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

/**
 * Applies the local side of one conflict: pushes it, clears the old path,
 * then advances manifest and snapshot for that record.
 * @param {object} round Round context (storage, configs, adapter,
 *   descriptor, failMapped).
 * @param {object} local Collected local entries.
 * @param {object} manifestRead Current `{ manifest, rev }`.
 * @param {object} saved Stored state record.
 * @param {object} before Snapshot entry, if any.
 * @param {string} collection Record collection.
 * @param {string} id Record id.
 * @returns {Promise<void>}
 * @throws {object} SYNC_INVALID_CONFIG when the record vanished mid-run.
 */
async function applyLocalResolution(round, local, manifestRead, saved, before, collection, id) {
  const { storage, configs, adapter, descriptor } = round;
  const held = local.byKey.get(`${collection}::${id}`);
  const content = serializeRecord(configs, { collection, id }, held?.record);
  const path = local.entries.find((item) => item.collection === collection && item.id === id)?.path;
  if (!path) {
    throw syncError('SYNC_INVALID_CONFIG', 'Local record vanished mid-resolution', { collection, id });
  }
  const revs = await readRevs(adapter).catch(round.failMapped);
  await adapter.writeFile(path, content, revs.get(path) ?? null).catch(round.failMapped);
  if (before && typeof before.path === 'string' && before.path !== path) {
    await adapter.deleteFile(before.path).catch(round.failMapped);
  }
  const entry = local.entries.find((item) => item.collection === collection && item.id === id);
  await writeManifestEntry(adapter, descriptor, manifestRead, { ...entry, path });
  await writeSnapshotEntry(storage, saved, { ...entry, path });
}

/**
 * Applies the remote side of one conflict: adopts it locally (or drops a
 * vanished file), then advances manifest and snapshot for that record.
 * @param {object} round Round context (see applyLocalResolution).
 * @param {object} manifestRead Current `{ manifest, rev }`.
 * @param {object} saved Stored state record.
 * @param {object} conflict Engine conflict with the remote entry.
 * @param {string} collection Record collection.
 * @param {string} id Record id.
 * @returns {Promise<void>}
 */
async function applyRemoteResolution(round, manifestRead, saved, conflict, collection, id) {
  const { storage, configs, adapter, descriptor } = round;
  const file = conflict.remote ? await adapter.readFile(conflict.remote.path).catch(round.failMapped) : null;
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

export {
  applyLocalResolution,
  applyRemoteResolution,
  applyRoundPlan,
  countRemaining,
  fetchRoundPlan,
  finalizeRound,
};
