// Verifies pure document statistics (no DOM, no editor).
import assert from 'node:assert/strict';
import test from 'node:test';
import { countStats } from '../../../components/workbench/stats.js';

test('should_count_zero_when_text_is_empty', () => {
  assert.deepEqual(countStats(''), { chars: 0, words: 0, lines: 0 });
  assert.deepEqual(countStats(null), { chars: 0, words: 0, lines: 0 });
});

test('should_count_chars_with_spaces_when_text_is_given', () => {
  assert.equal(countStats('سلام دنیا').chars, 9);
});

test('should_keep_half_space_words_whole_when_counted', () => {
  assert.equal(countStats('می‌شود نمی‌شود').words, 2);
});

test('should_count_words_and_lines_when_multiline', () => {
  assert.deepEqual(countStats('یک دو\nسه'), { chars: 8, words: 3, lines: 2 });
});
