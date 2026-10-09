// Verifies bulk Markdown zip export (real @zip.js round-trip, no fakes).
import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js';
import { createService } from '../lib/export-service.js';
import { ARCHIVE_FILENAME, createZipBlob, zipEntryPath } from '../lib/export-zip.js';

async function readEntries(blob) {
  const reader = new ZipReader(new BlobReader(blob));
  try {
    const out = [];
    for (const entry of await reader.getEntries()) {
      out.push({ filename: entry.filename, text: await entry.getData(new TextWriter()) });
    }
    return out;
  } finally {
    await reader.close();
  }
}

test('should_build_folder_paths_when_mapping_entries', () => {
  assert.equal(zipEntryPath('آموزش', 'یادداشت'), 'آموزش/یادداشت.md');
  assert.equal(zipEntryPath('a/b', 'x'), 'a/b/x.md');
  assert.equal(zipEntryPath('', 'ریشه'), 'ریشه.md');
  assert.equal(zipEntryPath('', 'a/b\\c'), 'a-b-c.md');
  assert.equal(zipEntryPath('../..', 'x'), 'بدون عنوان/بدون عنوان/x.md');
  assert.equal(zipEntryPath('', ''), 'بدون عنوان.md');
});

test('should_pack_documents_with_paths_when_creating', async () => {
  const blob = await createZipBlob([
    { markdown: '# سلام', title: 'یادداشت', path: 'آموزش' },
    { markdown: 'plain', title: 'ریشه', path: '' },
  ]);
  assert.ok(blob instanceof Blob);
  assert.equal(blob.type, 'application/zip');
  assert.deepEqual(await readEntries(blob), [
    { filename: 'آموزش/یادداشت.md', text: '# سلام' },
    { filename: 'ریشه.md', text: 'plain' },
  ]);
});

test('should_suffix_repeats_when_paths_collide', async () => {
  const blob = await createZipBlob([
    { markdown: 'one', title: 'x', path: '' },
    { markdown: 'two', title: 'x', path: '' },
  ]);
  assert.deepEqual(await readEntries(blob), [
    { filename: 'x.md', text: 'one' },
    { filename: 'x (2).md', text: 'two' },
  ]);
});

test('should_build_empty_archive_when_documents_missing', async () => {
  assert.deepEqual(await readEntries(await createZipBlob([])), []);
  assert.deepEqual(await readEntries(await createZipBlob()), []);
});

test('should_return_blob_with_archive_name_when_exported', async () => {
  const service = createService({ markdown: null, events: null });
  const result = await service.exportZip({
    documents: [{ markdown: '# سلام', title: 'یادداشت', path: 'آموزش' }],
  });
  assert.equal(result.mime, 'application/zip');
  assert.equal(result.filename, ARCHIVE_FILENAME);
  assert.equal(result.filename, 'parsinegar-documents.zip');
  assert.deepEqual(await readEntries(result.blob), [
    { filename: 'آموزش/یادداشت.md', text: '# سلام' },
  ]);
});

test('should_reject_non_array_when_exported', async () => {
  const service = createService({ markdown: null, events: null });
  const error = await service.exportZip({ documents: 'nope' }).catch((caught) => caught);
  assert.ok(error instanceof Error);
  assert.equal(error.code, 'EXPORT_INVALID_INPUT');
});

test('should_wrap_build_failure_when_exported', async () => {
  const service = createService({ markdown: null, events: null });
  const broken = {};
  Object.defineProperty(broken, 'markdown', {
    get() {
      throw new Error('boom');
    },
  });
  const error = await service.exportZip({ documents: [broken] }).catch((caught) => caught);
  assert.ok(error instanceof Error);
  assert.equal(error.code, 'EXPORT_ZIP_FAILED');
});
