// Verifies the sync content codecs (pure, no I/O).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FALLBACK_SEGMENT,
  json,
  markdown,
  sanitizePathSegment,
} from '../lib/serializers.js';

test('should_round_trip_records_when_json_codec_is_used', () => {
  const record = { id: 'a', title: 'یادداشت', updatedAt: 5, extra: { z: 1, a: 2 } };
  assert.deepEqual(json.deserialize(json.serialize(record)), { ...record, extra: { z: 1, a: 2 } });
});

test('should_order_keys_stably_when_json_is_serialized', () => {
  const first = json.serialize({ id: 'a', title: 'x', updatedAt: 1 });
  const reordered = json.serialize({ updatedAt: 1, id: 'a', title: 'x' });
  assert.equal(first, reordered);
});

test('should_reject_non_records_when_json_is_serialized', () => {
  assert.throws(() => json.serialize(null), TypeError);
  assert.throws(() => json.serialize([1]), TypeError);
  assert.throws(() => json.serialize('x'), TypeError);
});

test('should_reject_invalid_payloads_when_json_is_deserialized', () => {
  assert.throws(() => json.deserialize('nope'), SyntaxError);
  assert.throws(() => json.deserialize('[1]'), SyntaxError);
  assert.throws(() => json.deserialize('null'), SyntaxError);
});

test('should_keep_bytes_verbatim_when_markdown_is_used', () => {
  const content = '# عنوان\n\n- الف\n\n| a |\n';
  assert.equal(markdown.serialize({ id: 'a', content }), content);
  assert.deepEqual(markdown.deserialize(content), { content });
});

test('should_reject_non_strings_when_markdown_is_used', () => {
  assert.throws(() => markdown.serialize({ id: 'a' }), TypeError);
  assert.throws(() => markdown.serialize({ content: 42 }), TypeError);
  assert.throws(() => markdown.deserialize(null), TypeError);
});

test('should_neutralize_separators_when_segment_is_sanitized', () => {
  assert.equal(sanitizePathSegment('a/b\\c'), 'a-b-c');
  assert.equal(sanitizePathSegment('  نام  '), 'نام');
  assert.equal(sanitizePathSegment('..'), FALLBACK_SEGMENT);
  assert.equal(sanitizePathSegment('.'), FALLBACK_SEGMENT);
  assert.equal(sanitizePathSegment(''), FALLBACK_SEGMENT);
  assert.equal(sanitizePathSegment('   '), FALLBACK_SEGMENT);
  assert.ok(sanitizePathSegment('a\x00b').length > 0);
  assert.ok(!sanitizePathSegment('a\x00b').includes('\x00'));
});
