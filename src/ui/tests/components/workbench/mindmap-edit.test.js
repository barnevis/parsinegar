// Verifies structural Markdown edits for mindmap operations (pure).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAP_NEW_TOPIC,
  applyMapOperation,
  insertChildLine,
  insertParentLine,
  insertSiblingLine,
  moveNodeLines,
  pasteSubtreeLines,
  removeNodeLines,
  renameNodeLine,
} from '../../../components/workbench/mindmap-edit.js';

test('should_replace_content_when_renaming', () => {
  assert.equal(renameNodeLine('- الف\n  - ب', 2, 'ج'), '- الف\n  - ج');
  assert.equal(renameNodeLine('1. اول', 1, '۱'), '1. ۱');
  assert.equal(renameNodeLine('- [x] کار', 1, 'بازی'), '- [x] بازی');
  assert.equal(renameNodeLine('- الف', 1, 'a\nb'), '- a');
  assert.equal(renameNodeLine('- الف', 9, 'x'), null);
  assert.equal(renameNodeLine('متن', 1, 'x'), null);
});

test('should_append_child_when_inserting', () => {
  assert.deepEqual(insertChildLine('- الف\n  - ب', 1, 'ج'), {
    text: '- الف\n  - ب\n\t- ج',
    line: 3,
  });
  assert.deepEqual(insertChildLine('- الف', 1), {
    text: `- الف\n\t- ${MAP_NEW_TOPIC}`,
    line: 2,
  });
  assert.equal(insertChildLine('- الف', 9, 'x'), null);
  assert.equal(insertChildLine('متن', 1, 'x'), null);
});

test('should_copy_style_when_inserting_sibling', () => {
  assert.deepEqual(insertSiblingLine('- الف\n- ب', 1, 'اول', 'before'), {
    text: '- اول\n- الف\n- ب',
    line: 1,
  });
  assert.deepEqual(insertSiblingLine('- الف\n  - ب', 2, 'ج'), {
    text: '- الف\n  - ب\n  - ج',
    line: 3,
  });
  assert.deepEqual(insertSiblingLine('- [x] کار', 1, 'بازی'), {
    text: '- [x] کار\n- [ ] بازی',
    line: 2,
  });
});

test('should_resequence_ordered_run_when_inserting_sibling', () => {
  assert.deepEqual(insertSiblingLine('1. اول\n2. دوم', 1, 'صفر', 'before'), {
    text: '1. صفر\n2. اول\n3. دوم',
    line: 1,
  });
  assert.deepEqual(insertSiblingLine('1. اول\n2. دوم', 1, 'وسط'), {
    text: '1. اول\n2. وسط\n3. دوم',
    line: 2,
  });
  assert.deepEqual(insertSiblingLine('1. [ ] الف\n2. [ ] ب', 1, 'ج'), {
    text: '1. [ ] الف\n2. [ ] ج\n3. [ ] ب',
    line: 2,
  });
});

test('should_push_subtree_when_inserting_parent', () => {
  assert.deepEqual(insertParentLine('- الف\n  - ب', 2, 'والد'), {
    text: '- الف\n  - والد\n  \t- ب',
    line: 2,
  });
  assert.equal(insertParentLine('- الف', 9, 'x'), null);
});

test('should_delete_subtree_when_removing', () => {
  assert.equal(removeNodeLines('- الف\n  - ب\n  - ج\n- د', [2]), '- الف\n  - ج\n- د');
  assert.equal(removeNodeLines('- الف\n  - ب\n  - ج\n- د', [1]), '- د');
  assert.equal(removeNodeLines('- الف\n  - ب\n- د', [1, 3]), '');
  assert.equal(removeNodeLines('- الف', [9]), null);
  assert.equal(removeNodeLines('- الف', []), null);
});

test('should_compact_ordered_run_when_removing', () => {
  assert.equal(removeNodeLines('1. اول\n2. دوم\n3. سوم', [2]), '1. اول\n2. سوم');
  assert.equal(removeNodeLines('1. اول\n2. دوم\n3. سوم', [1]), '1. دوم\n2. سوم');
});

test('should_move_subtree_when_moving_inside', () => {
  assert.equal(
    moveNodeLines('- الف\n  - ب\n- ج', 3, 1, 'inside'),
    '- الف\n  - ب\n\t- ج',
  );
  assert.equal(moveNodeLines('- الف\n- ب', 2, 1, 'before'), '- ب\n- الف');
  assert.equal(moveNodeLines('- الف\n- ب', 1, 2, 'after'), '- ب\n- الف');
});

