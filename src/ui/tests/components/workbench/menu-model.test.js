// Verifies the menu bar model (pure data, no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMenuModel } from '../../../components/workbench/menu-model.js';

const LABELS = {
  'parsinegar.menu.file': 'پرونده',
  'parsinegar.menu.edit': 'ویرایش',
  'parsinegar.menu.view': 'نمایش',
  'parsinegar.menu.insert': 'افزودن',
  'parsinegar.documents.new': 'سند تازه',
  'parsinegar.documents.delete': 'حذف سند',
  'parsinegar.menu.about': 'درباره پارسی‌نگار',
  'parsinegar.action.undo': 'واگرد',
  'parsinegar.action.redo': 'ازنو',
  'parsinegar.view.side': 'پنل کناری',
  'parsinegar.view.status': 'نوار وضعیت',
  'parsinegar.insert.heading': 'عنوان',
  'parsinegar.insert.bold': 'پررنگ',
  'parsinegar.insert.italic': 'مورب',
  'parsinegar.insert.strikethrough': 'خط‌خورده',
  'parsinegar.insert.quote': 'نقل‌قول',
  'parsinegar.insert.link': 'پیوند',
  'parsinegar.insert.code': 'کد',
  'parsinegar.insert.unordered-list': 'فهرست نامرتب',
  'parsinegar.insert.ordered-list': 'فهرست مرتب',
};

function translate(key) {
  return LABELS[key] ?? key;
}

test('should_build_five_menus_when_called', () => {
  const menus = buildMenuModel({ t: translate, hasDocument: true });
  assert.deepEqual(menus.map(({ id }) => id), ['file', 'edit', 'insert', 'view', 'help']);
  assert.deepEqual(menus.map(({ label }) => label), ['پرونده', 'ویرایش', 'افزودن', 'نمایش', 'parsinegar.menu.help']);
  for (const menu of menus) {
    assert.ok(menu.items.length > 0, `expected items in ${menu.id}`);
    for (const item of menu.items) {
      assert.equal(typeof item.action, 'string');
      assert.equal(typeof item.disabled, 'boolean');
    }
  }
});

test('should_offer_every_mark_when_insert_menu_is_read', () => {
  const menus = buildMenuModel({ t: translate, hasDocument: true });
  const insert = menus.find(({ id }) => id === 'insert');
  assert.deepEqual(insert.items.map(({ action }) => action), [
    'insert-heading',
    'insert-bold',
    'insert-italic',
    'insert-strikethrough',
    'insert-quote',
    'insert-link',
    'insert-code',
    'insert-unordered-list',
    'insert-ordered-list',
  ]);
  assert.deepEqual(insert.items.map(({ shortcut }) => shortcut), [
    'Ctrl+H',
    'Ctrl+B',
    'Ctrl+I',
    'Ctrl+Shift+S',
    'Ctrl+Q',
    'Ctrl+K',
    'Ctrl+E',
    'Ctrl+Shift+U',
    'Ctrl+Shift+L',
  ]);
});

test('should_disable_delete_when_no_document_is_open', () => {
  const menus = buildMenuModel({ t: translate, hasDocument: false });
  const file = menus.find(({ id }) => id === 'file');
  assert.equal(file.items.find(({ id }) => id === 'delete-document').disabled, true);
  assert.equal(file.items.find(({ id }) => id === 'new-document').disabled, false);
  assert.equal(file.items.find(({ id }) => id === 'import-document').disabled, false);
  const help = menus.find(({ id }) => id === 'help');
  assert.equal(help.items.find(({ id }) => id === 'about').disabled, false);
});

test('should_enable_delete_when_document_is_open', () => {
  const menus = buildMenuModel({ t: translate, hasDocument: true });
  const file = menus.find(({ id }) => id === 'file');
  assert.equal(file.items.find(({ id }) => id === 'delete-document').disabled, false);
});

test('should_offer_builtin_docs_in_help_menu_when_read', () => {
  const menus = buildMenuModel({ t: translate, hasDocument: true });
  assert.deepEqual(menus.map(({ id }) => id), ['file', 'edit', 'insert', 'view', 'help']);
  const help = menus.find(({ id }) => id === 'help');
  for (const id of ['open-help', 'open-changelog', 'about']) {
    const item = help.items.find((entry) => entry.id === id);
    assert.ok(item, `expected item: ${id}`);
    assert.equal(item.disabled, false);
  }
  assert.equal(help.items.find(({ id }) => id === 'back-to-documents'), undefined);
  const file = menus.find(({ id }) => id === 'file');
  assert.equal(file.items.find(({ id }) => id === 'open-help'), undefined);
  assert.equal(file.items.find(({ id }) => id === 'about'), undefined);
});

test('should_switch_lock_label_when_read_only_changes', () => {
  const open = buildMenuModel({ t: translate, hasDocument: true });
  const locked = buildMenuModel({ t: translate, hasDocument: true, readOnly: true });
  assert.equal(open.find(({ id }) => id === 'file').items.find(({ id }) => id === 'toggle-lock').label, 'parsinegar.documents.lock');
  assert.equal(locked.find(({ id }) => id === 'file').items.find(({ id }) => id === 'toggle-lock').label, 'parsinegar.documents.unlock');
  assert.equal(locked.find(({ id }) => id === 'file').items.find(({ id }) => id === 'toggle-lock').disabled, false);
});

test('should_disable_lock_without_document_or_for_builtin', () => {
  const none = buildMenuModel({ t: translate, hasDocument: false });
  assert.equal(none.find(({ id }) => id === 'file').items.find(({ id }) => id === 'toggle-lock').disabled, true);
  const builtIn = buildMenuModel({ t: translate, hasDocument: true, readOnly: true, builtInOpen: true });
  const file = builtIn.find(({ id }) => id === 'file');
  assert.equal(file.items.find(({ id }) => id === 'toggle-lock').disabled, true);
  const help = builtIn.find(({ id }) => id === 'help');
  const back = help.items.find(({ id }) => id === 'back-to-documents');
  assert.ok(back, 'expected the back item while a built-in is open');
  assert.equal(back.disabled, false);
});

test('should_toggle_mode_items_when_read_only_changes', () => {
  // The active mode stays unclickable; the other one switches.
  const open = buildMenuModel({ t: translate, hasDocument: true });
  const view = open.find(({ id }) => id === 'view');
  assert.equal(view.items.find(({ id }) => id === 'read-mode').disabled, false);
  assert.equal(view.items.find(({ id }) => id === 'write-mode').disabled, true);
  const locked = buildMenuModel({ t: translate, hasDocument: true, readOnly: true });
  const lockedView = locked.find(({ id }) => id === 'view');
  assert.equal(lockedView.items.find(({ id }) => id === 'read-mode').disabled, true);
  assert.equal(lockedView.items.find(({ id }) => id === 'write-mode').disabled, false);
  const none = buildMenuModel({ t: translate, hasDocument: false });
  const bareView = none.find(({ id }) => id === 'view');
  assert.equal(bareView.items.find(({ id }) => id === 'read-mode').disabled, true);
  assert.equal(bareView.items.find(({ id }) => id === 'write-mode').disabled, true);
});
