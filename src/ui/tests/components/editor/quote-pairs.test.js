// Verifies quote/backtick pairing (real CodeMirror view in jsdom).
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { deletePair, pairInput } from '../../../components/editor/quote-pairs.js';

function createView(documentText, selection) {
  const host = document.createElement('div');
  document.body.append(host);
  const view = new EditorView({ doc: documentText, parent: host });
  view.dispatch({ selection });
  return { host, view };
}

function destroy({ host, view }) {
  view.destroy();
  host.remove();
}

function typed(documentText, cursor, key) {
  const mounted = createView(documentText, EditorSelection.cursor(cursor));
  try {
    const handled = pairInput(mounted.view, key);
    return {
      handled,
      text: mounted.view.state.doc.toString(),
      cursor: mounted.view.state.selection.main.head,
    };
  } finally {
    destroy(mounted);
  }
}

test('should_pair_quotes_when_typed_at_boundary', () => {
  assert.deepEqual(
    [typed('متن', 3, '"'), typed('متن', 3, "'"), typed('متن', 3, '`')].map(({ handled, text, cursor }) => [handled, text, cursor]),
    [
      [true, 'متن""', 4],
      [true, "متن''", 4],
      [true, 'متن``', 4],
    ],
  );
});

test('should_pair_guillemets_when_typed', () => {
  const result = typed('متن', 3, '«');
  assert.equal(result.handled, true);
  assert.equal(result.text, 'متن«»');
  assert.equal(result.cursor, 4);
});

test('should_insert_single_quote_before_word', () => {
  const result = typed('متن', 0, '"');
  assert.equal(result.handled, false);
  assert.equal(result.text, 'متن');
});

test('should_step_over_closer_when_typed_twice', () => {
  assert.deepEqual([typed('متن""', 4, '"').cursor, typed('«»', 1, '»').cursor], [5, 2]);
});

test('should_wrap_selection_when_typing_quote', () => {
  const mounted = createView('متن', EditorSelection.range(0, 3));
  try {
    assert.equal(pairInput(mounted.view, '"'), true);
    assert.equal(mounted.view.state.doc.toString(), '"متن"');
    assert.deepEqual(
      [mounted.view.state.selection.main.from, mounted.view.state.selection.main.to],
      [1, 4],
    );
  } finally {
    destroy(mounted);
  }
});

test('should_ignore_unrelated_keys_when_typing', () => {
  const mounted = createView('متن', EditorSelection.cursor(3));
  try {
    assert.equal(pairInput(mounted.view, 'a'), false);
    assert.equal(pairInput(mounted.view, 'Enter'), false);
    assert.equal(mounted.view.state.doc.toString(), 'متن');
  } finally {
    destroy(mounted);
  }
});

test('should_remove_empty_pair_when_backspacing', () => {
  for (const [text, cursor, expected] of [
    ['متن""x', 4, 'متنx'],
    ["متن''x", 4, 'متنx'],
    ['متن``x', 4, 'متنx'],
    ['متن«»x', 4, 'متنx'],
  ]) {
    const mounted = createView(text, EditorSelection.cursor(cursor));
    try {
      assert.equal(deletePair(mounted.view), true, text);
      assert.equal(mounted.view.state.doc.toString(), expected);
      assert.equal(mounted.view.state.selection.main.head, cursor - 1);
    } finally {
      destroy(mounted);
    }
  }
});

test('should_ignore_backspace_outside_pair', () => {
  const mounted = createView('متن', EditorSelection.cursor(3));
  try {
    assert.equal(deletePair(mounted.view), false);
  } finally {
    destroy(mounted);
  }
  const selected = createView('ab', EditorSelection.range(0, 2));
  try {
    assert.equal(deletePair(selected.view), false);
  } finally {
    destroy(selected);
  }
});
