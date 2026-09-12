// Verifies the files view rendering (pure, no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderFilesView } from '../../../components/workbench/views-files.js';

function translate(key, params) {
  const template = {
    'parsinegar.documents.new': 'سند تازه',
    'parsinegar.documents.delete': 'حذف سند',
    'parsinegar.documents.delete-confirm': '«{title}» حذف شود؟',
    'parsinegar.documents.delete-yes': 'بله، حذف شود',
    'parsinegar.documents.delete-no': 'انصراف',
  }[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => params?.[name] ?? `{${name}}`);
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
  const html = renderFilesView({ t: translate, items: [], currentId: null, assetBaseUrl: 'http://localhost/assets/' });
  assert.ok(html.includes('part="docs-new"'));
  assert.ok(html.includes('part="docs-delete"'));
  assert.ok(html.includes('aria-label="سند تازه"'));
  assert.ok(html.includes('<svg'));
  assert.ok(html.includes('#plus'));
  assert.ok(html.includes('#trash'));
});

test('should_fall_back_to_text_when_no_sprite_is_available', () => {
  const html = renderFilesView({ t: translate, items: [], currentId: null, assetBaseUrl: null });
  assert.ok(!html.includes('<svg'));
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

test('should_render_confirm_with_name_when_confirm_matches', () => {
  const html = renderFilesView({
    t: translate,
    items: [{ id: 'a', title: 'سند مهم' }],
    currentId: 'a',
    confirmId: 'a',
  });
  assert.ok(html.includes('part="docs-confirm"'));
  assert.ok(html.includes('سند مهم'));
  assert.ok(html.includes('data-confirm-delete="yes"'));
  assert.ok(html.includes('data-confirm-delete="no"'));
  assert.ok(html.includes('بله، حذف شود'));
});

test('should_render_no_confirm_when_confirm_matches_nothing', () => {
  const html = renderFilesView({
    t: translate,
    items: [{ id: 'a', title: 'سند مهم' }],
    currentId: 'a',
    confirmId: null,
  });
  assert.equal(html.includes('part="docs-confirm"'), false);
});

test('should_escape_name_in_confirm_when_malicious', () => {
  const html = renderFilesView({
    t: translate,
    items: [{ id: 'a', title: '<img src=x>' }],
    currentId: 'a',
    confirmId: 'a',
  });
  assert.ok(!html.includes('<img src=x>'));
  assert.ok(html.includes('&lt;img'));
});
