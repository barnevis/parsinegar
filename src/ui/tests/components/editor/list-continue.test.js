// Verifies list continuation on Enter (real CodeMirror view in jsdom).
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorSelection } from '@codemirror/state';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createMarkdownView } from '../../../components/editor/markdown-view.js';
import { continueList, indentListItem, listResequenceExtension } from '../../../components/editor/list-continue.js';

function createView(documentText, cursor) {
  const host = document.createElement('div');
  document.body.append(host);
  const view = new EditorView({ doc: documentText, parent: host });
  view.dispatch({ selection: EditorSelection.cursor(cursor) });
  return { host, view };
}

function destroy({ host, view }) {
  view.destroy();
  host.remove();
}

function continued(documentText, cursor) {
  const mounted = createView(documentText, cursor);
  try {
    const handled = continueList(mounted.view);
    return {
      handled,
      text: mounted.view.state.doc.toString(),
      cursor: mounted.view.state.selection.main.head,
    };
  } finally {
    destroy(mounted);
  }
}

test('should_continue_unordered_list_when_enter_at_end', () => {
  const result = continued('- item', 6);
  assert.equal(result.handled, true);
  assert.equal(result.text, '- item\n- ');
  assert.equal(result.cursor, 9);
});

test('should_keep_marker_when_continuing_other_bullets', () => {
  assert.equal(continued('* item', 6).text, '* item\n* ');
  assert.equal(continued('  - item', 8).text, '  - item\n  - ');
});

test('should_remove_marker_when_enter_on_empty_item', () => {
  const result = continued('- ', 2);
  assert.equal(result.handled, true);
  assert.equal(result.text, '');
  assert.equal(result.cursor, 0);
});

test('should_reopen_unchecked_box_when_continuing_tasks', () => {
  assert.equal(continued('- [ ] task', 10).text, '- [ ] task\n- [ ] ');
  assert.equal(continued('- [x] task', 10).text, '- [x] task\n- [ ] ');
});

test('should_remove_box_when_enter_on_empty_task', () => {
  const result = continued('- [ ]', 5);
  assert.equal(result.handled, true);
  assert.equal(result.text, '');
});

test('should_increment_ordered_marker_when_continuing', () => {
  assert.equal(continued('2. item', 7).text, '2. item\n3. ');
  assert.equal(continued('2) item', 7).text, '2) item\n3) ');
  assert.equal(continued('9. item', 7).text, '9. item\n10. ');
});

test('should_increment_persian_digits_when_continuing', () => {
  assert.equal(continued('۱۲. مورد', 8).text, '۱۲. مورد\n۱۳. ');
});

test('should_repeat_quote_prefix_when_continuing', () => {
  assert.equal(continued('> quote', 7).text, '> quote\n> ');
  assert.equal(continued('>> quote', 8).text, '>> quote\n>> ');
});

test('should_remove_quote_when_enter_on_empty_quote', () => {
  const result = continued('> ', 2);
  assert.equal(result.handled, true);
  assert.equal(result.text, '');
});

test('should_ignore_midline_cursor_when_continuing', () => {
  const result = continued('- item', 3);
  assert.equal(result.handled, false);
  assert.equal(result.text, '- item');
});

test('should_ignore_selection_when_continuing', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const view = new EditorView({ doc: '- item', parent: host });
  try {
    view.dispatch({ selection: EditorSelection.range(0, 6) });
    assert.equal(continueList(view), false);
    assert.equal(view.state.doc.toString(), '- item');
  } finally {
    view.destroy();
    host.remove();
  }
});

test('should_ignore_heading_and_fence_when_continuing', () => {
  assert.equal(continued('# title', 7).handled, false);
  assert.equal(continued('```', 3).handled, false);
  assert.equal(continued('code', 4).handled, false);
});

function press(host, init) {
  host.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  }));
}

function createWired(documentText) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: documentText });
  return { host, editor };
}

test('should_insert_newline_when_enter_is_not_continuable', () => {
  // Pristine cursor sits at 0 (mid-line), so Enter must fall through to the
  // default newline without touching the wiring.
  const mounted = createWired('- item');
  try {
    press(mounted.host, { key: 'Enter', code: 'Enter' });
    assert.equal(mounted.editor.getValue(), '\n- item');
  } finally {
    mounted.editor.destroy();
    mounted.host.remove();
  }
});

test('should_indent_list_when_tab_is_pressed', () => {
  const mounted = createWired('- item');
  try {
    press(mounted.host, { key: 'Tab', code: 'Tab' });
    const value = mounted.editor.getValue();
    assert.ok(value === '  - item' || value === '\t- item', `expected indented, got ${JSON.stringify(value)}`);
  } finally {
    mounted.editor.destroy();
    mounted.host.remove();
  }
});

