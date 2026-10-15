// Verifies the pure sync decision logic (no I/O, no state).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildManifest,
  hashRecord,
  parseManifest,
  planSync,
  snapshotDiff,
} from '../lib/sync-engine.js';

function entry(overrides = {}) {
  return {
    collection: 'docs',
    id: 'a',
    updatedAt: 100,
    path: 'a.md',
    hash: 'hash-a',
    ...overrides,
  };
}

test('should_split_created_updated_and_deleted_when_diffed', () => {
  const snapshot = [entry({ id: 'keep', updatedAt: 1, path: 'keep.md', hash: 'h' })];
  const current = [
    entry({ id: 'keep', updatedAt: 1, path: 'keep.md', hash: 'h' }),
    entry({ id: 'new', updatedAt: 2, path: 'new.md', hash: 'n' }),
    entry({ id: 'changed', updatedAt: 5, path: 'changed.md', hash: 'c' }),
  ];
  const before = [
    entry({ id: 'keep', updatedAt: 1, path: 'keep.md' }),
    entry({ id: 'changed', updatedAt: 1, path: 'changed.md' }),
    entry({ id: 'gone', updatedAt: 1, path: 'gone.md' }),
  ];
  const diff = snapshotDiff(before, current);
  assert.deepEqual(diff.created.map((item) => item.id), ['new']);
  assert.deepEqual(diff.updated.map((item) => item.id), ['changed']);
  assert.deepEqual(diff.deleted, [{ collection: 'docs', id: 'gone' }]);
  assert.deepEqual(diff.moved, []);
  assert.deepEqual(diff.skipped, []);
  assert.deepEqual(snapshotDiff(snapshot, snapshot).created, []);
});

test('should_report_moves_without_updates_when_renamed', () => {
  const diff = snapshotDiff(
    [entry({ updatedAt: 1, path: 'old.md' })],
    [entry({ updatedAt: 1, path: 'new.md' })],
  );
  assert.deepEqual(diff.moved, [{ collection: 'docs', id: 'a', from: 'old.md', to: 'new.md' }]);
  assert.deepEqual(diff.updated, []);
});

test('should_skip_path_compare_when_snapshot_path_is_missing', () => {
  const diff = snapshotDiff(
    [{ collection: 'docs', id: 'a', updatedAt: 1 }],
    [entry({ updatedAt: 2 })],
  );
  assert.deepEqual(diff.moved, []);
  assert.deepEqual(diff.updated.map((item) => item.id), ['a']);
});

test('should_skip_malformed_entries_when_diffed', () => {
  const diff = snapshotDiff([], [{ collection: 'docs' }, null, entry()]);
  assert.deepEqual(diff.created.map((item) => item.id), ['a']);
  assert.equal(diff.skipped.length, 2);
});

test('should_push_local_creations_on_first_sync_when_planned', () => {
  const plan = planSync([], [entry(), entry({ id: 'b', path: 'b.md', hash: 'hb', updatedAt: 2 })], []);
  assert.deepEqual(plan.push.map((item) => item.id), ['a', 'b']);
  assert.deepEqual(plan.pull, []);
  assert.deepEqual(plan.conflicts, []);
});

test('should_pull_remote_creations_on_first_sync_when_planned', () => {
  const plan = planSync([], [], [entry()]);
  assert.deepEqual(plan.pull.map((item) => item.id), ['a']);
  assert.deepEqual(plan.push, []);
});

test('should_rest_when_nothing_changed_when_planned', () => {
  const snapshot = [{ collection: 'docs', id: 'a', updatedAt: 100, path: 'a.md' }];
  const plan = planSync(snapshot, [entry()], [entry()]);
  assert.deepEqual(plan.push, []);
  assert.deepEqual(plan.pull, []);
  assert.deepEqual(plan.deleteRemote, []);
  assert.deepEqual(plan.deleteLocal, []);
  assert.deepEqual(plan.conflicts, []);
});

test('should_push_only_local_changes_when_planned', () => {
  const snapshot = [{ collection: 'docs', id: 'a', updatedAt: 1, path: 'a.md' }];
  const plan = planSync(snapshot, [entry({ updatedAt: 2, hash: 'h2' })], [entry({ updatedAt: 1, hash: 'h1' })]);
  assert.deepEqual(plan.push.map((item) => item.id), ['a']);
  assert.deepEqual(plan.pull, []);
});

test('should_pull_only_remote_changes_when_planned', () => {
  const snapshot = [{ collection: 'docs', id: 'a', updatedAt: 1, path: 'a.md' }];
  const plan = planSync(snapshot, [entry({ updatedAt: 1, hash: 'h1' })], [entry({ updatedAt: 2, hash: 'h2' })]);
  assert.deepEqual(plan.pull.map((item) => item.id), ['a']);
  assert.deepEqual(plan.push, []);
});

test('should_conflict_when_both_sides_changed_differently', () => {
  const snapshot = [{ collection: 'docs', id: 'a', updatedAt: 1, path: 'a.md' }];
  const plan = planSync(
    snapshot,
    [entry({ updatedAt: 2, hash: 'mine' })],
    [entry({ updatedAt: 3, hash: 'theirs' })],
  );
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].local.hash, 'mine');
  assert.equal(plan.conflicts[0].remote.hash, 'theirs');
  assert.deepEqual(plan.push, []);
  assert.deepEqual(plan.pull, []);
});

test('should_skip_when_both_sides_converged_when_planned', () => {
  const snapshot = [{ collection: 'docs', id: 'a', updatedAt: 1, path: 'a.md' }];
  const plan = planSync(
    snapshot,
    [entry({ updatedAt: 2, hash: 'same' })],
    [entry({ updatedAt: 3, hash: 'same' })],
  );
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.push, []);
  assert.deepEqual(plan.pull, []);
});

