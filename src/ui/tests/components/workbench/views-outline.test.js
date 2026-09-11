// Verifies the outline view rendering (pure, no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderOutlineView } from '../../../components/workbench/views-outline.js';

function translate(key) {
  return key === 'parsinegar.views.outline-empty' ? 'خالی' : key;
}

test('should_render_headings_when_document_has_them', () => {
  const html = renderOutlineView({ t: translate, documentText: '# یک\nمتن\n## دو' });
  assert.ok(html.includes('data-line="1"'));
  assert.ok(html.includes('data-line="3"'));
  assert.ok(html.includes('>دو<'));
});

test('should_nest_headings_as_tree_when_rendered', () => {
  const html = renderOutlineView({ t: translate, documentText: '# یک\n## دو\n# سه' });
  const firstList = html.indexOf('<ul part="outline-list">');
  const nestedList = html.indexOf('<ul part="outline-list">', firstList + 1);
  assert.ok(nestedList > firstList, 'expected a nested list');
  assert.ok(nestedList < html.indexOf('data-line="3"'), 'expected line 3 outside the nested list');
  assert.ok(html.indexOf('data-line="2"') > nestedList, 'expected line 2 inside the nested list');
});

test('should_nest_skipped_levels_under_closest_parent_when_rendered', () => {
  const html = renderOutlineView({ t: translate, documentText: '# یک\n### عمیق' });
  assert.ok(html.includes('data-line="2"'));
  const nestedList = html.indexOf('<ul part="outline-list">', html.indexOf('<ul part="outline-list">') + 1);
  assert.ok(nestedList > 0, 'expected a nested list for the skipped level');
});

test('should_render_empty_state_when_no_headings', () => {
  const html = renderOutlineView({ t: translate, documentText: 'متن ساده' });
  assert.ok(html.includes('part="outline-empty"'));
  assert.ok(html.includes('خالی'));
});
