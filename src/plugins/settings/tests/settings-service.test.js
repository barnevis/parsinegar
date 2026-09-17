// Verifies the settings service (fake storage, fake events).
import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS, createService } from '../lib/settings-service.js';

function createStorage(initial = []) {
  const records = new Map(initial.map((record) => [record.id, { ...record }]));
  return {
    records,
    async query() {
      return [...records.values()];
    },
    async read(collection, key) {
      return records.get(key) ?? null;
    },
    async write(collection, record) {
      records.set(record.id, { ...record });
    },
    async delete(collection, key) {
      records.delete(key);
    },
  };
}

function createState(initial = [], published = []) {
  return {
    storage: createStorage(initial),
    events: {
      publish: (type, data) => {
        published.push({ type, data });
        return { success: true };
      },
    },
  };
}

test('should_return_defaults_when_no_record_exists', async () => {
  const service = createService(createState());
  assert.deepEqual(await service.getSettings(), DEFAULT_SETTINGS);
});

test('should_merge_stored_values_over_defaults_when_reading', async () => {
  const service = createService(createState([{ id: 'preferences', theme: 'dark' }]));
  assert.deepEqual(await service.getSettings(), { ...DEFAULT_SETTINGS, theme: 'dark' });
});

test('should_replace_invalid_stored_values_with_defaults_when_reading', async () => {
  const service = createService(createState([
    { id: 'preferences', theme: 'neon', direction: 'up', fontSize: 99 },
  ]));
  assert.deepEqual(await service.getSettings(), DEFAULT_SETTINGS);
});

test('should_save_valid_patch_and_publish_change_when_saving', async () => {
  const published = [];
  const state = createState([], published);
  const service = createService(state);
  const saved = await service.saveSettings({ theme: 'light', fontSize: 20 });
  assert.deepEqual(saved, { ...DEFAULT_SETTINGS, theme: 'light', fontSize: 20 });
  assert.deepEqual(state.storage.records.get('preferences'), { id: 'preferences', ...saved });
  assert.deepEqual(published, [{ type: 'settings:changed', data: { id: 'preferences' } }]);
});

test('should_keep_current_values_for_absent_fields_when_saving', async () => {
  const service = createService(createState([{ id: 'preferences', theme: 'dark', direction: 'rtl', fontSize: 18 }]));
  assert.deepEqual(await service.saveSettings({ theme: 'light' }), { theme: 'light', direction: 'rtl', fontSize: 18 });
});

test('should_reject_invalid_theme_when_saving', async () => {
  const published = [];
  const service = createService(createState([], published));
  const error = await service.saveSettings({ theme: 'neon' }).catch((caught) => caught);
  assert.equal(error?.code, 'SETTINGS_INVALID_VALUE');
  assert.deepEqual(error?.detail, { field: 'theme' });
  assert.deepEqual(published, []);
});

test('should_reject_invalid_direction_when_saving', async () => {
  const service = createService(createState());
  const error = await service.saveSettings({ direction: 'diagonal' }).catch((caught) => caught);
  assert.equal(error?.code, 'SETTINGS_INVALID_VALUE');
  assert.deepEqual(error?.detail, { field: 'direction' });
});

test('should_reject_out_of_range_font_size_when_saving', async () => {
  const service = createService(createState());
  for (const fontSize of [11, 25, 16.5, 'big']) {
    const error = await service.saveSettings({ fontSize }).catch((caught) => caught);
    assert.equal(error?.code, 'SETTINGS_INVALID_VALUE', `expected rejection for ${String(fontSize)}`);
  }
});

test('should_fail_with_structured_error_when_storage_is_missing', async () => {
  const service = createService({ storage: null, events: null });
  const error = await service.getSettings().catch((caught) => caught);
  assert.equal(error?.code, 'SETTINGS_STORAGE_UNAVAILABLE');
  assert.equal(typeof error?.timestamp, 'string');
});
