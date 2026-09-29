// Verifies fence-line hiding (pure) and decorations.
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { createMarkdownView } from '../../../components/editor/markdown-view.js';
import { collectFenceHides } from '../../../components/editor/code-fence.js';

function collect(text, selection) {
  const state = EditorState.create({ doc: text, selection: selection ?? { anchor: 0 } });
  return collectFenceHides(state);
}

test('should_hide_both_delimiters_when_block_is_present', () => {
  const hidden = collect('متن\n\n```js\nconst x = 1;\n```\n\nبعد');
  assert.equal(hidden.length, 2);
});

test('should_keep_empty_block_visible_when_scanning', () => {
  assert.deepEqual(collect('متن\n\n```\n```\n\nبعد'), []);
});

test('should_run_to_end_when_unclosed', () => {
  const hidden = collect('متن\n\n```js\nconst x = 1;');
  assert.equal(hidden.length, 1);
});

test('should_reveal_touched_line_when_selected', () => {
  const text = 'متن\n\n```js\nconst x = 1;\n```';
  assert.equal(collect(text, { anchor: 0 }).length, 2);
  assert.equal(collect(text, { anchor: 5 }).length, 1);
});

function createEditor(documentText) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: documentText });
  return { host, editor };
}

test('should_hide_fences_but_keep_button_when_rendered', () => {
  const { host, editor } = createEditor('متن\n\n```js\nconst x = 1;\n```\n\nبعد');
  try {
    assert.equal(host.querySelectorAll('.parsi-fence-hidden').length, 2);
    assert.ok(host.querySelector('.parsi-code-copy'), 'expected the copy button to stay');
    assert.ok(host.querySelector('.cm-line.parsi-code-line'), 'expected the code wash to stay');
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_reveal_fence_when_cursor_is_on_it', () => {
  const { host, editor } = createEditor('```js\nconst x = 1;\n```');
  try {
    // Fresh cursor at 0 touches the opener: only the closer hides.
    assert.equal(host.querySelectorAll('.parsi-fence-hidden').length, 1);
  } finally {
    editor.destroy();
    host.remove();
  }
});
