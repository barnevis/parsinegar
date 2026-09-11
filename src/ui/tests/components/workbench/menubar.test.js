// Verifies the menu bar model (pure data, no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMenuModel } from '../../../components/workbench/menubar.js';

const LABELS = {
  'parsinegar.menu.file': 'پرونده',
  'parsinegar.menu.edit': 'ویرایش',
  'parsinegar.menu.view': 'نمایش',
  'parsinegar.documents.new': 'سند تازه',
  'parsinegar.documents.delete': 'حذف سند',
  'parsinegar.action.undo': 'واگرد',
  'parsinegar.action.redo': 'ازنو',
  'parsinegar.view.side': 'پنل کناری',
  'parsinegar.view.status': 'نوار وضعیت',
};

function translate(key) {
  return LABELS[key] ?? key;
}

test('should_build_three_menus_when_called', () => {
  const menus = buildMenuModel({ t: translate, hasDocument: true });
  assert.deepEqual(menus.map(({ id }) => id), ['file', 'edit', 'view']);
  assert.deepEqual(menus.map(({ label }) => label), ['پرونده', 'ویرایش', 'نمایش']);
  for (const menu of menus) {
    assert.ok(menu.items.length > 0, `expected items in ${menu.id}`);
    for (const item of menu.items) {
      assert.equal(typeof item.action, 'string');
      assert.equal(typeof item.disabled, 'boolean');
    }
  }
});

test('should_disable_delete_when_no_document_is_open', () => {
  const menus = buildMenuModel({ t: translate, hasDocument: false });
  const file = menus.find(({ id }) => id === 'file');
  assert.equal(file.items.find(({ id }) => id === 'delete-document').disabled, true);
  assert.equal(file.items.find(({ id }) => id === 'new-document').disabled, false);
});

test('should_enable_delete_when_document_is_open', () => {
  const menus = buildMenuModel({ t: translate, hasDocument: true });
  const file = menus.find(({ id }) => id === 'file');
  assert.equal(file.items.find(({ id }) => id === 'delete-document').disabled, false);
});
