// Settings view: renders the preferences controls markup.
//
// Pure render function owned by this view module; the registry only references
// it and holds no view logic. Takes explicit data, never services or DOM.
// Controls report through `settings-change` (radio groups) and `settings-step`
// (font-size stepper) events handled by the side panel element; validation and
// persistence live in the settings service, never here.
import { escapeHtml } from './html.js';

const FALLBACK_FONT_SIZE = 16;

/**
 * Renders one radio option.
 * @param {Function} translate Translation function.
 * @param {string} group Radio group name.
 * @param {string} key Setting key for `data-setting`.
 * @param {string} value Option value.
 * @param {string} labelKey Translation key for the label.
 * @param {string} current Currently selected value.
 * @returns {string} Option markup.
 */
function renderOption(translate, group, key, value, labelKey, current) {
  return `
    <label part="settings-option">
      <input type="radio" name="${group}" data-setting="${key}" value="${value}"${current === value ? ' checked' : ''}>
      <span>${escapeHtml(translate(labelKey))}</span>
    </label>`;
}

/**
 * Renders the preferences controls for the current settings snapshot.
 * @param {object} options Render options.
 * @param {Function} options.t Translation function.
 * @param {object} options.settings Current `{ theme, direction, fontSize }`.
 * @param {Function} options.formatNumber Number formatter.
 * @returns {string} Settings view markup.
 */
export function renderSettingsView({ t, settings, formatNumber }) {
  const translate = typeof t === 'function' ? t : (key) => key;
  const snapshot = settings && typeof settings === 'object' ? settings : {};
  const format = typeof formatNumber === 'function' ? formatNumber : String;
  const fontSize = Number.isInteger(snapshot.fontSize) ? snapshot.fontSize : FALLBACK_FONT_SIZE;
  return `
    <div part="settings-view">
      <fieldset part="settings-group">
        <legend part="settings-legend">${escapeHtml(translate('parsinegar.settings.theme'))}</legend>
        ${renderOption(translate, 'parsi-settings-theme', 'theme', 'light', 'parsinegar.settings.theme-light', snapshot.theme)}
        ${renderOption(translate, 'parsi-settings-theme', 'theme', 'dark', 'parsinegar.settings.theme-dark', snapshot.theme)}
        ${renderOption(translate, 'parsi-settings-theme', 'theme', 'device', 'parsinegar.settings.theme-device', snapshot.theme)}
      </fieldset>
      <fieldset part="settings-group">
        <legend part="settings-legend">${escapeHtml(translate('parsinegar.settings.direction'))}</legend>
        ${renderOption(translate, 'parsi-settings-direction', 'direction', 'auto', 'parsinegar.settings.direction-auto', snapshot.direction)}
        ${renderOption(translate, 'parsi-settings-direction', 'direction', 'rtl', 'parsinegar.settings.direction-rtl', snapshot.direction)}
        ${renderOption(translate, 'parsi-settings-direction', 'direction', 'ltr', 'parsinegar.settings.direction-ltr', snapshot.direction)}
      </fieldset>
      <fieldset part="settings-group">
        <legend part="settings-legend">${escapeHtml(translate('parsinegar.settings.font-size'))}</legend>
        <div part="settings-stepper">
          <button type="button" part="settings-less" data-setting-key="fontSize" data-setting-step="-1" aria-label="${escapeHtml(translate('parsinegar.settings.decrease'))}">−</button>
          <output part="settings-value">${escapeHtml(format(fontSize))}</output>
          <button type="button" part="settings-more" data-setting-key="fontSize" data-setting-step="1" aria-label="${escapeHtml(translate('parsinegar.settings.increase'))}">+</button>
        </div>
      </fieldset>
    </div>`;
}
