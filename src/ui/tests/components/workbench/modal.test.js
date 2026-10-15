// Verifies the delete-confirmation modal rendering (pure, no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderConfirmModal, renderPropertiesModal, renderSyncConflictModal } from '../../../components/workbench/modal.js';

function translate(key, params) {
  const template = {
    'parsinegar.documents.delete': 'حذف سند',
    'parsinegar.documents.delete-confirm': '«{title}» حذف شود؟',
    'parsinegar.documents.delete-yes': 'بله، حذف شود',
    'parsinegar.documents.delete-no': 'انصراف',
  }[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => params?.[name] ?? `{${name}}`);
}

test('should_render_empty_when_no_title_is_pending', () => {
  assert.equal(renderConfirmModal({ t: translate, title: null, assetBaseUrl: null }), '');
  assert.equal(renderConfirmModal({ t: translate, title: '', assetBaseUrl: null }), '');
});

test('should_render_dialog_with_name_when_title_is_pending', () => {
  const html = renderConfirmModal({ t: translate, title: 'سند مهم', assetBaseUrl: null });
  assert.ok(html.includes('part="modal-backdrop"'));
  assert.ok(html.includes('role="alertdialog"'));
  assert.ok(html.includes('aria-modal="true"'));
  assert.ok(html.includes('سند مهم'));
  assert.ok(html.includes('حذف سند'));
  assert.ok(html.includes('data-confirm-delete="yes"'));
  assert.ok(html.includes('data-confirm-delete="no"'));
  assert.ok(html.includes('بله، حذف شود'));
  assert.ok(html.includes('انصراف'));
});

test('should_escape_name_when_malicious', () => {
  const html = renderConfirmModal({ t: translate, title: '<img src=x>', assetBaseUrl: null });
  assert.ok(!html.includes('<img src=x>'));
  assert.ok(html.includes('&lt;img'));
});

test('should_include_icon_when_sprite_is_available', () => {
  const html = renderConfirmModal({ t: translate, title: 'سند مهم', assetBaseUrl: 'http://localhost/assets/' });
  assert.ok(html.includes('<svg'));
  assert.ok(html.includes('#delete'));
});

test('should_render_properties_when_record_is_given', async () => {
  const html = renderPropertiesModal({
    t: (key) => key,
    title: 'سند',
    createdText: 'C',
    updatedText: 'U',
    sizeText: 'S',
    assetBaseUrl: null,
  });
  assert.ok(html.includes('parsinegar.documents.properties'));
  assert.ok(html.includes('سند'));
  assert.ok(html.includes('role="dialog"'));
  assert.ok(html.includes('data-close-props'));
});

test('should_render_nothing_when_title_is_missing', async () => {
  assert.equal(renderPropertiesModal({ t: (key) => key, title: null }), '');
});

test('should_render_folder_variant_when_keys_are_given', () => {
  const html = renderConfirmModal({
    t: translate,
    title: 'کار',
    assetBaseUrl: null,
    headingKey: 'parsinegar.folders.delete',
    messageKey: 'parsinegar.folders.delete-confirm',
    messageParams: { count: 3 },
  });
  assert.ok(html.includes('parsinegar.folders.delete'), 'expected the folder heading key');
  assert.ok(html.includes('parsinegar.folders.delete-confirm'), 'expected the folder message key');
});

test('should_render_nothing_without_conflict_when_conflict_missing', () => {
  assert.equal(renderSyncConflictModal({ t: translate, conflict: null, assetBaseUrl: null }), '');
  assert.equal(renderSyncConflictModal({ t: translate, conflict: {}, assetBaseUrl: null }), '');
});

test('should_render_both_versions_with_choices_when_conflict_is_given', () => {
  const html = renderSyncConflictModal({
    t: (key) => key,
    assetBaseUrl: null,
    conflict: {
      collection: 'documents',
      id: 'd1',
      title: 'یادداشت',
      local: { updatedAt: 2, content: 'نسخه من' },
      remote: { updatedAt: 3, content: 'نسخه طرف' },
    },
  });
  assert.ok(html.includes('role="alertdialog"'));
  assert.ok(html.includes('نسخه من'));
  assert.ok(html.includes('نسخه طرف'));
  assert.ok(html.includes('data-sync-resolve="local"'));
  assert.ok(html.includes('data-sync-resolve="remote"'));
  assert.ok(html.includes('data-sync-later'));
  assert.ok(html.includes('data-sync-collection="documents"'));
  assert.ok(html.includes('data-sync-id="d1"'));
});

test('should_escape_conflict_content_when_rendered', () => {
  const interpolate = (key, params) => key === 'parsinegar.sync.conflict'
    ? `تعارض «${params?.title ?? ''}»`
    : key;
  const html = renderSyncConflictModal({
    t: interpolate,
    assetBaseUrl: null,
    conflict: {
      collection: 'documents',
      id: 'd1',
      title: '<b>',
      local: { updatedAt: 2, content: '<script>' },
      remote: null,
    },
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;b&gt;'));
});
