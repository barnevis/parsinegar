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
 * Renders the sync section: backend form when unconfigured, status plus
 * actions when configured. The snapshot arrives preformatted; this module
 * never touches services or dates. While busy the actions disable and the
 * buttons name the running operation; failed attempts keep their repo and
 * branch (never the token) so the user does not retype everything.
 * @param {Function} translate Translation function.
 * @param {object|null} sync `{ configured, repo, branch, lastSyncText, errorText, busy }`.
 * @returns {string} Section markup.
 */
function renderSyncSection(translate, sync) {
  const snapshot = sync && typeof sync === 'object' ? sync : null;
  const busy = snapshot?.busy === true;
  const status = snapshot?.configured === true
    ? `<p part="settings-note">${escapeHtml(translate('parsinegar.sync.backend'))}: ${escapeHtml(snapshot.repo ?? '')} / ${escapeHtml(snapshot.branch ?? '')}</p>
      <p part="settings-note">${escapeHtml(translate('parsinegar.sync.last-sync'))}: ${escapeHtml(snapshot.lastSyncText ?? translate('parsinegar.sync.never'))}</p>
      ${snapshot.errorText ? `<p part="settings-error">${escapeHtml(translate('parsinegar.sync.error'))}: ${escapeHtml(snapshot.errorText)}</p>` : ''}
      <div part="settings-actions">
        <button type="button" part="settings-button" data-sync-now${busy ? ' disabled' : ''}>${escapeHtml(translate(busy ? 'parsinegar.sync.syncing' : 'parsinegar.sync.now'))}</button>
        <button type="button" part="settings-button" data-sync-remove${busy ? ' disabled' : ''}>${escapeHtml(translate('parsinegar.sync.remove'))}</button>
      </div>`
    : `<p part="settings-note">${escapeHtml(translate('parsinegar.sync.unconfigured'))}</p>
      ${snapshot?.errorText ? `<p part="settings-error">${escapeHtml(translate('parsinegar.sync.error'))}: ${escapeHtml(snapshot.errorText)}</p>` : ''}
      <label part="settings-field">
        <span>${escapeHtml(translate('parsinegar.sync.repo'))}</span>
        <input type="text" dir="ltr" data-sync-field="repo" required autocomplete="off" value="${escapeHtml(snapshot?.repo ?? '')}">
      </label>
      <label part="settings-field">
        <span>${escapeHtml(translate('parsinegar.sync.branch'))}</span>
        <input type="text" dir="ltr" data-sync-field="branch" value="${escapeHtml(snapshot?.branch ?? 'main')}" autocomplete="off">
      </label>
      <label part="settings-field">
        <span>${escapeHtml(translate('parsinegar.sync.token'))}</span>
        <input type="password" dir="ltr" data-sync-field="token" required autocomplete="off">
      </label>
      <p part="settings-note">${escapeHtml(translate('parsinegar.sync.token-note'))}</p>
      <div part="settings-actions">
        <button type="button" part="settings-button" data-sync-save${busy ? ' disabled' : ''}>${escapeHtml(translate(busy ? 'parsinegar.sync.connecting' : 'parsinegar.sync.save'))}</button>
      </div>`;
  return `
    <fieldset part="settings-group">
      <legend part="settings-legend">${escapeHtml(translate('parsinegar.sync.title'))}</legend>
      ${status}
    </fieldset>`;
}

/**
 * Renders the preferences controls for the current settings snapshot.
 * @param {object} options Render options.
 * @param {Function} options.t Translation function.
 * @param {object} options.settings Current `{ theme, direction, fontSize }`.
 * @param {Function} options.formatNumber Number formatter.
 * @param {object|null} [options.sync] Sync snapshot (see renderSyncSection).
 * @returns {string} Settings view markup.
 */
export function renderSettingsView({ t, settings, formatNumber, sync = null }) {
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
        ${renderOption(translate, 'parsi-settings-theme', 'theme', 'sepia', 'parsinegar.settings.theme-sepia', snapshot.theme)}
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
      ${renderSyncSection(translate, sync)}
    </div>`;
}
