// Verifies pey.filesystem.service with fake pickers, handles and files.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createService, isMarkdownName } from '../lib/filesystem-service.js';

function fakeFile(name, text, relativePath = '') {
  return { name, webkitRelativePath: relativePath, text: async () => text };
}

function fakeFileHandle(name, text, permission = 'granted') {
  const state = { permission, written: null, requested: false };
  return {
    kind: 'file',
    name,
    written: () => state.written,
    wasRequested: () => state.requested,
    async queryPermission() {
      return state.permission;
    },
    async requestPermission() {
      state.requested = true;
      if (state.permission !== 'denied') {
        state.permission = 'granted';
      }
      return state.permission;
    },
    async getFile() {
      return { text: async () => text };
    },
    async createWritable() {
      return {
        write: async (content) => {
          state.written = content;
        },
        close: async () => {},
      };
    },
  };
}

function fakeDirectoryHandle(name, children = []) {
  return {
    kind: 'directory',
    name,
    async *values() {
      yield* children;
    },
  };
}

function abortPicker() {
  throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
}

function rejectsWithCode(promise, code) {
  return assert.rejects(promise, (error) => error?.code === code);
}

test('should_match_markdown_names_when_checking', () => {
  assert.equal(isMarkdownName('note.md'), true);
  assert.equal(isMarkdownName('NOTE.MARKDOWN'), true);
  assert.equal(isMarkdownName('a.mdown'), true);
  assert.equal(isMarkdownName('b.txt'), true);
  assert.equal(isMarkdownName('image.png'), false);
  assert.equal(isMarkdownName('md'), false);
  assert.equal(isMarkdownName(null), false);
});

test('should_report_missing_pickers_when_probing', async () => {
  const service = createService({});
  assert.deepEqual(await service.getCapabilities(), { directoryPicker: false, filePicker: false, writable: false });
});

test('should_report_present_pickers_when_probing', async () => {
  globalThis.showDirectoryPicker = async () => {};
  globalThis.showOpenFilePicker = async () => {};
  try {
    const service = createService({});
    assert.deepEqual(await service.getCapabilities(), { directoryPicker: true, filePicker: true, writable: true });
  } finally {
    delete globalThis.showDirectoryPicker;
    delete globalThis.showOpenFilePicker;
  }
});

test('should_return_entry_when_directory_picked', async () => {
  const service = createService({});
  const handle = fakeDirectoryHandle('docs');
  const entry = await service.pickDirectory(async () => handle);
  assert.deepEqual(entry, { name: 'docs', path: 'docs', handle });
});

test('should_return_null_when_picker_is_missing', async () => {
  const service = createService({});
  assert.equal(await service.pickDirectory(null), null);
  assert.equal(await service.pickFile(null), null);
});

test('should_return_null_when_pick_is_cancelled', async () => {
  const service = createService({});
  assert.equal(await service.pickDirectory(abortPicker), null);
  assert.equal(await service.pickFile(abortPicker), null);
});

test('should_fail_structured_when_picker_throws', async () => {
  const service = createService({});
  const failing = async () => {
    throw new Error('boom');
  };
  await rejectsWithCode(service.pickDirectory(failing), 'FILESYSTEM_PICK_FAILED');
  await rejectsWithCode(service.pickFile(failing), 'FILESYSTEM_PICK_FAILED');
});

test('should_unwrap_array_when_file_picked', async () => {
  const service = createService({});
  const handle = fakeFileHandle('note.md', 'hi');
  const entry = await service.pickFile(async () => [handle]);
  assert.deepEqual(entry, { name: 'note.md', path: 'note.md', handle });
});

test('should_list_markdown_recursively_when_walking', async () => {
  const service = createService({});
  const root = fakeDirectoryHandle('root', [
    fakeFileHandle('a.md', 'a'),
    fakeFileHandle('pic.png', 'x'),
    fakeDirectoryHandle('sub', [
      fakeFileHandle('b.markdown', 'b'),
      fakeDirectoryHandle('deep', [fakeFileHandle('c.txt', 'c')]),
    ]),
  ]);
  const entries = await service.listDirectory(root);
  assert.deepEqual(entries.map(({ path }) => path), ['a.md', 'sub/b.markdown', 'sub/deep/c.txt']);
  assert.ok(entries.every(({ handle }) => handle?.kind === 'file'));
});

test('should_fail_structured_when_walk_fails', async () => {
  const service = createService({});
  const broken = {
    kind: 'directory',
    name: 'broken',
    async *values() {
      throw new Error('gone');
    },
  };
  await rejectsWithCode(service.listDirectory(broken), 'FILESYSTEM_READ_FAILED');
});

test('should_filter_markdown_when_collecting', async () => {
  const service = createService({});
  const entries = await service.collectEntries([
    fakeFile('a.md', 'a', 'docs/a.md'),
    fakeFile('pic.png', 'x', 'docs/pic.png'),
    fakeFile('b.txt', 'b'),
  ]);
  assert.deepEqual(entries.map(({ path }) => path), ['docs/a.md', 'b.txt']);
  assert.equal(typeof entries[0].file.text, 'function');
});

