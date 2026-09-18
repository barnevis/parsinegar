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

test('should_highlight_active_heading_when_active_line_is_given', () => {
  const html = renderOutlineView({ t: translate, documentText: '# یک\nمتن\n## دو', activeLine: 3 });
  assert.ok(html.includes('data-line="3" aria-current="true"'), 'expected current on line 3');
  assert.ok(!html.includes('data-line="1" aria-current'), 'expected no current on line 1');
});

test('should_highlight_nothing_when_active_line_matches_no_heading', () => {
  const html = renderOutlineView({ t: translate, documentText: '# یک\nمتن', activeLine: 2 });
  assert.ok(!html.includes('aria-current'), 'expected no highlight');
});

test('should_highlight_nothing_when_active_line_is_absent', () => {
  const html = renderOutlineView({ t: translate, documentText: '# یک\nمتن' });
  assert.ok(!html.includes('aria-current'), 'expected no highlight');
});

test('should_toggle_children_when_collapsed', () => {
  const text = '# یک\n## دو\n# سه';
  const open = renderOutlineView({ t: translate, documentText: text });
  assert.ok(open.includes('data-line="2"'), 'expected the child visible');
  assert.ok(open.includes('data-outline-toggle="1"'), 'expected a toggle on the parent');
  assert.ok(!open.includes('data-outline-toggle="2"'), 'expected no toggle on the leaf');
  assert.ok(open.includes('aria-expanded="true"'));
  const closed = renderOutlineView({ t: translate, documentText: text, collapsed: [1] });
  assert.ok(!closed.includes('data-line="2"'), 'expected the child hidden');
  assert.ok(closed.includes('data-line="3"'), 'expected the sibling kept');
  assert.ok(closed.includes('aria-expanded="false"'));
});

test('should_align_leaves_with_parents_when_rendered', () => {
  const html = renderOutlineView({ t: translate, documentText: '# یک\n## دو\n# سه' });
  assert.ok(html.includes('part="outline-spacer"'), 'expected a spacer on the leaf');
  assert.ok(!html.includes('▸') && !html.includes('▾'), 'expected no text glyph toggles');
  assert.ok(html.includes('part="outline-chevron"'), 'expected a chevron toggle');
});

test('should_ignore_invalid_collapsed_when_given', () => {
  const html = renderOutlineView({ t: translate, documentText: '# یک\n## دو', collapsed: ['x', null] });
  assert.ok(html.includes('data-line="2"'));
});
