// Verifies the delete-confirmation modal rendering (pure, no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderConfirmModal, renderPropertiesModal } from '../../../components/workbench/modal.js';

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
