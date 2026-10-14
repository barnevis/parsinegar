// Verifies pure mindmap extraction (no DOM, no editor).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMindmapTree,
  isListOnlyDocument,
  mindmapSignature,
  parseMindmap,
} from '../../../components/workbench/mindmap.js';

test('should_return_empty_when_text_has_no_items', () => {
  assert.deepEqual(parseMindmap(''), []);
  assert.deepEqual(parseMindmap('متن ساده'), []);
  assert.deepEqual(parseMindmap('# عنوان'), []);
});

test('should_extract_depths_and_lines_when_nested_unordered', () => {
  assert.deepEqual(parseMindmap('- الف\n  - ب\n    - ج'), [
    { depth: 0, text: 'الف', line: 1 },
    { depth: 1, text: 'ب', line: 2 },
    { depth: 2, text: 'ج', line: 3 },
  ]);
});

test('should_extract_ordered_items_without_numbers', () => {
  assert.deepEqual(parseMindmap('1. اول\n   1. دوم'), [
    { depth: 0, text: 'اول', line: 1 },
    { depth: 1, text: 'دوم', line: 2 },
  ]);
});

test('should_strip_task_boxes_when_extracting', () => {
  assert.deepEqual(parseMindmap('- [ ] کار\n  - [x] شده'), [
    { depth: 0, text: 'کار', line: 1 },
    { depth: 1, text: 'شده', line: 2 },
  ]);
});

test('should_skip_fences_quotes_and_headings_when_extracting', () => {
  assert.deepEqual(parseMindmap('```\n- x\n```\n- y'), [{ depth: 0, text: 'y', line: 4 }]);
  assert.deepEqual(parseMindmap('> - x\n- y'), [{ depth: 0, text: 'y', line: 2 }]);
  assert.deepEqual(parseMindmap('# h\n- y'), [{ depth: 0, text: 'y', line: 2 }]);
});

test('should_accept_list_only_documents_when_checking', () => {
  assert.equal(isListOnlyDocument('- الف\n  - ب\n'), true);
  assert.equal(isListOnlyDocument('1. اول\n   1. دوم'), true);
  assert.equal(isListOnlyDocument('- [ ] کار\n'), true);
  assert.equal(isListOnlyDocument('- الف\n- \n'), true);
});

test('should_reject_mixed_documents_when_checking', () => {
  assert.equal(isListOnlyDocument(''), false);
  assert.equal(isListOnlyDocument('متن'), false);
  assert.equal(isListOnlyDocument('- الف\nمتن دنباله\n- ب'), false);
  assert.equal(isListOnlyDocument('# عنوان\n- الف'), false);
  assert.equal(isListOnlyDocument('> - الف\n- ب'), false);
  assert.equal(isListOnlyDocument('```\n- الف\n```'), false);
  assert.equal(isListOnlyDocument('* * *'), false);
  assert.equal(isListOnlyDocument('متن\n\n    - '), false);
});

test('should_attach_top_items_to_first_when_building', () => {
  assert.deepEqual(
    buildMindmapTree([
      { depth: 0, text: 'الف', line: 1 },
      { depth: 0, text: 'ب', line: 2 },
      { depth: 1, text: 'ب۱', line: 3 },
    ]),
    {
      text: 'الف',
      line: 1,
      children: [{ text: 'ب', line: 2, children: [{ text: 'ب۱', line: 3, children: [] }] }],
    },
  );
  assert.equal(buildMindmapTree([]), null);
});

test('should_change_signature_when_structure_moves', () => {
  const before = mindmapSignature('- الف\n  - ب');
  assert.equal(mindmapSignature('- الف\n  - ب'), before);
  assert.notEqual(mindmapSignature('- الف\n  - ج'), before);
  assert.notEqual(mindmapSignature('- الف\n- ب'), before);
});
