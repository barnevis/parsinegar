// Verifies list continuation on Enter (real CodeMirror view in jsdom).
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createMarkdownView } from '../../../components/editor/markdown-view.js';
import { continueList } from '../../../components/editor/list-continue.js';

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
