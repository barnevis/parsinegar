// Verifies the files view rendering (pure, no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderFilesView } from '../../../components/workbench/views-files.js';

function translate(key) {
  return { 'parsinegar.documents.new': 'سند تازه', 'parsinegar.documents.delete': 'حذف سند' }[key] ?? key;
}

test('should_render_items_when_documents_are_given', () => {
  const html = renderFilesView({
    t: translate,
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

test('should_render_actions_when_called', () => {
  const html = renderFilesView({ t: translate, items: [], currentId: null });
  assert.ok(html.includes('part="docs-new"'));
  assert.ok(html.includes('part="docs-delete"'));
  assert.ok(html.includes('سند تازه'));
});

test('should_escape_titles_when_malicious', () => {
  const html = renderFilesView({ t: translate, items: [{ id: 'x', title: '<img src=x>' }], currentId: 'x' });
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
});

test('should_render_empty_list_when_no_items', () => {
  assert.ok(renderFilesView({ t: translate, items: [], currentId: null }).includes('<ul part="docs-list"></ul>'));
});
