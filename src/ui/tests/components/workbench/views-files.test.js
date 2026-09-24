// Verifies the files view rendering (pure, no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_FILES_SORT, FILES_SORT_MODES, renderFilesView, sortDocuments } from '../../../components/workbench/views-files.js';

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
  assert.ok(html.includes('data-current="true"'));
  assert.equal((html.match(/data-current/g) ?? []).length, 1);
});

test('should_render_actions_when_called', () => {
  const html = renderFilesView({ t: translate, items: [], currentId: null, assetBaseUrl: 'http://localhost/assets/' });
  assert.ok(html.includes('part="docs-new"'));
  assert.ok(!html.includes('part="docs-delete"'), 'expected no panel delete button');
  assert.ok(html.includes('aria-label="سند تازه"'));
  assert.ok(html.includes('<svg'));
  assert.ok(html.includes('#plus'));
});

test('should_render_menu_button_when_items_are_given', () => {
  const html = renderFilesView({ t: translate, items: [{ id: 'a', title: 'اول' }], currentId: null });
  assert.ok(html.includes('data-doc-menu="a"'));
  assert.ok(html.includes('aria-haspopup="true"'));
  assert.ok(!html.includes('part="file-menu"'), 'expected closed menu');
});

test('should_render_menu_when_open_menu_matches', () => {
  const html = renderFilesView({ t: translate, items: [{ id: 'a', title: 'اول' }], currentId: null, openMenuId: 'a' });
  assert.ok(html.includes('part="file-menu"'));
  assert.ok(html.includes('data-file-rename="a"'));
  assert.ok(html.includes('data-file-download="a"'));
  assert.ok(html.includes('data-file-properties="a"'));
  assert.ok(html.includes('data-file-delete="a"'));
  assert.ok(html.includes('aria-expanded="true"'));
});

test('should_render_rename_input_when_editing', () => {
  const html = renderFilesView({
    t: translate,
    items: [{ id: 'a', title: 'اول' }],
    currentId: null,
    editing: { id: 'a', error: null },
  });
  assert.ok(html.includes('data-rename-input="a"'));
  assert.ok(html.includes('value="اول"'));
  assert.ok(!html.includes('part="docs-error"'));
});

test('should_render_rename_error_when_given', () => {
  const html = renderFilesView({
    t: (key) => key === 'parsinegar.documents.duplicate' ? 'تکراری است' : translate(key),
    items: [{ id: 'a', title: 'اول' }],
    currentId: null,
    editing: { id: 'a', error: 'parsinegar.documents.duplicate' },
  });
  assert.ok(html.includes('تکراری است'));
  assert.ok(html.includes('role="alert"'));
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

test('should_render_sort_select_with_default_when_mode_is_missing', () => {
  const html = renderFilesView({ t: translate, items: [], currentId: null });
  assert.ok(html.includes('data-files-sort'), 'expected the sort select');
  assert.ok(html.includes('aria-label'), 'expected an accessible label');
  for (const mode of FILES_SORT_MODES) {
    assert.ok(html.includes(`value="${mode}"`), `expected option ${mode}`);
  }
  assert.ok(html.includes(`value="${DEFAULT_FILES_SORT}" selected`), 'expected the default selected');
  assert.equal(DEFAULT_FILES_SORT, 'updated-desc');
});

test('should_mark_given_sort_mode_when_selected', () => {
  const html = renderFilesView({ t: translate, items: [], currentId: null, sortMode: 'name' });
  assert.ok(html.includes('value="name" selected'), 'expected the name option selected');
  assert.ok(!html.includes('value="updated-desc" selected'), 'expected the default unselected');
});

test('should_fall_back_to_default_when_sort_mode_is_unknown', () => {
  const html = renderFilesView({ t: translate, items: [], currentId: null, sortMode: 'nope' });
  assert.ok(html.includes(`value="${DEFAULT_FILES_SORT}" selected`), 'expected the default selected');
});

test('should_order_by_updated_when_sorting', () => {
  const items = [
    { id: 'a', title: 'a', updatedAt: 100 },
    { id: 'b', title: 'b', updatedAt: 300 },
    { id: 'c', title: 'c', updatedAt: 200 },
  ];
  assert.deepEqual(sortDocuments(items, 'updated-desc').map((item) => item.id), ['b', 'c', 'a']);
  assert.deepEqual(sortDocuments(items, 'updated-asc').map((item) => item.id), ['a', 'c', 'b']);
  assert.deepEqual(items.map((item) => item.id), ['a', 'b', 'c'], 'expected the input untouched');
});

test('should_order_by_created_when_sorting', () => {
  const items = [
    { id: 'a', title: 'a', createdAt: 300, updatedAt: 100 },
    { id: 'b', title: 'b', createdAt: 100, updatedAt: 300 },
    { id: 'c', title: 'c', createdAt: 200, updatedAt: 200 },
  ];
  assert.deepEqual(sortDocuments(items, 'created-desc').map((item) => item.id), ['a', 'c', 'b']);
  assert.deepEqual(sortDocuments(items, 'created-asc').map((item) => item.id), ['b', 'c', 'a']);
});

test('should_order_by_name_when_sorting', () => {
  const items = [
    { id: 'a', title: 'یادداشت' },
    { id: 'b', title: 'دوم' },
    { id: 'c', title: 'اول' },
  ];
  assert.deepEqual(sortDocuments(items, 'name').map((item) => item.id), ['c', 'b', 'a']);
});

test('should_keep_input_order_when_mode_is_unknown', () => {
  const items = [
    { id: 'a', title: 'b', updatedAt: 100 },
    { id: 'b', title: 'a', updatedAt: 300 },
  ];
  const ordered = sortDocuments(items, 'nope');
  assert.deepEqual(ordered.map((item) => item.id), ['a', 'b']);
  assert.notEqual(ordered, items, 'expected a copy');
});

test('should_tolerate_missing_fields_when_sorting', () => {
  const items = [{ id: 'a' }, { id: 'b', title: null }, {}];
  assert.equal(sortDocuments(items, 'updated-desc').length, 3);
  assert.equal(sortDocuments(items, 'created-asc').length, 3);
  assert.equal(sortDocuments(items, 'name').length, 3);
  assert.deepEqual(sortDocuments(null, 'name'), []);
  assert.deepEqual(sortDocuments('nope', 'name'), []);
});