test('should_outdent_list_when_shift_tab_is_pressed', () => {
  const mounted = createWired('  - item');
  try {
    press(mounted.host, { key: 'Tab', code: 'Tab', shiftKey: true });
    assert.equal(mounted.editor.getValue(), '- item');
  } finally {
    mounted.editor.destroy();
    mounted.host.remove();
  }
});

test('should_keep_line_when_alt_arrow_has_nowhere_to_move', () => {
  // Pristine cursor sits on the single line: Alt+ArrowUp is a no-op that must
  // pass through without disturbing the document.
  const mounted = createWired('اول');
  try {
    press(mounted.host, { key: 'ArrowUp', code: 'ArrowUp', altKey: true });
    assert.equal(mounted.editor.getValue(), 'اول');
  } finally {
    mounted.editor.destroy();
    mounted.host.remove();
  }
});

function shifted(documentText, cursor, outdent, extensions = []) {
  const host = document.createElement('div');
  document.body.append(host);
  const view = new EditorView({
    doc: documentText,
    parent: host,
    extensions,
  });
  view.dispatch({ selection: EditorSelection.cursor(cursor) });
  try {
    const handled = indentListItem(view, outdent);
    return {
      handled,
      text: view.state.doc.toString(),
      line: view.state.doc.lineAt(view.state.selection.main.head).number,
    };
  } finally {
    view.destroy();
    host.remove();
  }
}

function lockedView(documentText, cursor) {
  const host = document.createElement('div');
  document.body.append(host);
  const view = new EditorView({
    doc: documentText,
    parent: host,
    extensions: [EditorView.editable.of(false), EditorState.readOnly.of(true)],
  });
  view.dispatch({ selection: EditorSelection.cursor(cursor) });
  return { host, view };
}

test('should_nest_and_restart_when_tab_on_ordered_item', () => {
  // The reported scenario: indenting `3.` nests it as `1.` instead of
  // stranding a `4.` at base level later.
  const result = shifted('1. یک\n2. دو\n3. سه', 17, false);
  assert.equal(result.handled, true);
  assert.equal(result.text, '1. یک\n2. دو\n\t1. سه');
  assert.equal(result.line, 3);
});

test('should_close_gap_when_outdenting_nested_item', () => {
  const result = shifted('1. یک\n2. دو\n\t1. سه', 18, true);
  assert.equal(result.handled, true);
  assert.equal(result.text, '1. یک\n2. دو\n3. سه');
  assert.equal(result.line, 3);
});

test('should_resequence_followers_when_indenting_middle_item', () => {
  const result = shifted('1. a\n2. b\n3. c', 9, false);
  assert.equal(result.handled, true);
  assert.equal(result.text, '1. a\n\t1. b\n2. c');
});

test('should_keep_start_number_when_indenting_later_item', () => {
  const result = shifted('3. a\n4. b', 9, false);
  assert.equal(result.handled, true);
  assert.equal(result.text, '3. a\n\t1. b');
});

test('should_keep_digits_and_delimiter_when_resequencing', () => {
  const persian = shifted('۱. الف\n۲. ب\n۳. پ', 16, false);
  assert.equal(persian.text, '۱. الف\n۲. ب\n\t۱. پ');
  const paren = shifted('1) a\n2) b', 9, false);
  assert.equal(paren.text, '1) a\n\t1) b');
  const task = shifted('1. [ ] t\n2. [ ] u', 15, false);
  assert.equal(task.text, '1. [ ] t\n\t1. [ ] u');
});

test('should_stop_block_at_blank_and_plain_lines_when_resequencing', () => {
  const blank = shifted('1. a\n\n2. b', 10, false);
  assert.equal(blank.text, '1. a\n\n\t1. b');
  const mixed = shifted('1. a\n- b\n2. c', 12, false);
  assert.equal(mixed.text, '1. a\n- b\n\t1. c');
});

test('should_fall_through_when_not_applicable', () => {
  assert.equal(shifted('- item', 6, false).handled, false);
  assert.equal(shifted('plain', 5, false).handled, false);
  assert.equal(shifted('1. a', 0, true).handled, false);
  const host = document.createElement('div');
  document.body.append(host);
  const view = new EditorView({ doc: '1. a\n2. b', parent: host });
  view.dispatch({ selection: EditorSelection.range(0, 4) });
  try {
    assert.equal(indentListItem(view, false), false);
  } finally {
    view.destroy();
    host.remove();
  }
});

test('should_swallow_tab_when_editor_is_locked', () => {
  const { host, view } = lockedView('1. a\n2. b', 7);
  try {
    assert.equal(indentListItem(view, false), true);
    assert.equal(view.state.doc.toString(), '1. a\n2. b');
    assert.equal(indentListItem(view, true), true);
  } finally {
    view.destroy();
    host.remove();
  }
});

