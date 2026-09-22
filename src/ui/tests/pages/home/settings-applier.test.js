// Verifies the settings applier (pure logic over a fake service, no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSettingsApplier } from '../../../pages/home/settings-applier.js';

function createService(initial = { theme: 'device', direction: 'auto', fontSize: 16 }) {
  let stored = { ...initial };
  const service = {
    calls: [],
    async getSettings() {
      return { ...stored };
    },
    async saveSettings(patch) {
      service.calls.push(patch);
      stored = { ...stored, ...patch };
      return { ...stored };
    },
  };
  return service;
}

test('should_fall_back_when_api_is_missing', async () => {
  const applier = createSettingsApplier({});
  assert.deepEqual(applier.getState(), { settings: null, direction: 'rtl', fontSize: 16 });
  assert.equal(await applier.load(), false);
  assert.equal(await applier.applyChange('theme', 'dark'), 'ignored');
  assert.equal(await applier.applyStep('fontSize', 1), 'ignored');
});

test('should_load_snapshot_when_service_resolves', async () => {
  const applier = createSettingsApplier({ settingsApi: createService() });
  assert.equal(await applier.load(), true);
  assert.deepEqual(applier.getState(), {
    settings: { theme: 'device', direction: 'auto', fontSize: 16 },
    direction: 'auto',
    fontSize: 16,
  });
});

test('should_keep_fallbacks_when_load_fails', async () => {
  const failing = { async getSettings() { throw new Error('down'); }, async saveSettings() { throw new Error('down'); } };
  const applier = createSettingsApplier({ settingsApi: failing });
  assert.equal(await applier.load(), false);
  assert.deepEqual(applier.getState(), { settings: null, direction: 'rtl', fontSize: 16 });
});

test('should_apply_change_when_valid', async () => {
  const service = createService();
  const applier = createSettingsApplier({ settingsApi: service });
  await applier.load();
  assert.equal(await applier.applyChange('direction', 'ltr'), 'applied');
  assert.equal(applier.getState().direction, 'ltr');
  assert.equal(await applier.applyChange('theme', 'dark'), 'applied');
  assert.equal(applier.getState().settings.theme, 'dark');
});

test('should_ignore_invalid_change_when_validating', async () => {
  const service = createService();
  const applier = createSettingsApplier({ settingsApi: service });
  await applier.load();
  assert.equal(await applier.applyChange('unknown', 'x'), 'ignored');
  assert.equal(await applier.applyChange('theme', ''), 'ignored');
  assert.equal(await applier.applyChange('theme', 42), 'ignored');
  assert.deepEqual(service.calls, []);
});

test('should_report_failure_when_save_rejects', async () => {
  const service = createService();
  service.saveSettings = async () => { throw new Error('down'); };
  const applier = createSettingsApplier({ settingsApi: service });
  await applier.load();
  assert.equal(await applier.applyChange('theme', 'dark'), 'failed');
  assert.equal(applier.getState().settings.theme, 'device');
});

test('should_step_font_size_when_delta_is_valid', async () => {
  const service = createService();
  const applier = createSettingsApplier({ settingsApi: service });
  await applier.load();
  assert.equal(await applier.applyStep('fontSize', 1), 'applied');
  assert.equal(applier.getState().fontSize, 17);
  assert.equal(await applier.applyStep('fontSize', -1), 'applied');
  assert.equal(applier.getState().fontSize, 16);
});

test('should_ignore_invalid_step_when_validating', async () => {
  const service = createService();
  const applier = createSettingsApplier({ settingsApi: service });
  await applier.load();
  assert.equal(await applier.applyStep('fontSize', 2), 'ignored');
  assert.equal(await applier.applyStep('other', 1), 'ignored');
  assert.equal(await applier.applyStep('fontSize', 'x'), 'ignored');
  assert.deepEqual(service.calls, []);
});

test('should_serialize_rapid_writes_when_chained', async () => {
  const order = [];
  const service = createService();
  const gated = service.saveSettings;
  service.saveSettings = async (patch) => {
    order.push(`start:${JSON.stringify(patch)}`);
    await gated(patch);
    order.push(`end:${JSON.stringify(patch)}`);
    return { theme: 'device', direction: 'auto', fontSize: 16 };
  };
  const applier = createSettingsApplier({ settingsApi: service });
  await applier.load();
  const [first, second] = await Promise.all([
    applier.applyChange('theme', 'dark'),
    applier.applyChange('direction', 'ltr'),
  ]);
  assert.equal(first, 'applied');
  assert.equal(second, 'applied');
  assert.deepEqual(order, [
    'start:{"theme":"dark"}',
    'end:{"theme":"dark"}',
    'start:{"direction":"ltr"}',
    'end:{"direction":"ltr"}',
  ]);
});

test('should_keep_state_when_reconnected', async () => {
  const applier = createSettingsApplier({ settingsApi: createService() });
  await applier.load();
  await applier.applyChange('direction', 'ltr');
  applier.reconnect({ settingsApi: createService({ theme: 'dark', direction: 'rtl', fontSize: 20 }) });
  assert.equal(applier.getState().direction, 'ltr');
  assert.equal(await applier.applyStep('fontSize', 1), 'applied');
});

test('should_ignore_scheme_watch_when_media_is_missing', async () => {
  const previous = globalThis.matchMedia;
  delete globalThis.matchMedia;
  try {
    const applier = createSettingsApplier({ settingsApi: createService() });
    await applier.load();
    let flips = 0;
    applier.watchColorScheme(() => { flips += 1; });
    applier.unwatchColorScheme();
    assert.equal(flips, 0);
  } finally {
    globalThis.matchMedia = previous;
  }
});

test('should_flip_only_while_theme_is_device', async () => {
  const previous = globalThis.matchMedia;
  let handler = null;
  globalThis.matchMedia = () => ({
    matches: false,
    addEventListener: (_type, listener) => { handler = listener; },
    removeEventListener: () => { handler = null; },
  });
  try {
    const applier = createSettingsApplier({ settingsApi: createService() });
    await applier.load();
    let flips = 0;
    applier.watchColorScheme(() => { flips += 1; });
    assert.ok(handler, 'expected a change listener');
    handler();
    assert.equal(flips, 1);
    await applier.applyChange('theme', 'dark');
    handler();
    assert.equal(flips, 1);
    applier.unwatchColorScheme();
    assert.equal(handler, null);
  } finally {
    globalThis.matchMedia = previous;
  }
});
