// Verifies admonition collection (pure) and decorations.
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { createMarkdownView } from '../../../components/editor/markdown-view.js';
import { ADMONITION_KINDS, collectAdmonitions } from '../../../components/editor/admonition-view.js';

function collect(text, selection) {
  const state = EditorState.create({ doc: text, selection: selection ?? { anchor: 0 } });
  return collectAdmonitions(state);
}

test('should_know_five_kinds_when_listed', () => {
  assert.deepEqual(Object.keys(ADMONITION_KINDS), ['هشدار', 'احتیاط', 'مهم', 'راهنما', 'نکته']);
  for (const kind of Object.values(ADMONITION_KINDS)) {
    for (const scheme of ['light', 'dark', 'sepia']) {
      assert.ok(kind.accent[scheme] && kind.wash[scheme], `expected ${scheme} colors`);
    }
  }
});

test('should_collect_block_when_fenced', () => {
  const blocks = collect('متن\n\n... هشدار\nمحتوا\n...\n\nبعد');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'هشدار');
});

test('should_reject_unknown_kind_and_extra_words_when_scanning', () => {
  assert.deepEqual(collect('... ناشناخته\nx\n...'), []);
  assert.deepEqual(collect('... هشدار اضافه\nx\n...'), []);
  assert.deepEqual(collect('.... هشدار\nx\n...'), []);
});

test('should_run_to_end_when_unclosed', () => {
  const text = 'متن\n\n... نکته\nالف\nب';
  const blocks = collect(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'نکته');
  assert.equal(text.slice(blocks[0].from, blocks[0].to), '... نکته\nالف\nب');
});

test('should_allow_indent_and_quote_when_scanning', () => {
  assert.equal(collect('  ... مهم\nx\n...').length, 1);
  assert.equal(collect('> ... راهنما\n> x\n> ...').length, 1);
  assert.equal(collect('    ... هشدار\nx\n...').length, 0);
});

test('should_skip_fenced_code_when_scanning', () => {
  assert.deepEqual(collect('```\n... هشدار\n```'), []);
});

function createEditor(documentText) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: documentText });
  return { host, editor };
}

test('should_wash_and_label_when_block_is_present', () => {
  const { host, editor } = createEditor('متن\n\n... هشدار\nمحتوا\n...\n\nبعد');
  try {
    const washed = [...host.querySelectorAll('.parsi-admonition-line')];
    assert.equal(washed.length, 1);
    assert.ok(washed[0].textContent.includes('محتوا'));
    const label = host.querySelector('.parsi-admonition-label');
    assert.ok(label, 'expected the kind chip');
    assert.equal(label.textContent, 'هشدار');
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_reveal_fence_when_cursor_touches_it', () => {
  // Fresh cursor at 0 is far from the block: fences stay hidden.
  const { host, editor } = createEditor('متن\n\n... هشدار\nمحتوا\n...');
  try {
    assert.equal(host.querySelectorAll('.parsi-fence-hidden').length, 2);
  } finally {
    editor.destroy();
    host.remove();
  }
});
