// Verifies the list-aware Home cycle (real CodeMirror in jsdom): first
// press parks at the item's text start, the next goes to the line start.
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorView } from 'codemirror';
import { EditorSelection } from '@codemirror/state';
import { createMarkdownView } from '../../../components/editor/markdown-view.js';

function createEditor(documentText) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: documentText });
  const content = host.querySelector('.cm-content');
  const view = () => EditorView.findFromDOM(content);
  const head = () => view().state.selection.main.head;
  const anchor = () => view().state.selection.main.anchor;
  // Park the cursor (head) somewhere, keeping the anchor where asked.
  const park = (position, anchorPosition = position) => view().dispatch({
    selection: EditorSelection.range(anchorPosition, position),
  });
  const pressHome = () => content.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Home', code: 'Home', bubbles: true, cancelable: true }),
  );
  return { editor, head, anchor, park, pressHome, destroy: () => { editor.destroy(); host.remove(); } };
}

test('should_park_home_after_marker_when_pressed_on_list_line', () => {
  const mounted = createEditor('- کار اول');
  try {
    mounted.park(6);
    mounted.pressHome();
    assert.equal(mounted.head(), 2, 'expected the head right after the `- ` marker');
    mounted.pressHome();
    assert.equal(mounted.head(), 0, 'expected the head at the line start when already parked');
    mounted.pressHome();
    assert.equal(mounted.head(), 2, 'expected the cycle back to the text start');
  } finally {
    mounted.destroy();
  }
});

test('should_park_home_after_ordered_markers_with_both_digit_runs', () => {
  for (const [text, contentStart] of [['1) کار', 3], ['۱. کار', 3]]) {
    const mounted = createEditor(text);
    try {
      mounted.park(text.length);
      mounted.pressHome();
      assert.equal(mounted.head(), contentStart, `expected the head after the marker of ${text}`);
    } finally {
      mounted.destroy();
    }
  }
});

test('should_park_home_after_task_box_when_pressed_on_task_line', () => {
  for (const text of ['- [ ] کار', '- [x] کار', '1. [X] کار']) {
    const mounted = createEditor(text);
    try {
      mounted.park(text.length);
      mounted.pressHome();
      assert.equal(mounted.head(), text.indexOf('کار'), `expected the head after the task box of ${text}`);
    } finally {
      mounted.destroy();
    }
  }
});

test('should_keep_indent_when_parking_inside_nested_list', () => {
  const mounted = createEditor('متن\n\n\t- کار تودرتو');
  try {
    const lineStart = mounted.editor.getValue().indexOf('\t- کار تودرتو');
    mounted.park(lineStart + 8);
    mounted.pressHome();
    assert.equal(mounted.head(), lineStart + '\t- '.length, 'expected the head after the marker, indent kept');
    mounted.pressHome();
    assert.equal(mounted.head(), lineStart, 'expected the absolute line start on the second press');
  } finally {
    mounted.destroy();
  }
});

test('should_park_at_line_end_on_empty_item_and_still_cycle', () => {
  const mounted = createEditor('- ');
  try {
    mounted.park(0);
    mounted.pressHome();
    assert.equal(mounted.head(), 2, 'expected the head parked at the line end (no text after the marker)');
    mounted.pressHome();
    assert.equal(mounted.head(), 0, 'expected the line start when already parked there');
  } finally {
    mounted.destroy();
  }
});

test('should_fall_back_to_line_start_when_line_is_not_a_list_item', () => {
  for (const text of ['متن ساده', '**bold** rest', '۱ کار بدون نقطه']) {
    const mounted = createEditor(text);
    try {
      mounted.park(Math.max(1, Math.floor(text.length / 2)));
      mounted.pressHome();
      assert.equal(mounted.head(), 0, `expected the plain line start on ${JSON.stringify(text)}`);
    } finally {
      mounted.destroy();
    }
  }
});

test('should_not_treat_list_lookalike_inside_fenced_code_as_list', () => {
  const mounted = createEditor('پاراگراف\n\n```\n- کار کد\n```');
  try {
    const lineStart = mounted.editor.getValue().indexOf('- کار کد');
    mounted.park(lineStart + 4);
    mounted.pressHome();
    assert.equal(mounted.head(), lineStart, 'expected the plain line start inside the fence');
  } finally {
    mounted.destroy();
  }
});

test('should_stretch_selection_toward_target_while_anchor_stays', () => {
  const mounted = createEditor('- کار اول');
  try {
    mounted.park(6, 9);
    mounted.pressHome();
    assert.equal(mounted.head(), 2, 'expected the head at the text start');
    assert.equal(mounted.anchor(), 9, 'expected the anchor untouched');
  } finally {
    mounted.destroy();
  }
});
