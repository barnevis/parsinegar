// Workbench region renderers: pure markup for rail, side, menubar, status.
//
// Each function takes explicit data and returns HTML strings; the owning page
// supplies state and wires behavior elsewhere. No services, no DOM access.
import { createIconMarkup } from 'pey.webui/base/icon-sprite';
import { escapeHtml } from './html.js';
import { buildMenuModel } from './menubar.js';
import { FILES_VIEW, getView, listViews } from './views.js';

/**
 * Builds an icon markup string, degrading to empty when no base is available.
 * @param {string|null} assetBaseUrl Resolved asset directory URL.
 * @param {string} symbol Icon symbol id.
 * @returns {string} Icon markup or ''.
 */
function railIcon(assetBaseUrl, symbol) {
  if (typeof assetBaseUrl !== 'string' || assetBaseUrl.length === 0) {
    return '';
  }
  try {
    return createIconMarkup(assetBaseUrl, symbol);
  } catch {
    return '';
  }
}

/**
 * Renders the activity rail from the view registry.
 * @param {object} options Render options.
 * @param {Function} options.t Translation function.
 * @param {string|null} options.assetBaseUrl Resolved asset directory URL.
 * @param {string} options.activeView Active view id.
 * @returns {string} Rail markup.
 */
export function renderRail({ t, assetBaseUrl, activeView }) {
  const translate = typeof t === 'function' ? t : (key) => key;
  const buttons = listViews().map((view) => `
    <button type="button" part="rail-button" data-view="${view.id}" aria-pressed="${view.id === activeView}" aria-label="${escapeHtml(translate(view.labelKey))}" title="${escapeHtml(translate(view.labelKey))}">${railIcon(assetBaseUrl, view.icon)}<span part="rail-fallback">${escapeHtml(translate(view.labelKey))}</span></button>`).join('');
  return `<nav part="rail" aria-label="${escapeHtml(translate('parsinegar.app.title'))}">${buttons}</nav>`;
}

/**
 * Renders the side panel with the active view content.
 * @param {object} options Render options.
 * @param {Function} options.t Translation function.
 * @param {string} options.activeView Active view id.
 * @param {boolean} options.sideOpen Whether the panel is visible.
 * @param {Array<object>} options.items Documents for the files view.
 * @param {string|null} options.currentId Open document id.
 * @param {string} options.documentText Current document text for text views.
 * @returns {string} Side panel markup or ''.
 */
export function renderSide({ t, activeView, sideOpen, items, currentId, documentText }) {
  if (!sideOpen) {
    return '';
  }
  const translate = typeof t === 'function' ? t : (key) => key;
  const view = getView(activeView) ?? getView(FILES_VIEW);
  return `
    <aside part="side">
      <div part="side-header">
        <h2 part="side-title">${escapeHtml(translate(view.labelKey))}</h2>
        <button type="button" part="side-close" aria-label="${escapeHtml(translate('parsinegar.views.close'))}">×</button>
      </div>
      <div part="side-body">${view.render({ t: translate, items, currentId, documentText })}</div>
    </aside>`;
}

/**
 * Renders the menu bar with dropdowns.
 * @param {object} options Render options.
 * @param {Function} options.t Translation function.
 * @param {string|null} options.openMenu Open menu id.
 * @param {boolean} options.hasDocument Whether a document is open.
 * @returns {string} Menu bar markup.
 */
export function renderMenubar({ t, openMenu, hasDocument }) {
  const translate = typeof t === 'function' ? t : (key) => key;
  const markup = buildMenuModel({ t: translate, hasDocument }).map((menu) => {
    const open = openMenu === menu.id;
    return `
      <div part="menu">
        <button type="button" part="menu-button" data-menu="${menu.id}" aria-haspopup="true" aria-expanded="${open}">${escapeHtml(menu.label)}</button>
        <div part="menu-dropdown" role="menu" ${open ? '' : 'hidden'}>${menu.items.map((item) => `
          <button type="button" part="menu-item" role="menuitem" data-action="${item.id}" ${item.disabled ? 'disabled' : ''}>${escapeHtml(item.label)}</button>`).join('')}
        </div>
      </div>`;
  }).join('');
  return `<div part="menubar" role="menubar">${markup}</div>`;
}

/**
 * Renders the status bar with document statistics.
 * @param {object} options Render options.
 * @param {Function} options.t Translation function.
 * @param {boolean} options.bottomOpen Whether the bar is visible.
 * @param {object} options.stats `{ chars, words, lines }`.
 * @param {Function} options.formatNumber Number formatter.
 * @returns {string} Status bar markup or ''.
 */
export function renderStatusbar({ t, bottomOpen, stats, formatNumber }) {
  if (!bottomOpen) {
    return '';
  }
  const translate = typeof t === 'function' ? t : (key) => key;
  const format = typeof formatNumber === 'function' ? formatNumber : String;
  const safe = stats ?? { chars: 0, words: 0, lines: 0 };
  return `
    <footer part="statusbar">
      <span part="stat"><b part="stat-value" data-stat="chars">${format(safe.chars)}</b> ${escapeHtml(translate('parsinegar.stats.chars'))}</span>
      <span part="stat"><b part="stat-value" data-stat="words">${format(safe.words)}</b> ${escapeHtml(translate('parsinegar.stats.words'))}</span>
      <span part="stat"><b part="stat-value" data-stat="lines">${format(safe.lines)}</b> ${escapeHtml(translate('parsinegar.stats.lines'))}</span>
    </footer>`;
}
