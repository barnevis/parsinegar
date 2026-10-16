// Verifies local persistence helpers over the shared memory fake.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceSnapshot,
  clearError,
  publish,
  readScopeForResolve,
  recordError,
  rememberScope,
  requireBackend,
  writeSnapshotEntry,
} from '../../lib/sync-state.js';
import { requireStorage } from '../../lib/sync-store.js';
import { memoryStorage } from './fake-storage.js';

const SCOPE = [{ collection: 'docs', serializer: 'markdown', idField: 'id', updatedAtField: 'updatedAt', titleField: 'title', contentField: 'content', ignore: [], folders: null }];

test('should_guard_storage_access_when_called', async () => {
  const failing = { async read() { throw new Error('down'); } };
  const missing = (() => {
    try {
      requireStorage({ storage: null });
    } catch (caught) {
      return caught;
    }
    return null;
  })();
  assert.equal(missing?.code, 'SYNC_STORAGE_UNAVAILABLE');
  const broken = await requireBackend({ storage: failing }).catch((caught) => caught);
  assert.equal(broken?.code, 'SYNC_STORAGE_UNAVAILABLE');
  const fresh = await requireBackend({ storage: memoryStorage() }).catch((caught) => caught);
  assert.equal(fresh?.code, 'SYNC_NOT_CONFIGURED');
});

test('should_remember_scope_and_resolve_it_when_stored', async () => {
  const storage = memoryStorage();
  await rememberScope(storage, SCOPE);
  assert.deepEqual(await readScopeForResolve(storage), SCOPE);
  const empty = await readScopeForResolve(memoryStorage()).catch((caught) => caught);
  assert.equal(empty?.code, 'SYNC_INVALID_CONFIG');
});

test('should_advance_snapshot_from_current_state_when_completed', async () => {
  const storage = memoryStorage({
    docs: [{ id: 'd1', title: 't', content: 'x', folderId: null, updatedAt: 7 }],
  });
  await advanceSnapshot(storage, SCOPE);
  const saved = await storage.read('sync_state', 'active');
  assert.deepEqual(saved.snapshot, [{ collection: 'docs', id: 'd1', updatedAt: 7, path: 't.md' }]);
  assert.equal(typeof saved.lastSyncAt, 'number');
});

test('should_upsert_and_drop_snapshot_entries_when_written', async () => {
  const storage = memoryStorage();
  const saved = {};
  const first = { collection: 'docs', id: 'd1', updatedAt: 1, path: 'a.md' };
  await writeSnapshotEntry(storage, saved, first, null);
  await writeSnapshotEntry(storage, await storage.read('sync_state', 'active'), { ...first, updatedAt: 2 }, null);
  await writeSnapshotEntry(storage, await storage.read('sync_state', 'active'), null, { collection: 'docs', id: 'd1' });
  assert.deepEqual((await storage.read('sync_state', 'active')).snapshot, []);
});

test('should_record_and_clear_errors_without_bus_when_called', async () => {
  const storage = memoryStorage();
  const events = { calls: [], publish(type, data) { this.calls.push({ type, data }); } };
  await recordError(storage, { code: 'SYNC_X', message: 'boom' });
  assert.equal((await storage.read('sync_state', 'active')).lastError.code, 'SYNC_X');
  publish({ storage, events: null }, 'sync:changed', {});
  publish({ storage, events }, 'sync:changed', { ok: true });
  assert.deepEqual(events.calls, [{ type: 'sync:changed', data: { ok: true } }]);
  await clearError(storage);
  assert.equal((await storage.read('sync_state', 'active')).lastError, null);
});
