// Verifies the pure sync decision logic, path-keyed (no I/O, no state).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashRecord,
  matchesIgnore,
  planSync,
  snapshotDiff,
} from '../../lib/sync-engine.js';

function local(overrides = {}) {
  return { collection: 'docs', id: 'a', path: 'a.md', hash: 'hash-a', ...overrides };
}

function remote(overrides = {}) {
  return { collection: 'docs', id: 'a', path: 'a.md', hash: 'hash-a', rev: 'rev-a', ...overrides };
}

function snap(overrides = {}) {
  return { collection: 'docs', id: 'a', path: 'a.md', hash: 'hash-a', rev: 'rev-a', ...overrides };
}

test('should_split_created_changed_and_deleted_when_diffed', () => {
  const before = [
    snap({ id: 'keep', path: 'keep.md', hash: 'k' }),
    snap({ id: 'stale', path: 'stale.md', hash: 's' }),
    snap({ id: 'gone', path: 'gone.md', hash: 'g' }),
  ];
  const current = [
    local({ id: 'keep', path: 'keep.md', hash: 'k' }),
    local({ id: 'stale', path: 'stale.md', hash: 'edited' }),
    local({ id: 'fresh', path: 'fresh.md', hash: 'f' }),
  ];
  const diff = snapshotDiff(before, current);
  assert.deepEqual(diff.created.map((item) => item.id), ['fresh']);
  assert.deepEqual(diff.changed.map((item) => item.id), ['stale']);
  assert.deepEqual(diff.deleted, [{ collection: 'docs', id: 'gone', path: 'gone.md' }]);
  assert.deepEqual(diff.skipped, []);
  const trimmed = snapshotDiff(before, [local({ id: 'keep', path: 'keep.md', hash: 'k' })]);
  assert.deepEqual(trimmed.created, []);
  assert.deepEqual(trimmed.changed, []);
  assert.deepEqual(trimmed.deleted.map((item) => item.id), ['stale', 'gone']);
});

test('should_read_renames_as_delete_plus_create_when_diffed', () => {
  const diff = snapshotDiff([snap()], [local({ path: 'new.md' })]);
  assert.deepEqual(diff.created.map((item) => item.id), ['a']);
  assert.deepEqual(diff.deleted.map((item) => item.path), ['a.md']);
  assert.deepEqual(diff.changed, []);
});

test('should_skip_malformed_and_duplicate_paths_when_diffed', () => {
  const diff = snapshotDiff([], [{ collection: 'docs' }, null, local(), local({ id: 'b' })]);
  assert.deepEqual(diff.created.map((item) => item.id), ['a']);
  assert.equal(diff.skipped.length, 3);
});

test('should_push_locals_and_pull_remotes_when_fresh', () => {
  const plan = planSync(
    [],
    [local(), local({ id: 'b', path: 'b.md', hash: 'hb' })],
    [remote({ id: 'c', path: 'c.md', hash: 'hc' })],
  );
  assert.deepEqual(plan.push.map((item) => item.id), ['a', 'b']);
  assert.deepEqual(plan.pull.map((item) => [item.id, item.path]), [['c', 'c.md']]);
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.deleteRemote, []);
  assert.deepEqual(plan.deleteLocal, []);
});

test('should_rest_when_both_sides_match_the_snapshot', () => {
  const plan = planSync([snap()], [local()], [remote()]);
  assert.deepEqual(plan.push, []);
  assert.deepEqual(plan.pull, []);
  assert.deepEqual(plan.deleteRemote, []);
  assert.deepEqual(plan.deleteLocal, []);
  assert.deepEqual(plan.conflicts, []);
});

test('should_push_one_sided_local_change_and_carry_old_path_delete_on_rename', () => {
  const edited = planSync([snap()], [local({ hash: 'edited' })], [remote({ hash: 'hash-a' })]);
  assert.deepEqual(edited.push.map((item) => item.hash), ['edited']);
  assert.deepEqual(edited.pull, []);
  const renamed = planSync(
    [snap({ path: 'old.md', rev: 'r-old' })],
    [local({ path: 'new.md', hash: 'edited' })],
    [remote({ path: 'old.md', rev: 'r-old' })],
  );
  assert.deepEqual(renamed.push.map((item) => item.path), ['new.md']);
  assert.deepEqual(renamed.deleteRemote, [{ collection: 'docs', id: 'a', path: 'old.md', rev: 'r-old' }]);
});

