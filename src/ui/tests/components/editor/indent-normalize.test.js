// Verifies display-level indent normalization for nested lists (real CodeMirror in jsdom).
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { createMarkdownView } from '../../../components/editor/markdown-view.js';
import { listDepthAt } from '../../../components/editor/indent-normalize.js';

function createEditor(documentText) {
  const host = document.createElement('div');
  document.body.append(host);
  return { host, editor: createMarkdownView(host, { document: documentText }) };
}

function destroy({ host, editor }) {
  editor.destroy();
  host.remove();
}

function indentWidgets(host) {
  return [...host.querySelectorAll('.parsi-indent')];
}

function treeOf(text) {
  const state = EditorState.create({
    doc: text,
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(state, state.doc.length);
  return { state, tree: syntaxTree(state) };
}

test('should_paint_spaces_when_nested_unordered_has_space_indent', () => {
  const mounted = createEditor('- الف\n  - ب');
  try {
    // Park the cursor on the child line: the marker under the cursor stays
    // raw by design, so both markers render only when it overlaps neither.
    mounted.editor.gotoLine(2);
    const widgets = indentWidgets(mounted.host);
    assert.equal(widgets.length, 1);
    assert.equal(widgets[0].textContent, ' '.repeat(8));
    assert.equal(mounted.host.querySelectorAll('.parsi-list-marker').length, 2);
  } finally {
    destroy(mounted);
  }
});

test('should_paint_spaces_when_nested_indent_is_already_tabbed', () => {
  // Raw leading tabs misrender under the hang (tab-stop grid shifts), so
  // even canonical tab runs get the spaces widget.
  const mounted = createEditor('- الف\n\t- ب');
  try {
    const widgets = indentWidgets(mounted.host);
    assert.equal(widgets.length, 1);
    assert.equal(widgets[0].textContent, ' '.repeat(8));
  } finally {
    destroy(mounted);
  }
});

test('should_paint_spaces_when_nested_ordered_has_space_indent', () => {
  const mounted = createEditor('1. اول\n   1. دوم');
  try {
    const widgets = indentWidgets(mounted.host);
    assert.equal(widgets.length, 1);
    assert.equal(widgets[0].textContent, ' '.repeat(8));
  } finally {
    destroy(mounted);
  }
});

test('should_paint_spaces_when_nested_task_has_space_indent', () => {
  const mounted = createEditor('- [ ] الف\n  - [ ] ب');
  try {
    const widgets = indentWidgets(mounted.host);
    assert.equal(widgets.length, 1);
    assert.equal(widgets[0].textContent, ' '.repeat(8));
    assert.equal(mounted.host.querySelectorAll('.parsi-task-marker').length, 2);
  } finally {
    destroy(mounted);
  }
});

test('should_keep_document_bytes_when_painting_indent', () => {
  const text = '- الف\n  - ب\n1. اول\n   1. دوم';
  const mounted = createEditor(text);
  try {
    assert.equal(indentWidgets(mounted.host).length, 2);
    assert.equal(mounted.editor.getValue(), text);
  } finally {
    destroy(mounted);
  }
});

test('should_skip_quote_and_fence_when_painting', () => {
  const mounted = createEditor('> - الف\n>   - ب\n\n```\n  1. x\n```');
  try {
    assert.equal(indentWidgets(mounted.host).length, 0);
  } finally {
    destroy(mounted);
  }
});

test('should_paint_sixteen_spaces_when_depth_is_two', () => {
  const mounted = createEditor('- الف\n\t- ب\n\t  - ج');
  try {
    const widgets = indentWidgets(mounted.host);
    assert.equal(widgets.length, 2);
    assert.equal(widgets[0].textContent, ' '.repeat(8));
    assert.equal(widgets[1].textContent, ' '.repeat(16));
  } finally {
    destroy(mounted);
  }
});

test('should_paint_spaces_for_tabbed_ordered_children_when_nested', () => {
  // Regression: tab-indented first children of ordered parents rendered
  // half a tab narrow under the hang; spaces have no tab stops to shift.
  const text = '1. یک\n\t1. دو\n\t2. سه\n2. چهار\n\t1. پنج\n\t\t1. شش\n\t\t2. هفت\n3. هشت\n\t1. نه';
  const mounted = createEditor(text);
  try {
    const widgets = indentWidgets(mounted.host);
    assert.equal(widgets.length, 6);
    assert.deepEqual(
      widgets.map((widget) => widget.textContent.length),
      [8, 8, 8, 16, 16, 8],
    );
    assert.equal(mounted.editor.getValue(), text);
  } finally {
    destroy(mounted);
  }
});

test('should_measure_depth_from_tree_when_items_nest', () => {
  const { state, tree } = treeOf('- a\n  - b\n\ntext');
  assert.ok(tree, 'expected a syntax tree');
  assert.equal(listDepthAt(tree, 0), 0);
  const nested = state.doc.line(2);
  assert.equal(listDepthAt(tree, nested.from + 2), 1);
  const plain = state.doc.line(4);
  assert.equal(listDepthAt(tree, plain.from), -1);
});