test('should_renumber_when_moving_ordered', () => {
  assert.equal(
    moveNodeLines('1. اول\n2. دوم\n3. سوم', 3, 1, 'before'),
    '1. سوم\n2. اول\n3. دوم',
  );
});

test('should_reject_bad_moves_when_moving', () => {
  assert.equal(moveNodeLines('- الف\n  - ب', 1, 2, 'inside'), null);
  assert.equal(moveNodeLines('- الف\n  - ب', 2, 2, 'before'), null);
  assert.equal(moveNodeLines('- الف', 1, 9, 'before'), null);
});

test('should_nest_pasted_nodes_when_pasting', () => {
  assert.deepEqual(
    pasteSubtreeLines('- الف', 1, [{ id: 'x', topic: 'ب', children: [{ id: 'y', topic: 'ج' }] }]),
    {
      text: '- الف\n\t- ب\n\t\t- ج',
      placed: [{ id: 'x', line: 2 }, { id: 'y', line: 3 }],
    },
  );
  assert.equal(pasteSubtreeLines('- الف', 9, [{ topic: 'ب' }]), null);
  assert.equal(pasteSubtreeLines('- الف', 1, []), null);
  assert.equal(pasteSubtreeLines('- الف', 1, [null]), null);
});

function resolveByMap(id) {
  const match = typeof id === 'string' ? /^m-(\d+)$/.exec(id) : null;
  return match ? Number(match[1]) : null;
}

function resolveWith(pending) {
  return (id) => resolveByMap(id) ?? (pending instanceof Map ? pending.get(id) ?? null : null);
}

test('should_rename_through_pending_when_applying', () => {
  const pending = new Map([['fresh1', 2]]);
  assert.deepEqual(
    applyMapOperation('- الف\n  - ب', { kind: 'rename', id: 'fresh1', topic: 'ج' }, resolveWith(pending), pending),
    { text: '- الف\n  - ج', refresh: false },
  );
  assert.deepEqual(
    applyMapOperation('- الف', { kind: 'rename', id: 'gone', topic: 'ج' }, resolveWith(pending), pending),
    { text: null, refresh: true },
  );
});

test('should_insert_and_record_when_applying', () => {
  const pending = new Map();
  assert.deepEqual(
    applyMapOperation('- الف', { kind: 'add', parentId: 'm-1', newId: 'fresh1', topic: 'ب' }, resolveByMap, pending),
    { text: '- الف\n\t- ب', refresh: false },
  );
  assert.deepEqual([...pending.entries()], [['fresh1', 2]]);
  assert.deepEqual(
    applyMapOperation('- الف\n- ب', { kind: 'sibling', refId: 'm-1', position: 'after', newId: 'fresh2', topic: 'ج' }, resolveByMap, pending),
    { text: '- الف\n- ج\n- ب', refresh: false },
  );
  assert.deepEqual([...pending.entries()], [['fresh1', 2], ['fresh2', 2]]);
});

test('should_remove_and_move_when_applying', () => {
  assert.deepEqual(
    applyMapOperation('- الف\n  - ب\n- ج', { kind: 'remove', ids: ['m-2'] }, resolveByMap, new Map()),
    { text: '- الف\n- ج', refresh: true },
  );
  assert.deepEqual(
    applyMapOperation('- الف\n- ب', { kind: 'remove', ids: ['m-9'] }, resolveByMap, new Map()),
    { text: null, refresh: true },
  );
  assert.deepEqual(
    applyMapOperation('- الف\n- ب', { kind: 'move', fromId: 'm-2', toId: 'm-1', position: 'before' }, resolveByMap, new Map()),
    { text: '- ب\n- الف', refresh: true },
  );
});

test('should_paste_with_target_when_applying', () => {
  const pending = new Map();
  const result = applyMapOperation(
    '- الف',
    { kind: 'paste', targetLine: 1, nodes: [{ id: 'fresh1', topic: 'ب', children: [] }] },
    resolveByMap,
    pending,
  );
  assert.deepEqual(result, { text: '- الف\n\t- ب', refresh: false });
  assert.deepEqual([...pending.entries()], [['fresh1', 2]]);
  assert.deepEqual(
    applyMapOperation('- الف', { kind: 'paste', targetLine: null, nodes: [] }, resolveByMap, new Map()),
    { text: null, refresh: true },
  );
  assert.deepEqual(
    applyMapOperation('- الف', { kind: 'unknown-op' }, resolveByMap, new Map()),
    { text: null, refresh: true },
  );
  assert.deepEqual(applyMapOperation(null, null, null, null), { text: null, refresh: true });
});
