// Verifies poem collection, hemistich splitting and decorations.
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { createMarkdownView } from '../../../components/editor/markdown-view.js';
import { collectPoems, splitHemistichs } from '../../../components/editor/poem-view.js';

function collect(text) {
  const state = EditorState.create({ doc: text });
  return collectPoems(state);
}

test('should_split_single_line_verse_when_gapped', () => {
  const halves = splitHemistichs('مصرع یک     مصرع دو');
  assert.equal(halves.length, 2);
  assert.deepEqual(halves[0], { from: 0, to: 7 });
  assert.equal('مصرع یک     مصرع دو'.slice(halves[1].from, halves[1].to), 'مصرع دو');
});

test('should_keep_single_span_when_ungapped', () => {
  assert.deepEqual(splitHemistichs('یک مصرع تنها'), [{ from: 0, to: 12 }]);
  assert.deepEqual(splitHemistichs(''), [{ from: 0, to: 0 }]);
});

test('should_collect_block_when_fenced', () => {
  const blocks = collect('متن\n\n...شعر\nبیت یک\n\nبیت دو\n...\n\nبعد');
  assert.equal(blocks.length, 1);
});

test('should_reject_spaced_opener_when_scanning', () => {
  assert.deepEqual(collect('... شعر\nx\n...'), []);
  assert.deepEqual(collect('....شعر\nx\n...'), []);
});

test('should_run_to_end_when_unclosed', () => {
  const text = 'متن\n\n...شعر\nبیت';
  const blocks = collect(text);
  assert.equal(blocks.length, 1);
  assert.equal(text.slice(blocks[0].from, blocks[0].to), '...شعر\nبیت');
});

test('should_skip_fenced_code_when_scanning', () => {
  assert.deepEqual(collect('```\n...شعر\n```'), []);
});

function createEditor(documentText) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: documentText });
  return { host, editor };
}

test('should_center_and_split_when_block_is_present', () => {
  const { host, editor } = createEditor('متن\n\n...شعر\nمصرع یک     مصرع دو\n...\n\nبعد');
  try {
    const lines = [...host.querySelectorAll('.parsi-poem-line')];
    assert.equal(lines.length, 1);
    const halves = [...lines[0].querySelectorAll('.parsi-hemistich-first, .parsi-hemistich-last')];
    assert.equal(halves.length, 2);
    assert.ok(halves[0].classList.contains('parsi-hemistich-first'));
    assert.ok(halves[1].classList.contains('parsi-hemistich-last'));
    assert.equal(host.querySelectorAll('.parsi-fence-hidden').length, 2);
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_center_whole_when_verse_is_single', () => {
  const { host, editor } = createEditor('متن\n\n...شعر\nیک مصرع تنها\n...');
  try {
    const lines = [...host.querySelectorAll('.parsi-poem-line')];
    assert.equal(lines.length, 1);
    assert.equal(lines[0].querySelectorAll('.parsi-hemistich-first').length, 0);
  } finally {
    editor.destroy();
    host.remove();
  }
});
