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
  assert.ok(html.includes('outline-level-1'));
  assert.ok(html.includes('outline-level-2'));
  assert.ok(html.includes('>دو<'));
});

test('should_render_empty_state_when_no_headings', () => {
  const html = renderOutlineView({ t: translate, documentText: 'متن ساده' });
  assert.ok(html.includes('part="outline-empty"'));
  assert.ok(html.includes('خالی'));
});