test('should_read_plain_file_when_entry_has_file', async () => {
  const service = createService({});
  const text = await service.readEntry({ name: 'a.md', path: 'a.md', file: fakeFile('a.md', '\uFEFFسلام') });
  assert.equal(text, 'سلام');
});

test('should_read_handle_without_request_when_granted', async () => {
  const service = createService({});
  const handle = fakeFileHandle('a.md', 'body');
  const text = await service.readEntry({ name: 'a.md', path: 'a.md', handle });
  assert.equal(text, 'body');
  assert.equal(handle.wasRequested(), false);
});

test('should_request_once_when_permission_is_pending', async () => {
  const service = createService({});
  const handle = fakeFileHandle('a.md', 'body', 'prompt');
  const text = await service.readEntry({ name: 'a.md', path: 'a.md', handle });
  assert.equal(text, 'body');
  assert.equal(handle.wasRequested(), true);
});

test('should_fail_denied_when_read_is_refused', async () => {
  const service = createService({});
  const handle = fakeFileHandle('a.md', 'body', 'denied');
  await rejectsWithCode(
    service.readEntry({ name: 'a.md', path: 'a.md', handle }),
    'FILESYSTEM_PERMISSION_DENIED',
  );
});

test('should_fail_structured_when_entry_is_unreadable', async () => {
  const service = createService({});
  await rejectsWithCode(
    service.readEntry({ name: 'a.md', path: 'a.md' }),
    'FILESYSTEM_READ_FAILED',
  );
});

test('should_write_through_handle_when_permitted', async () => {
  const service = createService({});
  const handle = fakeFileHandle('a.md', 'old');
  const result = await service.writeEntry({ name: 'a.md', path: 'a.md', handle }, 'new');
  assert.deepEqual(result, { name: 'a.md', path: 'a.md' });
  assert.equal(handle.written(), 'new');
});

test('should_return_null_when_entry_has_no_handle', async () => {
  const service = createService({});
  assert.equal(
    await service.writeEntry({ name: 'a.md', path: 'a.md', file: fakeFile('a.md', 'x') }, 'new'),
    null,
  );
});

test('should_fail_denied_when_write_is_refused', async () => {
  const service = createService({});
  const handle = fakeFileHandle('a.md', 'old', 'denied');
  await rejectsWithCode(
    service.writeEntry({ name: 'a.md', path: 'a.md', handle }, 'new'),
    'FILESYSTEM_PERMISSION_DENIED',
  );
});

test('should_fail_structured_when_write_throws', async () => {
  const service = createService({});
  const handle = fakeFileHandle('a.md', 'old');
  handle.createWritable = async () => {
    throw new Error('disk gone');
  };
  await rejectsWithCode(
    service.writeEntry({ name: 'a.md', path: 'a.md', handle }, 'new'),
    'FILESYSTEM_WRITE_FAILED',
  );
});

test('should_fail_structured_when_content_is_not_text', async () => {
  const service = createService({});
  const handle = fakeFileHandle('a.md', 'old');
  await rejectsWithCode(
    service.writeEntry({ name: 'a.md', path: 'a.md', handle }, null),
    'FILESYSTEM_WRITE_FAILED',
  );
});

function createStorage() {
  const records = new Map();
  return {
    records,
    async read(collection, key) {
      if (collection !== 'disk-drafts' || !records.has(key)) {
        throw Object.assign(new Error('missing'), { code: 'RECORD_NOT_FOUND' });
      }
      return records.get(key);
    },
    async write(collection, record) {
      if (collection !== 'disk-drafts') {
        throw new Error('unknown collection');
      }
      records.set(record.key, record);
    },
    async delete(collection, key) {
      records.delete(key);
    },
  };
}

test('should_save_and_read_shadow_when_storage_is_bound', async () => {
  const service = createService({ storage: createStorage() });
  const saved = await service.saveShadow('docs', 'a.md', 'base', 'draft');
  assert.equal(saved.root, 'docs');
  assert.equal(saved.path, 'a.md');
  assert.equal(typeof saved.updatedAt, 'number');
  const shadow = await service.readShadow('docs', 'a.md');
  assert.equal(shadow.base, 'base');
  assert.equal(shadow.draft, 'draft');
});

test('should_return_null_when_shadow_is_missing', async () => {
  const service = createService({ storage: createStorage() });
  assert.equal(await service.readShadow('docs', 'nope.md'), null);
});

test('should_clear_shadow_when_asked', async () => {
  const storage = createStorage();
  const service = createService({ storage });
  await service.saveShadow('docs', 'a.md', 'base', 'draft');
  await service.clearShadow('docs', 'a.md');
  assert.equal(await service.readShadow('docs', 'a.md'), null);
});

test('should_fail_storage_unavailable_when_unbound', async () => {
  const service = createService({});
  await rejectsWithCode(service.saveShadow('docs', 'a.md', 'b', 'd'), 'FILESYSTEM_STORAGE_UNAVAILABLE');
  await rejectsWithCode(service.readShadow('docs', 'a.md'), 'FILESYSTEM_STORAGE_UNAVAILABLE');
  await rejectsWithCode(service.clearShadow('docs', 'a.md'), 'FILESYSTEM_STORAGE_UNAVAILABLE');
});
