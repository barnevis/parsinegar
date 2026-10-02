// Verifies Markdown toggle commands (real CodeMirror view in jsdom).
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorView } from 'codemirror';
import { EditorSelection } from '@codemirror/state';
import {
  ADMONITION_KINDS,
  insertAdmonition,
  insertCodeBlock,
  insertHorizontalRule,
  insertImage,
  insertLink,
  insertPoem,
  insertTable,
  shortcutCommand,
  toggleBold,
  toggleCode,
  toggleHeading,
  toggleHighlight,
  toggleItalic,
  toggleOrderedList,
  toggleQuote,
  toggleStrikethrough,
  toggleTaskList,
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
    assert.equal(docOf(first.view), '1. a\n2. b');
    assert.equal(first.view.state.selection.main.head, 3);
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

test('should_number_sequentially_when_converting_mixed_lines', () => {
  const mixed = createView('1. a\nb\nc', 0, 8);
  try {
    toggleOrderedList(mixed.view);
    assert.equal(docOf(mixed.view), '1. a\n2. b\n3. c');
  } finally {
    mixed.destroy();
  }
});

test('should_number_per_level_when_converting_nested_lines', () => {
  const nested = createView('a\n\tb\nc', 0, 6);
  try {
    toggleOrderedList(nested.view);
    assert.equal(docOf(nested.view), '1. a\n\t1. b\n2. c');
  } finally {
    nested.destroy();
  }
});

test('should_remove_persian_prefixes_when_toggling_off', () => {
  const persian = createView('۱. الف\n۲. ب', 0, 11);
  try {
    toggleOrderedList(persian.view);
    assert.equal(docOf(persian.view), 'الف\nب');
  } finally {
    persian.destroy();
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
  assert.equal(shortcutCommand({ code: 'KeyT', ctrlKey: true, shiftKey: true }), toggleTaskList);
  assert.equal(shortcutCommand({ code: 'KeyH', ctrlKey: true, shiftKey: true }), toggleHighlight);
  assert.equal(shortcutCommand({ code: 'KeyM', ctrlKey: true, shiftKey: true }), insertImage);
  assert.equal(shortcutCommand({ code: 'KeyY', ctrlKey: true, shiftKey: true }), insertHorizontalRule);
  assert.equal(shortcutCommand({ code: 'KeyG', ctrlKey: true, shiftKey: true }), insertTable);
  assert.equal(shortcutCommand({ code: 'KeyX', ctrlKey: true, shiftKey: true }), insertPoem);
  assert.equal(shortcutCommand({ code: 'KeyE', ctrlKey: true, shiftKey: true }), insertCodeBlock);
  assert.equal(shortcutCommand({ code: 'KeyT', ctrlKey: true }), null);
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

test('should_toggle_task_box_per_line_when_task_toggles', () => {
  const plain = createView('متن', 2);
  try {
    assert.equal(toggleTaskList(plain.view), true);
    assert.equal(docOf(plain.view), '- [ ] متن');
  } finally {
    plain.destroy();
  }
  const bullet = createView('- مورد', 2);
  try {
    assert.equal(toggleTaskList(bullet.view), true);
    assert.equal(docOf(bullet.view), '- [ ] مورد');
  } finally {
    bullet.destroy();
  }
  const boxed = createView('- [x] انجام‌شده', 2);
  try {
    assert.equal(toggleTaskList(boxed.view), true);
    assert.equal(docOf(boxed.view), '- انجام‌شده');
  } finally {
    boxed.destroy();
  }
  const mixed = createView('- [ ] یک\n- دو', 0, 13);
  try {
    assert.equal(toggleTaskList(mixed.view), true);
    assert.equal(docOf(mixed.view), '- یک\n- [ ] دو');
  } finally {
    mixed.destroy();
  }
});

test('should_wrap_and_unwrap_highlight_when_toggled', () => {
  const empty = createView('', 0);
  try {
    assert.equal(toggleHighlight(empty.view), true);
    assert.equal(docOf(empty.view), '====');
    assert.deepEqual(selectionOf(empty.view), [2, 2]);
  } finally {
    empty.destroy();
  }
  const wrapped = createView('a word b', 2, 6);
  try {
    assert.equal(toggleHighlight(wrapped.view), true);
    assert.equal(docOf(wrapped.view), 'a ==word== b');
  } finally {
    wrapped.destroy();
  }
  const marked = createView('a ==word== b', 2, 10);
  try {
    assert.equal(toggleHighlight(marked.view), true);
    assert.equal(docOf(marked.view), 'a word b');
  } finally {
    marked.destroy();
  }
});

test('should_insert_image_template_when_image_inserts', () => {
  const empty = createView('', 0);
  try {
    assert.equal(insertImage(empty.view), true);
    assert.equal(docOf(empty.view), '![]()');
    assert.deepEqual(selectionOf(empty.view), [2, 2]);
  } finally {
    empty.destroy();
  }
  const selected = createView('a word b', 2, 6);
  try {
    assert.equal(insertImage(selected.view), true);
    assert.equal(docOf(selected.view), 'a ![word]() b');
  } finally {
    selected.destroy();
  }
});

test('should_insert_rule_with_padding_when_hr_inserts', () => {
  const blank = createView('متن\n\nبعد', 4);
  try {
    assert.equal(insertHorizontalRule(blank.view), true);
    assert.equal(docOf(blank.view), 'متن\n\n---\nبعد');
  } finally {
    blank.destroy();
  }
  const text = createView('متن', 3);
  try {
    assert.equal(insertHorizontalRule(text.view), true);
    assert.equal(docOf(text.view), 'متن\n\n---');
  } finally {
    text.destroy();
  }
});

test('should_insert_table_skeleton_when_table_inserts', () => {
  const blank = createView('', 0);
  try {
    assert.equal(insertTable(blank.view), true);
    assert.equal(docOf(blank.view), '|  |  |\n|---|---|\n|  |  |');
    assert.deepEqual(selectionOf(blank.view), [2, 2]);
  } finally {
    blank.destroy();
  }
});

test('should_insert_each_admonition_kind_when_inserts', () => {
  assert.deepEqual(ADMONITION_KINDS.map(({ id }) => id), ['warning', 'caution', 'important', 'tip', 'note']);
  for (const { word } of ADMONITION_KINDS) {
    const mounted = createView('', 0);
    try {
      assert.equal(insertAdmonition(mounted.view, word), true);
      assert.equal(docOf(mounted.view), `...${word}\n\n...`);
    } finally {
      mounted.destroy();
    }
  }
  const attachment = createView('', 0);
  try {
    assert.equal(insertPoem(attachment.view), true);
    assert.equal(docOf(attachment.view), '...شعر\n\n...');
  } finally {
    attachment.destroy();
  }
});

test('should_insert_fence_pair_when_code_block_inserts', () => {
  const blank = createView('متن\n\nبعد', 4);
  try {
    assert.equal(insertCodeBlock(blank.view), true);
    assert.equal(docOf(blank.view), 'متن\n```\n\n```\nبعد');
    assert.deepEqual(selectionOf(blank.view), [8, 8]);
  } finally {
    blank.destroy();
  }
});

test('should_refuse_code_block_inside_fenced_code_when_inserting', () => {
  const mounted = createView('```js\nconst x = 1;\n```', 10);
  try {
    assert.equal(insertCodeBlock(mounted.view), false);
    assert.equal(docOf(mounted.view), '```js\nconst x = 1;\n```');
  } finally {
    mounted.destroy();
  }
});
