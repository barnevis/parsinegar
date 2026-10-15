// Verifies the settings view renderer (pure function, no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderSettingsView } from '../../../components/workbench/views-settings.js';

const settings = { theme: 'dark', direction: 'rtl', fontSize: 18 };

test('should_check_current_values_when_rendered', () => {
  const markup = renderSettingsView({ t: (key) => key, settings, formatNumber: String });
  assert.ok(markup.includes('value="dark" checked'), 'expected checked theme');
  assert.ok(markup.includes('value="rtl" checked'), 'expected checked direction');
  assert.ok(!markup.includes('value="light" checked'), 'expected unchecked theme');
  assert.ok(markup.includes('<output part="settings-value">18</output>'));
});

test('should_translate_every_label_when_rendered', () => {
  const seen = [];
  renderSettingsView({ t: (key) => seen.push(key) && key, settings, formatNumber: String });
  for (const key of [
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
  ]) {
    assert.ok(seen.includes(key), `missing translation: ${key}`);
  }
});

test('should_format_font_size_when_formatter_is_given', () => {
  const markup = renderSettingsView({ t: (key) => key, settings, formatNumber: () => '۱۸' });
  assert.ok(markup.includes('<output part="settings-value">۱۸</output>'));
});

test('should_render_without_checked_option_when_values_are_unknown', () => {
  const markup = renderSettingsView({
    t: (key) => key,
    settings: { theme: 'neon', direction: 'up', fontSize: 'big' },
    formatNumber: String,
  });
  assert.ok(!markup.includes(' checked'), 'expected nothing checked');
});

test('should_use_stepper_buttons_for_font_size_when_rendered', () => {
  const markup = renderSettingsView({ t: (key) => key, settings, formatNumber: String });
  assert.ok(markup.includes('data-setting-key="fontSize" data-setting-step="-1"'));
  assert.ok(markup.includes('data-setting-key="fontSize" data-setting-step="1"'));
});

test('should_render_sync_form_when_unconfigured', () => {
  const markup = renderSettingsView({ t: (key) => key, settings, formatNumber: String, sync: null });
  assert.ok(markup.includes('data-sync-field="repo"'));
  assert.ok(markup.includes('data-sync-field="branch"'));
  assert.ok(markup.includes('data-sync-field="token"'));
  assert.ok(markup.includes('data-sync-save'));
  assert.ok(!markup.includes('data-sync-now'), 'expected no sync button without a backend');
  assert.ok(!markup.includes('data-sync-remove'), 'expected no remove button without a backend');
});

test('should_render_sync_status_when_configured', () => {
  const markup = renderSettingsView({
    t: (key) => key,
    settings,
    formatNumber: String,
    sync: { configured: true, repo: 'u/r', branch: 'main', lastSyncText: 'امروز', errorText: null },
  });
  assert.ok(markup.includes('data-sync-now'));
  assert.ok(markup.includes('data-sync-remove'));
  assert.ok(markup.includes('u/r'));
  assert.ok(!markup.includes('data-sync-field="token"'), 'expected no token field when configured');
});

test('should_render_sync_error_when_present', () => {
  const markup = renderSettingsView({
    t: (key) => key,
    settings,
    formatNumber: String,
    sync: { configured: true, repo: 'u/r', branch: 'main', lastSyncText: null, errorText: 'boom' },
  });
  assert.ok(markup.includes('boom'));
});

test('should_render_sync_error_when_unconfigured', () => {
  const markup = renderSettingsView({
    t: (key) => key,
    settings,
    formatNumber: String,
    sync: { configured: false, repo: 'u/r', branch: 'dev', lastSyncText: null, errorText: 'boom', busy: false },
  });
  assert.ok(markup.includes('boom'));
});

test('should_disable_actions_and_rename_labels_when_busy', () => {
  const busy = renderSettingsView({
    t: (key) => key,
    settings,
    formatNumber: String,
    sync: { configured: true, repo: 'u/r', branch: 'main', lastSyncText: null, errorText: null, busy: true },
  });
  assert.ok(busy.includes('data-sync-now disabled'));
  assert.ok(busy.includes('parsinegar.sync.syncing'));
  const connecting = renderSettingsView({
    t: (key) => key,
    settings,
    formatNumber: String,
    sync: { configured: false, repo: null, branch: null, lastSyncText: null, errorText: null, busy: true },
  });
  assert.ok(connecting.includes('data-sync-save disabled'));
  assert.ok(connecting.includes('parsinegar.sync.connecting'));
});

test('should_repopulate_attempt_without_token_when_unconfigured', () => {
  const markup = renderSettingsView({
    t: (key) => key,
    settings,
    formatNumber: String,
    sync: { configured: false, repo: 'u/r', branch: 'dev', lastSyncText: null, errorText: null, busy: false },
  });
  assert.ok(markup.includes('value="u/r"'));
  assert.ok(markup.includes('value="dev"'));
  assert.ok(!markup.includes('value="tok"'), 'token must never echo back');
});

test('should_offer_four_themes_when_rendered', () => {
  const markup = renderSettingsView({
    t: (key) => key,
    settings: { theme: 'sepia', direction: 'auto', fontSize: 16 },
    formatNumber: String,
  });
  const checked = markup.match(/value="(light|dark|device|sepia)" checked/g) ?? [];
  assert.deepEqual(checked, ['value="sepia" checked']);
  assert.equal((markup.match(/data-setting="theme"/g) ?? []).length, 4);
});
