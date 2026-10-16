// Verifies folder maps and remote path building over the memory fake.
import assert from 'node:assert/strict';
import test from 'node:test';
import { folderParts, loadFolderMaps, pathForRecord, resolvePathParts } from '../../lib/sync-paths.js';
import { memoryStorage } from './fake-storage.js';

const MAPPING = { collection: 'folders', idField: 'id', nameField: 'name', parentField: 'parentId', folderField: 'folderId' };

function maps() {
  return {
    byId: new Map([
      ['f1', { id: 'f1', name: 'کار', parentId: null }],
      ['f2', { id: 'f2', name: 'زیر', parentId: 'f1' }],
    ]),
    mapping: MAPPING,
  };
}

test('should_resolve_chains_and_report_breaks_when_walking', () => {
  const { byId } = maps();
  assert.deepEqual(folderParts(byId, MAPPING, 'f2'), { parts: ['کار', 'زیر'], broken: false });
  assert.deepEqual(folderParts(byId, MAPPING, 'nope'), { parts: [], broken: true });
  const loop = new Map([['a', { id: 'a', name: 'x', parentId: 'a' }]]);
  assert.deepEqual(folderParts(loop, MAPPING, 'a'), { parts: ['x'], broken: true });
});

test('should_index_folders_by_collection_when_loaded', async () => {
  const storage = memoryStorage({
    folders: [{ id: 'f1', name: 'کار', parentId: null }],
  });
  const loaded = await loadFolderMaps(storage, [{ collection: 'docs', folders: MAPPING }]);
  assert.ok(loaded.get('folders').byId.has('f1'));
  assert.deepEqual(await loadFolderMaps(storage, [{ collection: 'docs', folders: null }]), new Map());
});

test('should_place_records_on_id_and_title_paths_when_built', () => {
  const { byId, mapping } = maps();
  const folderMaps = new Map([['folders', { byId, mapping }]]);
  assert.deepEqual(
    pathForRecord({ id: 'x', title: 't' }, { collection: 'docs', serializer: 'json', idField: 'id', folders: null }, folderMaps),
    { path: 'docs/x.json', relocated: false },
  );
  assert.deepEqual(
    pathForRecord(
      { id: 'd1', title: 'یادداشت', folderId: 'f2' },
      { collection: 'docs', serializer: 'markdown', idField: 'id', titleField: 'title', folders: MAPPING },
      folderMaps,
    ),
    { path: 'کار/زیر/یادداشت.md', relocated: false },
  );
  assert.deepEqual(
    pathForRecord({ id: 'd1', title: '  ' }, { collection: 'docs', serializer: 'markdown', idField: 'id', titleField: 'title', folders: null }, folderMaps).path,
    'untitled.md',
  );
  assert.deepEqual(
    pathForRecord(
      { id: 'd1', title: 'x', folderId: 'gone' },
      { collection: 'docs', serializer: 'markdown', idField: 'id', titleField: 'title', folders: MAPPING },
      folderMaps,
    ),
    { path: 'x.md', relocated: true },
  );
});

test('should_resolve_parts_to_ids_when_matched', () => {
  const { byId, mapping } = maps();
  assert.deepEqual(resolvePathParts({ byId, mapping }, ['کار', 'زیر']), { folderId: 'f2', relocated: false });
  assert.deepEqual(resolvePathParts({ byId, mapping }, ['کار', 'نیست']), { folderId: 'f1', relocated: true });
  assert.deepEqual(resolvePathParts(null, ['x']), { folderId: null, relocated: true });
});
