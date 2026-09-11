// Verifies pure outline extraction (no DOM, no editor).
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOutline } from '../../../components/workbench/outline.js';

test('should_return_empty_when_text_has_no_headings', () => {
  assert.deepEqual(parseOutline(''), []);
  assert.deepEqual(parseOutline('متن ساده\nمتن'), []);
});

test('should_extract_levels_and_lines_when_headings_exist', () => {
  assert.deepEqual(parseOutline('# یک\nمتن\n## دو'), [
    { level: 1, text: 'یک', line: 1 },
    { level: 2, text: 'دو', line: 3 },
  ]);
});

test('should_strip_closing_marks_when_heading_has_them', () => {
  assert.deepEqual(parseOutline('## عنوان ##'), [{ level: 2, text: 'عنوان', line: 1 }]);
});

test('should_ignore_malformed_marks_when_text_is_given', () => {
  assert.deepEqual(parseOutline('#بدون‌فاصله\n# \n###### شش'), [{ level: 6, text: 'شش', line: 3 }]);
});