test('should_pull_one_sided_remote_change', () => {
  const plan = planSync(
    [snap({ hash: 'old' })],
    [local({ hash: 'old' })],
    [remote({ hash: 'fresh', rev: 'r2' })],
  );
  assert.deepEqual(plan.pull, [{ collection: 'docs', id: 'a', path: 'a.md', hash: 'fresh', rev: 'r2' }]);
  assert.deepEqual(plan.push, []);
});

test('should_conflict_when_both_sides_changed_differently', () => {
  const plan = planSync(
    [snap({ hash: 'base' })],
    [local({ hash: 'mine' })],
    [remote({ hash: 'theirs' })],
  );
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].local.hash, 'mine');
  assert.equal(plan.conflicts[0].remote.hash, 'theirs');
  assert.deepEqual(plan.push, []);
  assert.deepEqual(plan.pull, []);
});

test('should_rest_when_both_sides_converged_to_the_same_content', () => {
  for (const base of [{ hash: 'base', rev: 'rine' }, null]) {
    const plan = planSync(
      base ? [snap({ hash: 'base' })] : [],
      [local({ hash: 'same' })],
      [remote({ hash: 'same' })],
    );
    assert.deepEqual(plan.conflicts, [], 'convergence never asks');
    assert.deepEqual(plan.push, []);
    assert.deepEqual(plan.pull, []);
  }
});

test('should_delete_remote_when_local_left_an_unchanged_path', () => {
  const plan = planSync(
    [snap({ id: 'gone', path: 'gone.md', hash: 'hg', rev: 'rg' })],
    [local()],
    [remote({ id: 'gone', path: 'gone.md', hash: 'hg', rev: 'rg' })],
  );
  assert.deepEqual(plan.deleteRemote, [{ collection: 'docs', id: 'gone', path: 'gone.md', rev: 'rg' }]);
  assert.deepEqual(plan.conflicts, []);
});

test('should_conflict_when_local_left_and_remote_changed', () => {
  const plan = planSync(
    [snap({ id: 'gone', path: 'gone.md', hash: 'hg' })],
    [local()],
    [remote({ id: 'gone', path: 'gone.md', hash: 'rewritten' })],
  );
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].id, 'gone');
  assert.equal(plan.conflicts[0].local, null);
  assert.equal(plan.conflicts[0].remote.hash, 'rewritten');
});

test('should_delete_local_when_remote_lost_an_unchanged_path', () => {
  const plan = planSync(
    [snap({ id: 'gone', path: 'gone.md', hash: 'hg' })],
    [local(), local({ id: 'gone', path: 'gone.md', hash: 'hg' })],
    [remote()],
  );
  assert.deepEqual(plan.deleteLocal, [{ collection: 'docs', id: 'gone', path: 'gone.md' }]);
  assert.deepEqual(plan.conflicts, []);
});

test('should_conflict_when_remote_lost_and_local_changed', () => {
  const plan = planSync(
    [snap({ hash: 'base' })],
    [local({ hash: 'mine' })],
    [],
  );
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].remote, null);
  assert.equal(plan.conflicts[0].local.hash, 'mine');
});

test('should_raise_collision_and_skip_the_path_when_locals_cross', () => {
  const plan = planSync(
    [],
    [local({ id: 'a', path: 'n.md', hash: 'ha' }), local({ id: 'b', path: 'n.md', hash: 'hb' })],
    [],
  );
  assert.equal(plan.collisions.length, 1);
  assert.equal(plan.collisions[0].path, 'n.md');
  assert.equal(plan.collisions[0].otherId, 'a');
  assert.equal(plan.push.length, 1);
  assert.equal(plan.skipped.length, 0);
});

test('should_push_take_over_when_snapshot_owner_moved_away', () => {
  // owner `a` moved from `a.md` to `b.md`; record `b` (id-wise distinct)
  // now occupies the old local path — the file is rewritten, not asked.
  const plan = planSync(
    [snap({ id: 'a', path: 'a.png'.slice(0, -4) + '.md', hash: 'old' })],
    [local({ id: 'b', path: 'a.md', hash: 'new' }), local({ id: 'a', path: 'b.md', hash: 'new2' })],
    [remote({ id: 'a', path: 'a.md', hash: 'old', rev: 'r' })],
  );
  const takenOver = plan.push.find((item) => item.path === 'a.md');
  assert.ok(takenOver);
  assert.equal(takenOver.id, 'b');
  assert.deepEqual(plan.conflicts, []);
});