test('should_delete_remote_when_local_deleted_unchanged_entry', () => {
  const snapshot = [
    { collection: 'docs', id: 'a', updatedAt: 100, path: 'a.md' },
    { collection: 'docs', id: 'gone', updatedAt: 5, path: 'gone.md' },
  ];
  const plan = planSync(
    snapshot,
    [entry()],
    [entry(), entry({ id: 'gone', updatedAt: 5, path: 'gone.md', hash: 'hg' })],
  );
  assert.deepEqual(plan.deleteRemote, [{ collection: 'docs', id: 'gone', path: 'gone.md' }]);
  assert.deepEqual(plan.conflicts, []);
});

test('should_delete_local_when_remote_deleted_unchanged_entry', () => {
  const snapshot = [
    { collection: 'docs', id: 'a', updatedAt: 100, path: 'a.md' },
    { collection: 'docs', id: 'gone', updatedAt: 5, path: 'gone.md' },
  ];
  const plan = planSync(
    snapshot,
    [entry(), entry({ id: 'gone', updatedAt: 5, path: 'gone.md', hash: 'hg' })],
    [entry()],
  );
  assert.deepEqual(plan.deleteLocal, [{ collection: 'docs', id: 'gone' }]);
  assert.deepEqual(plan.conflicts, []);
});

test('should_conflict_when_local_deleted_changed_entry', () => {
  const snapshot = [{ collection: 'docs', id: 'a', updatedAt: 1, path: 'a.md' }];
  const plan = planSync(
    snapshot,
    [entry({ updatedAt: 2, hash: 'mine' })],
    [],
  );
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].remote, null);
  assert.equal(plan.conflicts[0].local.hash, 'mine');
});

test('should_conflict_when_remote_changed_deleted_entry', () => {
  const snapshot = [{ collection: 'docs', id: 'a', updatedAt: 1, path: 'a.md' }];
  const plan = planSync(
    snapshot,
    [],
    [entry({ updatedAt: 2, hash: 'theirs' })],
  );
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].local, null);
  assert.equal(plan.conflicts[0].remote.hash, 'theirs');
});

test('should_push_and_drop_old_path_when_local_renamed', () => {
  const snapshot = [{ collection: 'docs', id: 'a', updatedAt: 100, path: 'old.md' }];
  const steady = planSync(
    snapshot,
    [entry({ path: 'old.md' })],
    [entry({ updatedAt: 100, path: 'old.md' })],
  );
  assert.deepEqual(steady.push, []);
  assert.deepEqual(steady.deleteRemote, []);
  const renamed = planSync(
    snapshot,
    [entry({ path: 'new.md' })],
    [entry({ updatedAt: 100, path: 'old.md' })],
  );
  assert.deepEqual(renamed.push.map((item) => item.path), ['new.md']);
  assert.deepEqual(renamed.deleteRemote, [{ collection: 'docs', id: 'a', path: 'old.md' }]);
});

test('should_conflict_on_id_collision_when_both_created', () => {
  const plan = planSync([], [entry({ hash: 'mine' })], [entry({ hash: 'theirs' })]);
  assert.equal(plan.conflicts.length, 1);
  const converged = planSync([], [entry({ hash: 'same' })], [entry({ hash: 'same' })]);
  assert.deepEqual(converged.conflicts, []);
  assert.deepEqual(converged.push, []);
  assert.deepEqual(converged.pull, []);
});

test('should_skip_malformed_sides_when_planned', () => {
  const plan = planSync([], [{ collection: 'docs' }, entry()], [{ id: 'x' }]);
  assert.deepEqual(plan.push.map((item) => item.id), ['a']);
  assert.equal(plan.skipped.length, 2);
});

test('should_build_versioned_manifest_when_built', () => {
  const { manifest, skipped } = buildManifest([entry(), { collection: 'docs' }]);
  assert.equal(manifest.version, 1);
  assert.deepEqual(manifest.records, [{
    collection: 'docs',
    id: 'a',
    path: 'a.md',
    updatedAt: 100,
    hash: 'hash-a',
    title: null,
  }]);
  assert.equal(skipped.length, 1);
  const titled = buildManifest([entry({ title: 'یادداشت' })]);
  assert.equal(titled.manifest.records[0].title, 'یادداشت');
});

test('should_round_trip_valid_manifest_when_parsed', () => {
  const { manifest } = buildManifest([entry()]);
  const parsed = parseManifest(JSON.parse(JSON.stringify(manifest)));
  assert.deepEqual(parsed.manifest, manifest);
  assert.deepEqual(parsed.skipped, []);
});

test('should_reject_structural_failure_when_parsed', () => {
  assert.equal(parseManifest(null), null);
  assert.equal(parseManifest({ version: 2, records: [] }), null);
  assert.equal(parseManifest({ version: 1 }), null);
  assert.equal(parseManifest({ version: 1, records: {} }), null);
});

test('should_skip_bad_records_when_parsed', () => {
  const parsed = parseManifest({ version: 1, records: [entry(), { id: 'x' }] });
  assert.equal(parsed.manifest.records.length, 1);
  assert.equal(parsed.skipped.length, 1);
});

test('should_hash_deterministically_when_hashed', () => {
  const first = hashRecord('سلام دنیا');
  assert.match(first, /^[0-9a-f]{8}$/);
  assert.equal(hashRecord('سلام دنیا'), first);
  assert.notEqual(hashRecord('سلام دنیا!'), first);
  assert.throws(() => hashRecord(42), TypeError);
});
