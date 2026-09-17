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
