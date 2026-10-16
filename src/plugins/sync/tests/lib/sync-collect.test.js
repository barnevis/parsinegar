// Verifies local collection and ignore filtering over the memory fake.
import assert from 'node:assert/strict';
import test from 'node:test';
import { collectLocal, withoutIgnored } from '../../lib/sync-collect.js';
import { memoryStorage } from './fake-storage.js';

const SCOPE = [
  { collection: 'folders', serializer: 'json', idField: 'id', updatedAtField: 'updatedAt', titleField: 'title', contentField: 'content', ignore: [], folders: null },
  {
    collection: 'docs',
    serializer: 'markdown',
    idField: 'id',
    updatedAtField: 'updatedAt',
    titleField: 'title',
    contentField: 'content',
    ignore: [],
    folders: { collection: 'folders', idField: 'id', nameField: 'name', parentField: 'parentId', folderField: 'folderId' },
  },
];

function scoped(ignore) {
  return SCOPE.map((entry) => entry.collection === 'docs' ? { ...entry, ignore } : entry);
}

test('should_collect_entries_with_hashes_and_paths_when_listed', async () => {
  const storage = memoryStorage({
    folders: [{ id: 'f1', name: 'کار', parentId: null, updatedAt: 5 }],
    docs: [{ id: 'd1', title: 'یادداشت', content: 'سلام', folderId: 'f1', updatedAt: 10 }],
  });
  const { entries, skipped } = await collectLocal(storage, SCOPE);
  assert.equal(entries.length, 2);
  const doc = entries.find((item) => item.id === 'd1');
  assert.equal(doc.path, 'کار/یادداشت.md');
  assert.match(doc.hash, /^[0-9a-f]{8}$/);
  assert.deepEqual(skipped, []);
});

test('should_skip_idless_and_unserializable_records_when_listed', async () => {
  const storage = memoryStorage({
    docs: [
      { title: 'بی‌شناسه', content: 'x', updatedAt: 1 },
      { id: 'd2', title: 'خراب', content: 42, updatedAt: 1 },
    ],
  });
  const { entries, skipped } = await collectLocal(storage, scoped([]));
  assert.deepEqual(entries, []);
  assert.deepEqual(skipped, [
    { collection: 'docs', id: null },
    { collection: 'docs', id: 'd2' },
  ]);
});

test('should_exclude_ignored_names_and_subtrees_when_listed', async () => {
  const storage = memoryStorage({
    folders: [{ id: 'f1', name: 'آرشیو', parentId: null, updatedAt: 5 }],
    docs: [
      { id: 'd1', title: 'پیش‌نویس', content: 'x', folderId: null, updatedAt: 1 },
      { id: 'd2', title: 'قدیمی', content: 'y', folderId: 'f1', updatedAt: 1 },
      { id: 'd3', title: 'تازه', content: 'z', folderId: null, updatedAt: 1 },
    ],
  });
  const { entries, skipped } = await collectLocal(storage, scoped(['پیش‌نویس', 'آرشیو/']));
  assert.deepEqual(entries.map((item) => item.id), ['d3']);
  assert.deepEqual(
    skipped.map((item) => item.id).sort(),
    ['d1', 'd2', 'f1'],
  );
});

test('should_keep_unknown_collections_when_filtered', () => {
  const kept = withoutIgnored(
    [{ collection: 'mystery', id: 'm1', path: 'x' }],
    scoped(['x']),
    new Map(),
  );
  assert.deepEqual(kept.length, 1);
});
