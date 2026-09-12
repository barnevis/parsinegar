// Verifies Markdown toggle commands (real CodeMirror view in jsdom).
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorView } from 'codemirror';
import { EditorSelection } from '@codemirror/state';
import {
  insertLink,
  shortcutCommand,
  toggleBold,
  toggleCode,
  toggleHeading,
  toggleItalic,
  toggleOrderedList,
  toggleQuote,
  toggleStrikethrough,
  toggleUnorderedList,
} from '../../../components/editor/toggle-mark.js';

/**
 * Creates a bare view with the given document and selection.
 * @param {string} doc Document text.
 * @param {number} from Selection anchor.
 * @param {number} to Selection head.
 * @returns {object} View handle with destroy().
 */
function createView(doc, from, to = from) {
  const host = document.createElement('div');
  document.body.append(host);
  const view = new EditorView({ parent: host, doc, extensions: [] });
  view.dispatch({ selection: EditorSelection.range(from, to) });
  return {
    view,
    destroy() {
      view.destroy();
      host.remove();
    },
  };
}

function docOf(view) {
  return view.state.doc.toString();
}

function selectionOf(view) {
  const range = view.state.selection.main;
  return [range.anchor, range.head];
}

test('should_wrap_selection_when_bold_toggles_on', () => {
  const { view, destroy } = createView('a word b', 2, 6);
  try {
    assert.equal(toggleBold(view), true);
    assert.equal(docOf(view), 'a **word** b');
    assert.deepEqual(selectionOf(view), [2, 10]);
  } finally {
    destroy();
  }
});

test('should_unwrap_selection_when_bold_toggles_off', () => {
  const { view, destroy } = createView('a **word** b', 2, 10);
  try {
    assert.equal(toggleBold(view), true);
    assert.equal(docOf(view), 'a word b');
    assert.deepEqual(selectionOf(view), [2, 6]);
  } finally {
    destroy();
  }
});

test('should_insert_markers_when_selection_is_empty', () => {
  const { view, destroy } = createView('ab', 1);
  try {
    assert.equal(toggleBold(view), true);
    assert.equal(docOf(view), 'a****b');
    assert.deepEqual(selectionOf(view), [3, 3]);
  } finally {
    destroy();
  }
});

test('should_toggle_italic_when_called', () => {
  const first = createView('a word b', 2, 6);
  try {
    toggleItalic(first.view);
    assert.equal(docOf(first.view), 'a *word* b');
  } finally {
    first.destroy();
  }
  const second = createView('a *word* b', 2, 8);
  try {
    toggleItalic(second.view);
    assert.equal(docOf(second.view), 'a word b');
  } finally {
    second.destroy();
  }
});

test('should_toggle_strikethrough_when_called', () => {
  const first = createView('a word b', 2, 6);
  try {
    toggleStrikethrough(first.view);
    assert.equal(docOf(first.view), 'a ~~word~~ b');
  } finally {
    first.destroy();
  }
  const second = createView('a ~~word~~ b', 2, 10);
  try {
    toggleStrikethrough(second.view);
    assert.equal(docOf(second.view), 'a word b');
  } finally {
    second.destroy();
  }
});

test('should_toggle_code_when_called', () => {
  const { view, destroy } = createView('a word b', 2, 6);
  try {
    toggleCode(view);
    assert.equal(docOf(view), 'a `word` b');
  } finally {
    destroy();
  }
});

test('should_prefix_heading_when_line_is_plain', () => {
  const { view, destroy } = createView('line one\nline two', 10, 10);
  try {
    toggleHeading(view);
    assert.equal(docOf(view), 'line one\n# line two');
  } finally {
    destroy();
  }
});

test('should_remove_heading_when_line_has_one', () => {
  const { view, destroy } = createView('# line one\nline two', 0, 18);
  try {
    toggleHeading(view);
    assert.equal(docOf(view), 'line one\n# line two');
  } finally {
    destroy();
  }
});

