// Verifies the MindElixir adapter shape (no library, no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { describeOperation, generateSubBranch, lineOfNodeId, nodeGapOf, plainSubtrees, siblingReference, subBranchPath, toMindElixirData } from '../../../components/workbench/mindmap-adapter.js';

test('should_translate_tree_when_converting', () => {
  assert.deepEqual(
    toMindElixirData({
      text: 'الف',
      line: 1,
      children: [{ text: 'ب', line: 2, children: [] }],
    }),
    {
      nodeData: {
        id: 'm-1',
        topic: 'الف',
        root: true,
        children: [{ id: 'm-2', topic: 'ب', children: [] }],
      },
    },
  );
  assert.equal(toMindElixirData(null), null);
});

test('should_read_lines_back_when_ids_are_known', () => {
  assert.equal(lineOfNodeId('m-12'), 12);
  assert.equal(lineOfNodeId('root'), null);
  assert.equal(lineOfNodeId('m-0'), null);
  assert.equal(lineOfNodeId(null), null);
});

test('should_lean_left_when_child_is_left', () => {
  const path = subBranchPath(
    { pT: 100, pL: 400, pW: 100, pH: 40, cT: 160, cL: 200, cW: 60, cH: 30, isFirst: true },
    30,
  );
  assert.equal(path, 'M 430 120 C 400 120 407 190 370 190 H 230');
  const xs = [...path.matchAll(/-?\d+\.?\d*/g)].map((match) => Number(match[0])).filter((_, index) => index % 2 === 0);
  assert.ok(Math.max(...xs) <= 430, 'expected no bulge past the start toward the parent');
});

test('should_lean_right_when_child_is_right', () => {
  const path = subBranchPath(
    { pT: 100, pL: 100, pW: 100, pH: 40, cT: 160, cL: 300, cW: 60, cH: 30, isFirst: false },
    30,
  );
  assert.equal(path, 'M 170 140 C 200 140 195 190 230 190 H 330');
  const xs = [...path.matchAll(/-?\d+\.?\d*/g)].map((match) => Number(match[0])).filter((_, index) => index % 2 === 0);
  assert.ok(Math.min(...xs) >= 170, 'expected no bulge past the start away from the child');
});

test('should_read_gap_off_the_instance_when_generating', () => {
  const args = { pT: 100, pL: 400, pW: 100, pH: 40, cT: 160, cL: 200, cW: 60, cH: 30, isFirst: true };
  const self = { container: { style: { getPropertyValue: () => '30px' } } };
  assert.equal(generateSubBranch.call(self, args), subBranchPath(args, 30));
  assert.equal(generateSubBranch.call(null, args), subBranchPath(args, 30));
  assert.equal(nodeGapOf(self), 30);
  assert.equal(nodeGapOf(null), 30);
  assert.equal(nodeGapOf({ container: { style: { getPropertyValue: () => 'wide' } } }), 30);
});

test('should_describe_edits_when_events_arrive', () => {
  assert.deepEqual(
    describeOperation({ name: 'finishEdit', obj: { id: 'm-2', topic: 'ج' } }),
    { kind: 'rename', id: 'm-2', topic: 'ج' },
  );
  assert.deepEqual(
    describeOperation({ name: 'addChild', obj: { id: 'fresh', topic: 'ب', parent: { id: 'm-1' } } }),
    { kind: 'add', parentId: 'm-1', newId: 'fresh', topic: 'ب' },
  );
  assert.deepEqual(
    describeOperation({
      name: 'insertSibling',
      type: 'after',
      obj: {
        id: 'fresh',
        topic: 'ج',
        parent: { id: 'm-1', children: [{ id: 'm-2' }, { id: 'fresh' }, { id: 'm-3' }] },
      },
    }),
    { kind: 'sibling', refId: 'm-2', position: 'after', newId: 'fresh', topic: 'ج' },
  );
  assert.deepEqual(
    describeOperation({
      name: 'insertSibling',
      type: 'before',
      obj: { id: 'fresh', topic: 'ج', parent: { id: 'm-1', children: [{ id: 'fresh' }, { id: 'm-2' }] } },
    }),
    { kind: 'sibling', refId: 'm-2', position: 'before', newId: 'fresh', topic: 'ج' },
  );
  assert.deepEqual(
    describeOperation({
      name: 'insertSibling',
      type: 'after',
      obj: { id: 'fresh', topic: 'ج', parent: { id: 'm-1', children: [{ id: 'fresh' }] } },
    }),
    { kind: 'sibling', refId: 'm-1', position: 'first', newId: 'fresh', topic: 'ج' },
  );
  assert.deepEqual(
    describeOperation({
      name: 'insertParent',
      obj: { id: 'fresh', topic: 'والد', children: [{ id: 'm-2', topic: 'ب' }] },
    }),
    { kind: 'parent', wrappedId: 'm-2', newId: 'fresh', topic: 'والد' },
  );
  assert.deepEqual(
    describeOperation({ name: 'removeNodes', objs: [{ id: 'm-2' }, { id: 'm-3' }] }),
    { kind: 'remove', ids: ['m-2', 'm-3'] },
  );
  assert.deepEqual(
    describeOperation({ name: 'moveNodeAfter', objs: [{ id: 'm-2' }], toObj: { id: 'm-3' } }),
    { kind: 'move', fromId: 'm-2', toId: 'm-3', position: 'after' },
  );
  assert.deepEqual(
    describeOperation({
      name: 'copyNodes',
      objs: [{ id: 'fresh', topic: 'ب', children: [{ id: 'fresh2', topic: 'ج' }] }],
    }),
    { kind: 'paste', nodes: [{ id: 'fresh', topic: 'ب', children: [{ id: 'fresh2', topic: 'ج', children: [] }] }] },
  );
  assert.deepEqual(describeOperation({ name: 'beginEdit', obj: { id: 'm-2' } }), { kind: 'ignore' });
  assert.equal(describeOperation({ name: 'reshapeNode' }), null);
  assert.equal(describeOperation(null), null);
  assert.equal(
    describeOperation({ name: 'insertSibling', type: 'after', obj: { id: 'fresh', parent: { id: 'm-1', children: [] } } }),
    null,
  );
});
