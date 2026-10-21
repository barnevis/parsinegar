// Verifies scope validation and per-scope record shaping (pure, no I/O).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attributePath,
  contentOf,
  extensionsOf,
  normalizeScope,
  pathEncodedId,
  remoteHash,
  serializeRecord,
  stripVolatile,
} from '../../lib/sync-scope.js';
import { hashRecord } from '../../lib/sync-engine.js';

test('should_default_fields_when_minimal', () => {
  const [config] = normalizeScope({ collections: [{ collection: 'docs' }] });
  assert.deepEqual(config, {
    collection: 'docs',
    idField: 'id',
    updatedAtField: 'updatedAt',
    serializer: 'json',
    basePath: 'docs',
    titleField: 'title',
    contentField: 'content',
    ignore: [],
    folders: null,
  });
});

test('should_default_markdown_base_path_to_root_and_honour_explicit_ones', () => {
  const [markdown, tagged, meta] = normalizeScope({
    collections: [
      { collection: 'notes', serializer: 'markdown' },
      { collection: 'notes2', serializer: 'markdown', basePath: 'docs/' },
      { collection: 'meta', serializer: 'json', basePath: 'kings' },
    ],
  });
  assert.equal(markdown.basePath, '');
  assert.equal(tagged.basePath, 'docs');
  assert.equal(meta.basePath, 'kings');
});

test('should_keep_custom_mapping_when_given', () => {
  const [config] = normalizeScope({
    collections: [{
      collection: 'notes',
      serializer: 'markdown',
      idField: 'key',
      updatedAtField: 'mtime',
      titleField: 'name',
      contentField: 'body',
      folders: { collection: 'projects', nameField: 'name' },
      ignore: [' scratch ', 'tmp/'],
    }],
  });
  assert.equal(config.idField, 'key');
  assert.equal(config.updatedAtField, 'mtime');
  assert.equal(config.titleField, 'name');
  assert.equal(config.contentField, 'body');
  assert.deepEqual(config.ignore, ['scratch', 'tmp/']);
  assert.deepEqual(config.folders, {
    collection: 'projects',
    idField: 'id',
    nameField: 'name',
    parentField: 'parentId',
    folderField: 'folderId',
  });
});

test('should_reject_malformed_scope_when_validating', () => {
  for (const scope of [
    {},
    { collections: [] },
    { collections: [{}] },
    { collections: [{ collection: 'docs', serializer: 'yaml' }] },
    { collections: [{ collection: 'docs', folders: { collection: 'f' } }] },
    { collections: [{ collection: 'docs', ignore: 'nope' }] },
    { collections: [{ collection: 'docs', ignore: ['ok', '  '] }] },
  ]) {
    const error = (() => {
      try {
        normalizeScope(scope);
      } catch (caught) {
        return caught;
      }
      return null;
    })();
    assert.equal(error?.code, 'SYNC_INVALID_CONFIG', `expected rejection for ${JSON.stringify(scope)}`);
  }
});

test('should_serialize_through_content_field_when_recording', () => {
  const configs = normalizeScope({
    collections: [{ collection: 'docs', serializer: 'markdown', contentField: 'body' }],
  });
  assert.equal(
    serializeRecord(configs, { collection: 'docs', id: 'd1' }, { id: 'd1', body: 'hi' }),
    'hi',
  );
  const missing = (() => {
    try {
      serializeRecord(configs, { collection: 'docs', id: 'gone' }, null);
    } catch (caught) {
      return caught;
    }
    return null;
  })();
  assert.equal(missing?.code, 'SYNC_INVALID_CONFIG');
});

test('should_extract_content_and_extensions_when_shaping', () => {
  const configs = normalizeScope({
    collections: [
      { collection: 'docs', serializer: 'markdown', contentField: 'body' },
      { collection: 'meta', serializer: 'json' },
    ],
  });
  assert.equal(contentOf(configs, 'docs', { body: 'hi', updatedAt: 1 }), 'hi');
  assert.equal(contentOf(configs, 'nope', {}), '');
  assert.deepEqual(extensionsOf(configs).sort(), ['json', 'md']);
  assert.deepEqual(stripVolatile({ a: 1, updatedAt: 9 }, 'updatedAt'), { a: 1 });
});

test('should_attribute_and_decode_remote_paths_when_listing', () => {
  const configs = normalizeScope({
    collections: [
      { collection: 'docs', serializer: 'markdown' },
      { collection: 'meta', serializer: 'json' },
      { collection: 'extra', serializer: 'json', basePath: '' },
    ],
  });
  assert.equal(attributePath('salaam.md', configs)?.collection, 'docs');
  assert.equal(attributePath('salaam.MD', configs)?.collection, 'docs');
  assert.equal(attributePath('meta/record.json', configs)?.collection, 'meta');
  assert.equal(attributePath('salaam.json', configs)?.collection, 'extra');
  assert.equal(attributePath('final.txt', configs), null);
  const ambiguous = normalizeScope({
    collections: [
      { collection: 'first', serializer: 'json', basePath: '' },
      { collection: 'second', serializer: 'json', basePath: '' },
    ],
  });
  assert.equal(attributePath('salaam.json', ambiguous), null);
  assert.equal(pathEncodedId(configs.find((config) => config.collection === 'meta'), 'meta/record.json'), 'record');
  assert.equal(pathEncodedId(configs.find((config) => config.collection === 'docs'), 'salaam.md'), null);
});

test('should_hash_remote_files_on_the_local_basis_when_scoping', () => {
  const configs = normalizeScope({
    collections: [
      { collection: 'docs', serializer: 'markdown', contentField: 'body' },
      { collection: 'meta', serializer: 'json' },
    ],
  });
  assert.equal(remoteHash(configs, 'docs', 'سلام تبریز'), hashRecord('سلام تبریز'));
  assert.equal(remoteHash(configs, 'meta', JSON.stringify({ updatedAt: 12, a: 1 })), hashRecord(JSON.stringify({ a: 1 })));
  assert.equal(remoteHash(configs, 'nope', 'x'), null);
  assert.equal(remoteHash(configs, 'meta', 'not-json'), null);
});