test('should_conflict_when_a_foreign_snapshot_owner_vanished', () => {
  const plan = planSync(
    [snap({ id: 'old', path: 'a.md', hash: 'old' })],
    [local({ id: 'new', path: 'a.md', hash: 'new' })],
    [remote({ id: null, path: 'a.md', hash: 'old', rev: 'r' })],
  );
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].id, 'new');
});

test('should_pull_minted_owners_for_new_remote_files', () => {
  const plan = planSync([], [], [remote({ id: null, path: 'سند.md' })]);
  assert.deepEqual(plan.pull, [{ collection: 'docs', id: null, path: 'سند.md', hash: 'hash-a', rev: 'rev-a' }]);
  const jsonPlan = planSync([], [], [remote({ id: 'meta-1', collection: 'meta', path: 'meta/meta-1.json' })]);
  assert.deepEqual(jsonPlan.pull.map((item) => [item.id, item.path]), [['meta-1', 'meta/meta-1.json']]);
});

test('should_fall_back_to_content_agreement_when_the_base_is_unknown', () => {
  // A migrated snapshot entry without a usable hash reads as unknown
  // base: agreeing contents converge, diverging contents ask.
  const same = planSync(
    [snap({ hash: null, rev: null })],
    [local({ hash: 'same' })],
    [remote({ hash: 'same' })],
  );
  assert.deepEqual(same.conflicts, []);
  assert.deepEqual(same.push, []);
  const split = planSync(
    [snap({ hash: null, rev: null })],
    [local({ hash: 'mine' })],
    [remote({ hash: 'theirs' })],
  );
  assert.equal(split.conflicts.length, 1);
});

test('should_skip_malformed_sides_when_planned', () => {
  const plan = planSync([], [{ collection: 'docs' }, null, local()], [{ id: 'x' }]);
  assert.deepEqual(plan.push.map((item) => item.id), ['a']);
  assert.equal(plan.skipped.length, 3);
});

test('should_hash_deterministically_when_hashed', () => {
  const first = hashRecord('سلام دنیا');
  assert.match(first, /^[0-9a-f]{8}$/);
  assert.equal(hashRecord('سلام دنیا'), first);
  assert.notEqual(hashRecord('سلام دنیا!'), first);
  assert.throws(() => hashRecord(42), TypeError);
});

test('should_match_extension_free_names_at_any_depth_when_ignored', () => {
  // Users never type the mandated `.md`: matching runs extension-free.
  assert.equal(matchesIgnore('یادداشت.md', ['یادداشت']), true);
  assert.equal(matchesIgnore('کار/یادداشت.md', ['یادداشت']), true);
  assert.equal(matchesIgnore('کار/یادداشت.md', ['دیگر']), false);
  assert.equal(matchesIgnore('پیش‌نویس.md', ['پیش*']), true);
  assert.equal(matchesIgnore('پیش‌نویس.md', ['?????']), false);
});

test('should_match_paths_and_subtrees_when_ignored', () => {
  assert.equal(matchesIgnore('کار/یادداشت.md', ['کار/یادداشت']), true);
  assert.equal(matchesIgnore('کار/یادداشت.md', ['کار/دیگر']), false);
  assert.equal(matchesIgnore('کار/زیر/یادداشت.md', ['کار/**']), true);
  assert.equal(matchesIgnore('کار/یادداشت.md', ['کار/']), true);
  assert.equal(matchesIgnore('کار/یادداشت.md', ['کار']), true);
  assert.equal(matchesIgnore('دیگر/یادداشت.md', ['کار/']), false);
  assert.equal(matchesIgnore('یادداشت.md', ['**/یادداشت']), true);
  assert.equal(matchesIgnore('کار/یادداشت.md', ['*/یادداشت']), true);
  assert.equal(matchesIgnore('کار/زیر/یادداشت.md', ['*/یادداشت']), false);
});

test('should_tolerate_typed_suffix_and_junk_when_ignored', () => {
  // A typed `.md` still hits via the full-path fallback instead of missing.
  assert.equal(matchesIgnore('یادداشت.md', ['یادداشت.md']), true);
  assert.equal(matchesIgnore('یادداشت.md', []), false);
  assert.equal(matchesIgnore('یادداشت.md', ['', '  ', null, 42]), false);
  assert.equal(matchesIgnore('یادداشت.md', ['!یادداشت']), false);
  assert.equal(matchesIgnore('', ['یادداشت']), false);
  assert.equal(matchesIgnore('یادداشت.md', null), false);
});
