// Verifies scoped search helpers (pure, headless EditorState, no view).
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { collectSearchMatches, createSearchQuery, indexOfMatchAt, normalizeSearchSpec, resolveSearchScope } from '../../../components/editor/search-ops.js';

function stateWith(text, selection) {
  return EditorState.create({
    doc: text,
    selection: selection ?? { anchor: 0 },
  });
}

test('should_normalize_partial_specs_when_normalizing', () => {
  assert.deepEqual(normalizeSearchSpec(null), {
    query: '', replace: '', caseSensitive: false, wholeWord: false, regexp: false, inSelection: false,
  });
  assert.deepEqual(normalizeSearchSpec({ query: 'a', regexp: 1, inSelection: 'yes' }), {
    query: 'a', replace: '', caseSensitive: false, wholeWord: false, regexp: false, inSelection: false,
  });
});

test('should_clear_on_empty_query_when_creating', () => {
  assert.deepEqual(createSearchQuery({ query: '' }), { query: null });
  const { query } = createSearchQuery({ query: 'سلام', caseSensitive: true });
  assert.ok(query);
  assert.equal(query.search, 'سلام');
  assert.equal(query.caseSensitive, true);
});

test('should_reject_invalid_regexp_when_creating', () => {
  // A literal string is always searchable, even with regexp syntax in it.
  const { query: literal } = createSearchQuery({ query: '([' });
  assert.ok(literal?.valid);
  assert.deepEqual(createSearchQuery({ query: '([', regexp: true }), { error: 'invalid-regexp' });
  const { query } = createSearchQuery({ query: '(a)(b)', regexp: true });
  assert.ok(query?.valid);
});

test('should_scope_to_selection_when_in_selection', () => {
  const state = stateWith('aaa aaa', { anchor: 4, head: 7 });
  assert.deepEqual(resolveSearchScope(state, { inSelection: true }), { from: 4, to: 7 });
  assert.deepEqual(resolveSearchScope(state, { inSelection: false }), { from: 0, to: 7 });
  const caret = stateWith('aaa aaa', { anchor: 2 });
  assert.deepEqual(resolveSearchScope(caret, { inSelection: true }), { from: 0, to: 7 });
});

test('should_collect_doc_matches_when_scanning', () => {
  const state = stateWith('یک دو یک');
  const { query } = createSearchQuery({ query: 'یک' });
  const matches = collectSearchMatches(state, query, { from: 0, to: state.doc.length });
  assert.equal(matches.length, 2);
  assert.deepEqual([matches[0].from, matches[0].to], [0, 2]);
  assert.deepEqual([matches[1].from, matches[1].to], [6, 8]);
  assert.equal(matches[0].replacement, '');
});

test('should_filter_to_scope_when_scanning', () => {
  const state = stateWith('یک دو یک');
  const { query } = createSearchQuery({ query: 'یک' });
  const matches = collectSearchMatches(state, query, { from: 3, to: state.doc.length });
  assert.equal(matches.length, 1);
  assert.deepEqual([matches[0].from, matches[0].to], [6, 8]);
});

test('should_respect_flags_when_scanning', () => {
  const state = stateWith('Go go GO');
  const { query: sensitive } = createSearchQuery({ query: 'go', caseSensitive: true });
  assert.equal(collectSearchMatches(state, sensitive, { from: 0, to: 8 }).length, 1);
  const { query: loose } = createSearchQuery({ query: 'go' });
  assert.equal(collectSearchMatches(state, loose, { from: 0, to: 8 }).length, 3);
  const { query: whole } = createSearchQuery({ query: 'go', wholeWord: true });
  assert.equal(collectSearchMatches(stateWith('go go', null), whole, { from: 0, to: 5 }).length, 2);
  assert.equal(collectSearchMatches(stateWith('gogo', null), whole, { from: 0, to: 4 }).length, 0);
});

test('should_expand_groups_when_replacing_regexp', () => {
  const state = stateWith('سال 1402 و 1403');
  const { query } = createSearchQuery({ query: '(\\d+)', regexp: true, replace: '[$1]' });
  const matches = collectSearchMatches(state, query, { from: 0, to: state.doc.length });
  assert.equal(matches.length, 2);
  assert.equal(matches[0].replacement, '[1402]');
  assert.equal(matches[1].replacement, '[1403]');
});

test('should_locate_match_at_position_when_indexing', () => {
  const matches = [{ from: 0, to: 2 }, { from: 6, to: 8 }];
  assert.equal(indexOfMatchAt(matches, 1), 0);
  assert.equal(indexOfMatchAt(matches, 8), 1);
  assert.equal(indexOfMatchAt(matches, 4), -1);
});
