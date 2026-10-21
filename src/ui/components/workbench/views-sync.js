// Sync view: backend form (GitHub, or GitLab incl. self-hosted via base
// URL) plus status and actions.
//
// Pure render function owned by this view module; the registry only references
// it and holds no view logic. The snapshot arrives preformatted from the page
// (see home.js); this module never touches services or dates. While busy the
// actions disable and name the running operation; failed attempts keep their
// host, repo and branch (never the token) so the user does not retype
// everything.
//
// Long explanations ride `sync-tip` icons (hover/focus tooltip), not print
// rows under the fields: the form stays a form. «ذخیره الگوها» starts
// disabled and waits for a pattern that differs from the stored ones —
// the live toggle is the panel's job (side-panel.js, 'input'), the initial
// state is render's.
import { escapeHtml, iconMarkup } from './html.js';

/**
 * Normalizes a patterns text into the canonical newline list (mirrors the
 * save flow, so a saved round-trip always compares equal).
 * @param {string} text Raw textarea text.
 * @returns {string} Trimmed, non-empty, non-comment lines joined by newlines.
 */
function patternsText(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .join('\n');
}

/**
 * Builds the tip icon and its tooltip as SEPARATE fragments: the icon is
 * the trigger, the pop is a full-width-anchored sibling inside the labeled
 * field. The pop must anchor to the field (the panel-width box), never to
 * the icon — an icon-anchored pop overflows the panel edge and gets clipped
 * beside the rail ([part="side"] overflow hidden). The panel's :has() rules
 * (side-panel.css) open the pop on the icon's hover/focus.
 * @param {string|null} assetBaseUrl Resolved asset directory URL.
 * @param {string} label Accessible label for the icon (the help text).
 * @param {string} contentHtml Tooltip content (already escaped).
 * @returns {string} Icon markup followed by the pop markup.
 */
function tip(assetBaseUrl, label, contentHtml) {
  return {
    icon: `<span part="sync-tip" tabindex="0" aria-label="${escapeHtml(label)}">${iconMarkup(assetBaseUrl, 'help')}</span>`,
    pop: `<span part="sync-tip-pop" role="tooltip">${contentHtml}</span>`,
  };
}

/**
 * Renders the sync backend form when unconfigured, status plus actions when
 * configured. The token is never echoed back; the insecure-storage warning
 * and the single-repo advice ride the token field's tip icon. The host is a
 * radio pair inside the sync group; GitLab adds the optional base URL
 * (self-hosted). A clean green state disables «همگام‌سازی» — there is
 * nothing new to send or take.
 * @param {object} options Render options.
 * @param {Function} options.t Translation function.
 * @param {string|null} [options.assetBaseUrl] Asset directory URL for icons.
 * @param {object|null} [options.sync] `{ configured, kind, repo, branch, baseUrl, lastSyncText, errorText, busy, ignoreText, autoCommit, clean }`.
 * @returns {string} Sync view markup.
 */
