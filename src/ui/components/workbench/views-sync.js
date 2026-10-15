// Sync view: backend form plus status and actions for the git backend.
//
// Pure render function owned by this view module; the registry only references
// it and holds no view logic. The snapshot arrives preformatted from the page
// (see home.js); this module never touches services or dates. While busy the
// actions disable and name the running operation; failed attempts keep their
// repo and branch (never the token) so the user does not retype everything.
import { escapeHtml } from './html.js';

/**
 * Renders the sync backend form when unconfigured, status plus actions when
 * configured. The token is never echoed back; the insecure-storage warning
 * and the single-repo advice always stay visible above the token field.
 * @param {object} options Render options.
 * @param {Function} options.t Translation function.
 * @param {object|null} [options.sync] `{ configured, repo, branch, lastSyncText, errorText, busy }`.
 * @returns {string} Sync view markup.
 */
export function renderSyncView({ t, sync = null }) {
  const translate = typeof t === 'function' ? t : (key) => key;
  const snapshot = sync && typeof sync === 'object' ? sync : null;
  const busy = snapshot?.busy === true;
  const error = snapshot?.errorText
    ? `<p part="settings-error">${escapeHtml(translate('parsinegar.sync.error'))}: ${escapeHtml(snapshot.errorText)}</p>`
    : '';
  const status = snapshot?.configured === true
    ? `<p part="settings-note">${escapeHtml(translate('parsinegar.sync.backend'))}: ${escapeHtml(snapshot.repo ?? '')} / ${escapeHtml(snapshot.branch ?? '')}</p>
      <p part="settings-note">${escapeHtml(translate('parsinegar.sync.last-sync'))}: ${escapeHtml(snapshot.lastSyncText ?? translate('parsinegar.sync.never'))}</p>
      ${error}
      <div part="settings-actions">
        <button type="button" part="settings-button" data-sync-now${busy ? ' disabled' : ''}>${escapeHtml(translate(busy ? 'parsinegar.sync.syncing' : 'parsinegar.sync.now'))}</button>
        <button type="button" part="settings-button" data-sync-remove${busy ? ' disabled' : ''}>${escapeHtml(translate('parsinegar.sync.remove'))}</button>
      </div>`
    : `<p part="settings-note">${escapeHtml(translate('parsinegar.sync.unconfigured'))}</p>
      ${error}
      <label part="settings-field">
        <span>${escapeHtml(translate('parsinegar.sync.repo'))}</span>
        <input type="text" dir="ltr" data-sync-field="repo" required autocomplete="off" value="${escapeHtml(snapshot?.repo ?? '')}">
      </label>
      <label part="settings-field">
        <span>${escapeHtml(translate('parsinegar.sync.branch'))}</span>
        <input type="text" dir="ltr" data-sync-field="branch" value="${escapeHtml(snapshot?.branch ?? 'main')}" autocomplete="off">
      </label>
      <p part="settings-note">${escapeHtml(translate('parsinegar.sync.token-note'))}</p>
      <p part="settings-note">${escapeHtml(translate('parsinegar.sync.single-repo'))}</p>
      <label part="settings-field">
        <span>${escapeHtml(translate('parsinegar.sync.token'))}</span>
        <input type="password" dir="ltr" data-sync-field="token" required autocomplete="off">
      </label>
      <div part="settings-actions">
        <button type="button" part="settings-button" data-sync-save${busy ? ' disabled' : ''}>${escapeHtml(translate(busy ? 'parsinegar.sync.connecting' : 'parsinegar.sync.save'))}</button>
      </div>`;
  return `
    <div part="settings-view">
      <fieldset part="settings-group">
        <legend part="settings-legend">${escapeHtml(translate('parsinegar.sync.title'))}</legend>
        ${status}
      </fieldset>
    </div>`;
}