test('should_renumber_through_real_tab_keypress', () => {
  const mounted = createWired('1. یک\n2. دو\n3. سه');
  try {
    mounted.editor.gotoLine(3);
    press(mounted.host, { key: 'End', code: 'End' });
    press(mounted.host, { key: 'Tab', code: 'Tab' });
    assert.equal(mounted.editor.getValue(), '1. یک\n2. دو\n\t1. سه');
    mounted.editor.undo();
    assert.equal(mounted.editor.getValue(), '1. یک\n2. دو\n3. سه');
  } finally {
    mounted.editor.destroy();
    mounted.host.remove();
  }
});

function filteredView(documentText, extensions = []) {
  const host = document.createElement('div');
  document.body.append(host);
  const view = new EditorView({ doc: documentText, parent: host, extensions });
  return { host, view };
}

function typeText(mounted, from, to, insert, userEvent) {
  mounted.view.dispatch({ changes: { from, to, insert }, userEvent });
  return mounted.view.state.doc.toString();
}

test('should_compact_when_middle_line_is_deleted', () => {
  // Delete `2. b\n` (positions 5..10) as a user deletion.
  const mounted = filteredView('1. a\n2. b\n3. c', [listResequenceExtension()]);
  try {
    assert.equal(typeText(mounted, 5, 10, '', 'delete.backward'), '1. a\n2. c');
  } finally {
    mounted.view.destroy();
    mounted.host.remove();
  }
});

test('should_restart_when_first_line_is_deleted', () => {
  const mounted = filteredView('1. a\n2. b\n3. c', [listResequenceExtension()]);
  try {
    assert.equal(typeText(mounted, 0, 5, '', 'delete.backward'), '1. b\n2. c');
  } finally {
    mounted.view.destroy();
    mounted.host.remove();
  }
});

test('should_keep_numbers_when_only_text_is_typed', () => {
  const mounted = filteredView('1. a\n2. b', [listResequenceExtension()]);
  try {
    // Typing text never restructures: start numbers survive, even odd ones.
    assert.equal(typeText(mounted, 4, 4, 'x', 'input.type'), '1. ax\n2. b');
    assert.equal(typeText(mounted, 6, 10, '3. b', 'input.type'), '1. ax\n3. b');
  } finally {
    mounted.view.destroy();
    mounted.host.remove();
  }
});

test('should_ignore_digit_edits_when_typing', () => {
  const mounted = filteredView('1. a\n2. b', [listResequenceExtension()]);
  try {
    // Replacing the digit itself changes no line count: user intent wins.
    assert.equal(typeText(mounted, 5, 6, '9', 'input.type'), '1. a\n9. b');
  } finally {
    mounted.view.destroy();
    mounted.host.remove();
  }
});

test('should_skip_programmatic_and_undo_transactions', () => {
  const plain = filteredView('1. a\n9. b', []);
  try {
    plain.view.dispatch({ changes: { from: 9, to: 9, insert: '\n' } });
    assert.equal(plain.view.state.doc.toString(), '1. a\n9. b\n');
  } finally {
    plain.view.destroy();
    plain.host.remove();
  }
  const undone = filteredView('1. a\n2. b', [listResequenceExtension()]);
  try {
    undone.view.dispatch({ changes: { from: 9, to: 9, insert: '\n9. c' }, userEvent: 'undo' });
    assert.equal(undone.view.state.doc.toString(), '1. a\n2. b\n9. c');
  } finally {
    undone.view.destroy();
    undone.host.remove();
  }
});

test('should_skip_locked_and_fenced_edits_when_filtering', () => {
  const locked = filteredView('1. a\n9. b', [
    listResequenceExtension(),
    EditorView.editable.of(false),
    EditorState.readOnly.of(true),
  ]);
  try {
    // The raw deletion applies (readOnly never blocks dispatch itself),
    // but the filter must not resequence: `9.` stays, no restart to 1.
    locked.view.dispatch({ changes: { from: 0, to: 5, insert: '' }, userEvent: 'delete.backward' });
    assert.equal(locked.view.state.doc.toString(), '9. b');
  } finally {
    locked.view.destroy();
    locked.host.remove();
  }
  const fenced = filteredView('```\n1. x\n```\n1. a', [listResequenceExtension()]);
  try {
    // Delete the fenced `1. x` line: the code text is not a list.
    fenced.view.dispatch({ changes: { from: 4, to: 9, insert: '' }, userEvent: 'delete.backward' });
    assert.equal(fenced.view.state.doc.toString(), '```\n```\n1. a');
  } finally {
    fenced.view.destroy();
    fenced.host.remove();
  }
});
