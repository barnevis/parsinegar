// Verifies the MindElixir adapter shape (no library, no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { lineOfNodeId, toMindElixirData } from '../../../components/workbench/mindmap-adapter.js';

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
