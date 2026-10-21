// Sync view: backend form (GitHub, or GitLab incl. self-hosted via base
// URL) plus status and actions.
//
// Pure render function owned by this view module; the registry only references
// it and holds no view logic. The snapshot arrives preformatted from the page
// (see home.js); this module never touches services or dates. While busy the
// actions disable and name the running operation; failed attempts keep their
// host, repo and branch (never the token) so the user does not retype
// everything.
import { escapeHtml } from './html.js';

/**
 * Renders the sync backend form when unconfigured, status plus actions when
 * configured. The token is never echoed back; the insecure-storage warning
 * and the single-repo advice always stay visible above the token field. The
 * host is a radio pair; GitLab adds the optional base URL (self-hosted).
 * @param {object} options Render options.
 * @param {Function} options.t Translation function.
 * @param {object|null} [options.sync] `{ configured, kind, repo, branch, baseUrl, lastSyncText, errorText, busy, ignoreText, autoCommit }`.
 * @returns {string} Sync view markup.
 */
export function renderSyncView({ t, sync = null }) {
  const translate = typeof t === 'function' ? t : (key) => key;
  const snapshot = sync && typeof sync === 'object' ? sync : null;
  const busy = snapshot?.busy === true;
  const error = snapshot?.errorText
    ? `<p part="settings-error">${escapeHtml(translate('parsinegar.sync.error'))}: ${escapeHtml(snapshot.errorText)}</p>`
    : '';
  const spinner = '<span part="sync-spinner" aria-hidden="true"></span>';
  const kind = snapshot?.kind === 'gitlab' ? 'gitlab' : 'git';
  const hostLabel = translate(kind === 'gitlab' ? 'parsinegar.sync.host.gitlab' : 'parsinegar.sync.host.git');
  const status = snapshot?.configured === true
    ? `<p part="settings-note">${escapeHtml(translate('parsinegar.sync.backend'))}: ${escapeHtml(hostLabel)} — ${escapeHtml(snapshot.repo ?? '')} / ${escapeHtml(snapshot.branch ?? '')}</p>
      <p part="settings-note">${escapeHtml(translate('parsinegar.sync.last-sync'))}: ${escapeHtml(snapshot.lastSyncText ?? translate('parsinegar.sync.never'))}</p>
      ${error}
      <label part="settings-check">
        <input type="checkbox" data-sync-field="autoCommit" ${snapshot.autoCommit !== false ? 'checked' : ''}>
        <span>${escapeHtml(translate('parsinegar.sync.auto-commit'))}</span>
      </label>
      <p part="settings-note">${escapeHtml(translate('parsinegar.sync.auto-commit-note'))}</p>
      <div part="settings-actions">
        <button type="button" part="settings-button" data-primary data-sync-now${busy ? ' disabled' : ''}>${busy ? spinner : ''}${escapeHtml(translate('parsinegar.sync.now'))}</button>
        <button type="button" part="settings-button" data-sync-remove${busy ? ' disabled' : ''}>${escapeHtml(translate('parsinegar.sync.remove'))}</button>
      </div>
      ${busy ? `<p part="settings-note">${escapeHtml(translate('parsinegar.sync.syncing'))}</p>` : ''}`
    : `<p part="settings-note">${escapeHtml(translate('parsinegar.sync.unconfigured'))}</p>
      ${error}
      <fieldset part="sync-host-group" data-sync-host-group>
        <legend part="settings-legend">${escapeHtml(translate('parsinegar.sync.host'))}</legend>
        <label part="settings-check">
          <input type="radio" name="sync-kind" value="git" data-sync-field="git-kind" ${kind === 'git' ? 'checked' : ''}>
          <span>${escapeHtml(translate('parsinegar.sync.host.git'))}</span>
        </label>
        <label part="settings-check">
          <input type="radio" name="sync-kind" value="gitlab" data-sync-field="git-kind" ${kind === 'gitlab' ? 'checked' : ''}>
          <span>${escapeHtml(translate('parsinegar.sync.host.gitlab'))}</span>
        </label>
        <label part="settings-field" data-sync-base-url>
          <span>${escapeHtml(translate('parsinegar.sync.base-url'))}</span>
          <input type="text" dir="ltr" data-sync-field="baseUrl" autocomplete="off" value="${escapeHtml(snapshot?.baseUrl ?? '')}">
        </label>
        <p part="settings-note">${escapeHtml(translate('parsinegar.sync.base-url-note'))}</p>
      </fieldset>
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
        <button type="button" part="settings-button" data-primary data-sync-save${busy ? ' disabled' : ''}>${busy ? spinner : ''}${escapeHtml(translate('parsinegar.sync.save'))}</button>
      </div>
      ${busy ? `<p part="settings-note">${escapeHtml(translate('parsinegar.sync.connecting'))}</p>` : ''}`;
  return `
    <div part="settings-view">
      <fieldset part="settings-group">
        <legend part="settings-legend">${escapeHtml(translate('parsinegar.sync.title'))}</legend>
        <p part="settings-notice">${escapeHtml(translate('parsinegar.sync.experimental'))}</p>
        ${status}
      </fieldset>
      <fieldset part="settings-group">
        <legend part="settings-legend">${escapeHtml(translate('parsinegar.sync.ignore-title'))}</legend>
        <p part="settings-note">${escapeHtml(translate('parsinegar.sync.ignore-note'))}</p>
        <label part="settings-field">
          <textarea dir="auto" rows="6" data-sync-field="ignore" autocomplete="off" spellcheck="false">${escapeHtml(snapshot?.ignoreText ?? '')}</textarea>
        </label>
        <div part="settings-actions">
          <button type="button" part="settings-button" data-primary data-sync-ignore-save>${escapeHtml(translate('parsinegar.sync.ignore-save'))}</button>
        </div>
      </fieldset>
    </div>`;
}
