// Verifies horizontal-rule rendering (pure) and decorations.
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { createMarkdownView } from '../../../components/editor/markdown-view.js';
import { collectHrHides } from '../../../components/editor/hr-view.js';

function collect(text, selection) {
  const state = EditorState.create({
    doc: text,
    selection: selection ?? { anchor: 0 },
    extensions: [markdown()],
  });
  return collectHrHides(state);
}

test('should_hide_dashes_stars_and_underscores_when_rules', () => {
  assert.deepEqual(collect('متن\n\n---\n\nبعد'), [{ from: 5, to: 8 }]);
  assert.deepEqual(collect('متن\n\n***\n\nبعد'), [{ from: 5, to: 8 }]);
  assert.deepEqual(collect('  ___  '), [{ from: 2, to: 7 }]);
});

test('should_keep_setext_underline_visible_when_scanning', () => {
  assert.deepEqual(collect('عنوان\n---\n'), []);
});

test('should_keep_fenced_dashes_visible_when_scanning', () => {
  assert.deepEqual(collect('```\n---\n```'), []);
});

test('should_reveal_touched_rule_when_selected', () => {
  const text = 'متن\n\n---\n\nبعد';
  assert.equal(collect(text, { anchor: 0 }).length, 1);
  assert.deepEqual(collect(text, { anchor: 6 }), []);
});

function createEditor(documentText) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: documentText });
  return { host, editor };
}

test('should_render_rule_but_hide_marks_when_rendered', () => {
  const { host, editor } = createEditor('متن\n\n---\n\nبعد');
  try {
    assert.ok(host.querySelector('.cm-line.parsi-hr-line'), 'expected the rule line');
    assert.equal(host.querySelectorAll('.parsi-hr-hidden').length, 1);
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_reveal_rule_when_cursor_is_on_it', () => {
  const { host, editor } = createEditor('---\n\nمتن');
  try {
    // Fresh cursor at 0 touches the rule: raw source stays visible.
    assert.equal(host.querySelector('.cm-line.parsi-hr-line'), null);
    assert.equal(host.querySelectorAll('.parsi-hr-hidden').length, 0);
  } finally {
    editor.destroy();
    host.remove();
  }
});
