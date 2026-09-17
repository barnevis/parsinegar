// Verifies pure document statistics (no DOM, no editor).
import assert from 'node:assert/strict';
import test from 'node:test';
import { countStats, formatFileSize } from '../../../components/workbench/stats.js';

test('should_count_zero_when_text_is_empty', () => {
  assert.deepEqual(countStats(''), { chars: 0, letters: 0, words: 0, lines: 0, bytes: 0 });
  assert.deepEqual(countStats(null), { chars: 0, letters: 0, words: 0, lines: 0, bytes: 0 });
});

test('should_count_chars_with_spaces_when_text_is_given', () => {
  assert.equal(countStats('سلام دنیا').chars, 9);
});

test('should_keep_half_space_words_whole_when_counted', () => {
  assert.equal(countStats('می‌شود نمی‌شود').words, 2);
});

test('should_count_words_and_lines_when_multiline', () => {
  assert.deepEqual(countStats('یک دو\nسه'), { chars: 8, letters: 6, words: 3, lines: 2, bytes: 14 });
});

test('should_count_unicode_letters_only_when_counting_letters', () => {
  assert.equal(countStats('می‌شود').letters, 5);
  assert.equal(countStats('a۱۲!').letters, 1);
});

test('should_count_utf8_bytes_when_counted', () => {
  assert.equal(countStats('a').bytes, 1);
  assert.equal(countStats('ا').bytes, 2);
  assert.equal(countStats('می‌شود').bytes, 13);
});

test('should_format_bytes_when_below_one_kilobyte', () => {
  const size = (bytes) => formatFileSize(bytes, String, (key) => key);
  assert.equal(size(0), '0 parsinegar.stats.bytes');
  assert.equal(size(826), '826 parsinegar.stats.bytes');
  assert.equal(size(1023), '1023 parsinegar.stats.bytes');
});

test('should_format_kilobytes_with_one_decimal_when_above', () => {
  const size = (bytes) => formatFileSize(bytes, String, (key) => key);
  assert.equal(size(1024), '1 parsinegar.stats.kilobytes');
  assert.equal(size(1536), '1.5 parsinegar.stats.kilobytes');
  assert.equal(size(6144), '6 parsinegar.stats.kilobytes');
});
