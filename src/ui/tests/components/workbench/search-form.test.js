// Verifies the search form markup (pure, no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderSearchForm } from '../../../components/workbench/search-form.js';

const t = (key) => key;

test('should_render_fields_and_flags_when_rendered', () => {
  const markup = renderSearchForm({
    t,
    state: { query: 'a', replace: 'b', caseSensitive: true, wholeWord: false, regexp: true, inSelection: false },
  });
  assert.ok(markup.includes('data-search-query'));
  assert.ok(markup.includes('data-search-replace'));
  assert.ok(markup.includes('value="a"'));
  assert.ok(markup.includes('value="b"'));
  for (const flag of ['caseSensitive', 'wholeWord', 'regexp', 'inSelection']) {
    assert.ok(markup.includes(`data-search-flag="${flag}"`), `expected flag: ${flag}`);
  }
  const flagTag = (markup, flag) => markup.match(new RegExp(`<input[^>]*data-search-flag="${flag}"[^>]*>`))?.[0] ?? '';
  assert.ok(/ checked[ >]/.test(flagTag(markup, 'caseSensitive')), 'expected caseSensitive checked');
  assert.ok(!/ checked[ >]/.test(flagTag(markup, 'wholeWord')), 'expected wholeWord unchecked');
  for (const action of ['previous', 'next', 'replace-one', 'replace-all']) {
    assert.ok(markup.includes(`data-search-action="${action}"`), `expected action: ${action}`);
  }
  assert.ok(markup.includes('parsinegar.search.scope-note'));
  assert.ok(markup.includes('data-pey-preserve="search-query"'));
  assert.ok(markup.includes('data-pey-preserve="search-replace"'));
});

test('should_escape_values_when_rendered', () => {
  const markup = renderSearchForm({ t, state: { query: '<"&>' } });
  assert.ok(markup.includes('value="&lt;&quot;&amp;&gt;"'));
  assert.ok(!markup.includes('value="<"&>"'));
});

test('should_render_count_when_counted', () => {
  const fa = (value) => `⟦${value}⟧`;
  const withTemplate = (key) => (key === 'parsinegar.search.count' ? '{current} از {total}' : key);
  const counted = renderSearchForm({ t: withTemplate, state: { count: { current: 2, total: 5 } }, formatNumber: fa });
  assert.ok(counted.includes('⟦2⟧ از ⟦5⟧'));
  const empty = renderSearchForm({ t, state: { count: { current: 0, total: 0 } } });
  assert.ok(empty.includes('parsinegar.search.no-results'));
  const fresh = renderSearchForm({ t, state: {} });
  assert.ok(!fresh.includes('parsinegar.search.no-results'));
});

test('should_render_message_when_status_is_set', () => {
  const invalid = renderSearchForm({ t, state: { invalidRegexp: true } });
  assert.ok(invalid.includes('parsinegar.search.invalid-regexp'));
  const replaced = renderSearchForm({ t, state: { replaced: 3 } });
  assert.ok(replaced.includes('parsinegar.search.replaced'));
  const quiet = renderSearchForm({ t, state: {} });
  const message = quiet.match(/data-search-message>([^<]*)</)?.[1] ?? null;
  assert.equal(message, '');
});
