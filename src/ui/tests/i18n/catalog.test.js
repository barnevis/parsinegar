// Verifies the application translation catalog shape.
import assert from 'node:assert/strict';
import test from 'node:test';
import catalog from '../../i18n/catalog.js';

test('should_carry_persian_entries_when_loaded', () => {
  assert.ok(Intl.getCanonicalLocales('fa'));
  const entries = Object.entries(catalog.fa ?? {});
  assert.ok(entries.length > 0, 'expected catalog entries');
  for (const [key, value] of entries) {
    assert.equal(typeof key, 'string');
    assert.equal(key, key.trim());
    assert.equal(typeof value, 'string');
    assert.ok(value.trim().length > 0, `empty translation: ${key}`);
  }
});

test('should_cover_product_keys_when_loaded', () => {
  for (const key of [
    'parsinegar.app.title',
    'parsinegar.documents.new',
    'parsinegar.menu.file',
    'parsinegar.action.undo',
    'parsinegar.views.files',
    'parsinegar.stats.words',
  ]) {
    assert.ok(typeof catalog.fa[key] === 'string' && catalog.fa[key].length > 0, `missing key: ${key}`);
  }
});