export function renderSyncView({ t, assetBaseUrl = null, sync = null }) {
  const translate = typeof t === 'function' ? t : (key) => key;
  const snapshot = sync && typeof sync === 'object' ? sync : null;
  const busy = snapshot?.busy === true;
  const clean = snapshot?.clean === true;
  const error = snapshot?.errorText
    ? `<p part="settings-error">${escapeHtml(translate('parsinegar.sync.error'))}: ${escapeHtml(snapshot.errorText)}</p>`
    : '';
  const spinner = '<span part="sync-spinner" aria-hidden="true"></span>';
  const kind = snapshot?.kind === 'gitlab' ? 'gitlab' : 'git';
  const hostLabel = translate(kind === 'gitlab' ? 'parsinegar.sync.host.gitlab' : 'parsinegar.sync.host.git');
  // The textarea opens exactly on the stored patterns ("nothing new to
  // save"), so render always starts the button disabled; the live
  // enable/disable rides the panel's 'input' handler (side-panel.js).
  const ignoreSaved = typeof snapshot?.ignoreText === 'string' ? snapshot.ignoreText : '';
  const longText = (key) => escapeHtml(translate(key));
  const baseUrlTip = tip(assetBaseUrl, translate('parsinegar.sync.base-url-note'), longText('parsinegar.sync.base-url-note'));
  const tokenTip = tip(
    assetBaseUrl,
    `${translate('parsinegar.sync.warn')} ${translate('parsinegar.sync.token-note')} ${translate('parsinegar.sync.single-repo')}`,
    `<strong part="sync-tip-warn">${longText('parsinegar.sync.warn')}:</strong> ${longText('parsinegar.sync.token-note')} ${longText('parsinegar.sync.single-repo')}`,
  );
  const autoCommitTip = tip(assetBaseUrl, translate('parsinegar.sync.auto-commit-note'), longText('parsinegar.sync.auto-commit-note'));
  const ignoreTip = tip(assetBaseUrl, translate('parsinegar.sync.ignore-note'), longText('parsinegar.sync.ignore-note'));
  const status = snapshot?.configured === true
    ? `<p part="settings-note" data-sync-status="host">${escapeHtml(translate('parsinegar.sync.host'))}: ${escapeHtml(hostLabel)}</p>
      <p part="settings-note" data-sync-status="repo">${escapeHtml(translate('parsinegar.sync.backend'))}: ${escapeHtml(snapshot.repo ?? '')}</p>
      <p part="settings-note" data-sync-status="branch">${escapeHtml(translate('parsinegar.sync.branch'))}: ${escapeHtml(snapshot.branch ?? '')}</p>
      <p part="settings-note" data-sync-status="last">${escapeHtml(translate('parsinegar.sync.last-sync'))}: ${escapeHtml(snapshot.lastSyncText ?? translate('parsinegar.sync.never'))}</p>
      ${error}
      <span part="sync-check-row">
        <label part="settings-check">
          <input type="checkbox" data-sync-field="autoCommit" ${snapshot.autoCommit !== false ? 'checked' : ''}>
          <span>${escapeHtml(translate('parsinegar.sync.auto-commit'))}</span>
        </label>
        ${autoCommitTip.icon}
        ${autoCommitTip.pop}
      </span>
      <div part="settings-actions">
        <button type="button" part="settings-button" data-primary data-sync-now${busy || clean ? ' disabled' : ''}>${busy ? spinner : ''}${escapeHtml(translate('parsinegar.sync.now'))}</button>
        <button type="button" part="settings-button" data-sync-remove${busy ? ' disabled' : ''}>${escapeHtml(translate('parsinegar.sync.remove'))}</button>
      </div>
      ${busy ? `<p part="settings-note">${escapeHtml(translate('parsinegar.sync.syncing'))}</p>` : ''}`
    : `<p part="settings-note">${escapeHtml(translate('parsinegar.sync.unconfigured'))}</p>
      ${error}
      <div part="sync-host-group" data-sync-host-group>
        <span part="sync-host-label">${escapeHtml(translate('parsinegar.sync.host'))}</span>
        <label part="settings-check">
          <input type="radio" name="sync-kind" value="git" data-sync-field="git-kind" ${kind === 'git' ? 'checked' : ''}>
          <span>${escapeHtml(translate('parsinegar.sync.host.git'))}</span>
        </label>
        <label part="settings-check">
          <input type="radio" name="sync-kind" value="gitlab" data-sync-field="git-kind" ${kind === 'gitlab' ? 'checked' : ''}>
          <span>${escapeHtml(translate('parsinegar.sync.host.gitlab'))}</span>
        </label>
        <label part="settings-field" data-sync-base-url>
          <span>${escapeHtml(translate('parsinegar.sync.base-url'))}${baseUrlTip.icon}</span>
          ${baseUrlTip.pop}
          <input type="text" dir="ltr" data-sync-field="baseUrl" autocomplete="off" value="${escapeHtml(snapshot?.baseUrl ?? '')}">
        </label>
      </div>
      <label part="settings-field">
        <span>${escapeHtml(translate('parsinegar.sync.repo'))}</span>
        <input type="text" dir="ltr" data-sync-field="repo" required autocomplete="off" value="${escapeHtml(snapshot?.repo ?? '')}">
      </label>
      <label part="settings-field">
        <span>${escapeHtml(translate('parsinegar.sync.branch'))}</span>
        <input type="text" dir="ltr" data-sync-field="branch" value="${escapeHtml(snapshot?.branch ?? 'main')}" autocomplete="off">
      </label>
      <label part="settings-field">
        <span>${escapeHtml(translate('parsinegar.sync.token'))}${tokenTip.icon}</span>
        ${tokenTip.pop}
        <input type="password" dir="ltr" data-sync-field="token" required autocomplete="off">
      </label>
      <div part="settings-actions">
        <button type="button" part="settings-button" data-primary data-sync-save${busy ? ' disabled' : ''}>${busy ? spinner : ''}${escapeHtml(translate('parsinegar.sync.save'))}</button>
      </div>
      ${busy ? `<p part="settings-note">${escapeHtml(translate('parsinegar.sync.connecting'))}</p>` : ''}`;
  return `
    <div part="settings-view">
      <p part="settings-notice">${escapeHtml(translate('parsinegar.sync.experimental'))}</p>
      <fieldset part="settings-group">
        <legend part="settings-legend">${escapeHtml(translate('parsinegar.sync.title'))}</legend>
        ${status}
      </fieldset>
      <fieldset part="settings-group">
        <legend part="settings-legend">${escapeHtml(translate('parsinegar.sync.ignore-title'))}${ignoreTip.icon}${ignoreTip.pop}</legend>
        <label part="settings-field">
          <textarea dir="auto" rows="6" data-sync-field="ignore" autocomplete="off" spellcheck="false">${escapeHtml(ignoreSaved)}</textarea>
        </label>
        <div part="settings-actions">
          <button type="button" part="settings-button" data-primary data-sync-ignore-save disabled>${escapeHtml(translate('parsinegar.sync.ignore-save'))}</button>
        </div>
      </fieldset>
    </div>`;
}
