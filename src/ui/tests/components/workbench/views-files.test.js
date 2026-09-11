// Verifies the files view rendering (pure, no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderFilesView } from '../../../components/workbench/views-files.js';

test('should_render_items_when_documents_are_given', () => {
  const html = renderFilesView({
    items: [
      { id: 'a', title: 'اول' },
      { id: 'b', title: 'دوم' },
    ],
    currentId: 'b',
  });
  assert.ok(html.includes('data-doc-id="a"'));
  assert.ok(html.includes('data-doc-id="b"'));
  assert.ok(html.includes('aria-current="true"'));
  assert.equal((html.match(/aria-current/g) ?? []).length, 1);
});

test('should_escape_titles_when_malicious', () => {
  const html = renderFilesView({ items: [{ id: 'x', title: '<img src=x>' }], currentId: 'x' });
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
});

test('should_render_empty_list_when_no_items', () => {
  assert.ok(renderFilesView({ items: [], currentId: null }).includes('<ul part="docs-list"></ul>'));
});
