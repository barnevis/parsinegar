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
    'parsinegar.documents.delete-confirm',
    'parsinegar.documents.delete-yes',
    'parsinegar.documents.delete-no',
    'parsinegar.menu.file',
    'parsinegar.menu.about',
    'parsinegar.about.title',
    'parsinegar.about.lead',
    'parsinegar.about.version',
    'parsinegar.about.action',
    'parsinegar.menu.insert',
    'parsinegar.insert.bold',
    'parsinegar.insert.ordered-list',
    'parsinegar.action.undo',
    'parsinegar.views.files',
    'parsinegar.views.outline-expand',
    'parsinegar.views.outline-collapse',
    'parsinegar.views.settings',
    'parsinegar.settings.theme',
    'parsinegar.settings.theme-light',
    'parsinegar.settings.theme-dark',
    'parsinegar.settings.theme-device',
    'parsinegar.settings.theme-sepia',
    'parsinegar.settings.direction',
    'parsinegar.settings.direction-auto',
    'parsinegar.settings.direction-rtl',
    'parsinegar.settings.direction-ltr',
    'parsinegar.settings.font-size',
    'parsinegar.settings.decrease',
    'parsinegar.settings.increase',
    'parsinegar.stats.words',
    'parsinegar.stats.letters',
    'parsinegar.stats.size',
    'parsinegar.stats.bytes',
    'parsinegar.stats.kilobytes',
    'parsinegar.documents.menu',
    'parsinegar.documents.rename',
    'parsinegar.documents.duplicate',
    'parsinegar.documents.download',
    'parsinegar.documents.properties',
    'parsinegar.documents.property-name',
    'parsinegar.documents.property-created',
    'parsinegar.documents.property-updated',
    'parsinegar.documents.property-size',
    'parsinegar.documents.close',
    'parsinegar.code.copy',
    'parsinegar.code.copied',
    'parsinegar.documents.import',
    'parsinegar.documents.sort',
    'parsinegar.documents.sort-group-name',
    'parsinegar.documents.sort-group-updated',
    'parsinegar.documents.sort-group-created',
    'parsinegar.documents.sort-name-asc',
    'parsinegar.documents.sort-name-desc',
    'parsinegar.documents.sort-newest',
    'parsinegar.documents.sort-oldest',
  ]) {
    assert.ok(typeof catalog.fa[key] === 'string' && catalog.fa[key].length > 0, `missing key: ${key}`);
  }
});