test('should_toggle_quote_per_line_when_called', () => {
  const first = createView('a\nb', 0, 3);
  try {
    toggleQuote(first.view);
    assert.equal(docOf(first.view), '> a\n> b');
  } finally {
    first.destroy();
  }
  const second = createView('> a\n> b', 0, 7);
  try {
    toggleQuote(second.view);
    assert.equal(docOf(second.view), 'a\nb');
  } finally {
    second.destroy();
  }
});

test('should_toggle_unordered_list_per_line_when_called', () => {
  const first = createView('- a\nb', 0, 5);
  try {
    toggleUnorderedList(first.view);
    assert.equal(docOf(first.view), 'a\n- b');
  } finally {
    first.destroy();
  }
  const second = createView('a\n- b', 0, 5);
  try {
    toggleUnorderedList(second.view);
    assert.equal(docOf(second.view), '- a\nb');
  } finally {
    second.destroy();
  }
});

test('should_toggle_ordered_list_when_called', () => {
  const first = createView('a\nb', 0, 3);
  try {
    toggleOrderedList(first.view);
    assert.equal(docOf(first.view), '1. a\n1. b');
  } finally {
    first.destroy();
  }
  const second = createView('1. a\n2. b', 0, 8);
  try {
    toggleOrderedList(second.view);
    assert.equal(docOf(second.view), 'a\nb');
  } finally {
    second.destroy();
  }
});

test('should_wrap_link_and_place_cursor_when_selection_exists', () => {
  const { view, destroy } = createView('click here now', 6, 10);
  try {
    insertLink(view);
    assert.equal(docOf(view), 'click [here]() now');
    assert.deepEqual(selectionOf(view), [13, 13]);
  } finally {
    destroy();
  }
});

test('should_insert_link_template_when_selection_is_empty', () => {
  const { view, destroy } = createView('', 0);
  try {
    insertLink(view);
    assert.equal(docOf(view), '[]()');
    assert.deepEqual(selectionOf(view), [1, 1]);
  } finally {
    destroy();
  }
});

test('should_match_shortcuts_by_code_when_queried', () => {
  assert.equal(shortcutCommand({ code: 'KeyB', ctrlKey: true }), toggleBold);
  assert.equal(shortcutCommand({ code: 'KeyI', ctrlKey: true }), toggleItalic);
  assert.equal(shortcutCommand({ code: 'KeyS', ctrlKey: true, shiftKey: true }), toggleStrikethrough);
  assert.equal(shortcutCommand({ code: 'KeyH', ctrlKey: true }), toggleHeading);
  assert.equal(shortcutCommand({ code: 'KeyQ', ctrlKey: true }), toggleQuote);
  assert.equal(shortcutCommand({ code: 'KeyK', ctrlKey: true }), insertLink);
  assert.equal(shortcutCommand({ code: 'KeyE', ctrlKey: true }), toggleCode);
  assert.equal(shortcutCommand({ code: 'KeyL', ctrlKey: true, shiftKey: true }), toggleOrderedList);
  assert.equal(shortcutCommand({ code: 'KeyU', ctrlKey: true, shiftKey: true }), toggleUnorderedList);
});

test('should_ignore_key_layout_when_matching', () => {
  assert.equal(shortcutCommand({ code: 'KeyB', key: 'ذ', ctrlKey: true }), toggleBold);
  assert.equal(shortcutCommand({ code: 'KeyU', key: 'ع', ctrlKey: true, shiftKey: true }), toggleUnorderedList);
});

test('should_reject_missing_modifiers_when_matching', () => {
  assert.equal(shortcutCommand({ code: 'KeyB' }), null);
  assert.equal(shortcutCommand({ code: 'KeyB', ctrlKey: true, altKey: true }), null);
  assert.equal(shortcutCommand({ code: 'KeyB', ctrlKey: true, shiftKey: true }), null);
  assert.equal(shortcutCommand({ code: 'KeyA', ctrlKey: true }), null);
});
