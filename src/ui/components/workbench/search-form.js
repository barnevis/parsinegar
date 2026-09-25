// Search form: renders the find/replace controls for the menubar dropdown.
//
// Pure render function owned by this module; the menubar element owns the
// interaction state and reports through `search-*` events. Takes explicit
// data, never services or DOM. Typing state survives the menubar re-renders
// through `data-pey-preserve` on the inputs (value, selection and focus are
// restored after each render by the kit contract).
import { escapeHtml } from './html.js';

/**
 * Renders one search flag checkbox.
 * @param {Function} translate Translation function.
 * @param {string} flag Flag name for `data-search-flag`.
 * @param {string} labelKey Translation key for the label.
 * @param {boolean} checked Whether the flag is on.
 * @returns {string} Checkbox markup.
 */
function renderFlag(translate, flag, labelKey, checked) {
  return `
    <label part="search-flag">
      <input type="checkbox" data-search-flag="${flag}" data-pey-preserve="search-flag-${flag}" data-pey-preserve-state="checked focus"${checked ? ' checked' : ''}>
      <span>${escapeHtml(translate(labelKey))}</span>
    </label>`;
}

/**
 * Renders the counter text for the current result.
 * @param {Function} translate Translation function.
 * @param {Function} formatNumber Number formatter.
 * @param {object|null} count `{ current, total }`, or null before any query.
 * @returns {string} Counter text (empty before any query).
 */
function renderCount(translate, formatNumber, count) {
  if (!count || typeof count !== 'object') {
    return '';
  }
  if (!Number.isInteger(count.total) || count.total <= 0) {
    return escapeHtml(translate('parsinegar.search.no-results'));
  }
  return escapeHtml(
    translate('parsinegar.search.count')
      .replace('{current}', formatNumber(count.current))
      .replace('{total}', formatNumber(count.total)),
  );
}

/**
 * Renders the status line for errors and replace confirmations.
 * @param {Function} translate Translation function.
 * @param {Function} formatNumber Number formatter.
 * @param {object} state Search form state.
 * @returns {string} Status text (empty when there is nothing to report).
 */
function renderMessage(translate, formatNumber, state) {
  if (state.invalidRegexp) {
    return escapeHtml(translate('parsinegar.search.invalid-regexp'));
  }
  if (Number.isInteger(state.replaced)) {
    return escapeHtml(
      translate('parsinegar.search.replaced').replace('{count}', formatNumber(state.replaced)),
    );
  }
  return '';
}

/**
 * Renders the find/replace form for the current search state.
 * @param {object} options Render options.
 * @param {Function} options.t Translation function.
 * @param {object} [options.state] `{ query, replace, caseSensitive,
 *   wholeWord, regexp, inSelection, count, invalidRegexp, replaced }`.
 * @param {Function} [options.formatNumber] Number formatter.
 * @returns {string} Search form markup.
 */
export function renderSearchForm({ t, state = {}, formatNumber = String }) {
  const translate = typeof t === 'function' ? t : (key) => key;
  const snapshot = state !== null && typeof state === 'object' ? state : {};
  const format = typeof formatNumber === 'function' ? formatNumber : String;
  const query = typeof snapshot.query === 'string' ? snapshot.query : '';
  const replace = typeof snapshot.replace === 'string' ? snapshot.replace : '';
  return `
    <div part="search-form" data-search-form>
      <p part="search-scope">${escapeHtml(translate('parsinegar.search.scope-note'))}</p>
      <label part="search-field">
        <span>${escapeHtml(translate('parsinegar.search.query'))}</span>
        <input type="text" part="search-input" data-search-query data-pey-preserve="search-query" data-pey-preserve-state="value selection focus" value="${escapeHtml(query)}" autocomplete="off" spellcheck="false">
      </label>
      <label part="search-field">
        <span>${escapeHtml(translate('parsinegar.search.replace'))}</span>
        <input type="text" part="search-input" data-search-replace data-pey-preserve="search-replace" data-pey-preserve-state="value selection focus" value="${escapeHtml(replace)}" autocomplete="off" spellcheck="false">
      </label>
      <div part="search-flags">
        ${renderFlag(translate, 'caseSensitive', 'parsinegar.search.case', snapshot.caseSensitive === true)}
        ${renderFlag(translate, 'wholeWord', 'parsinegar.search.word', snapshot.wholeWord === true)}
        ${renderFlag(translate, 'regexp', 'parsinegar.search.regexp', snapshot.regexp === true)}
        ${renderFlag(translate, 'inSelection', 'parsinegar.search.selection', snapshot.inSelection === true)}
      </div>
      <div part="search-row">
        <button type="button" part="search-button" data-search-action="previous" data-pey-preserve="search-action-previous" data-pey-preserve-state="focus">${escapeHtml(translate('parsinegar.search.previous'))}</button>
        <output part="search-count" data-search-count>${renderCount(translate, format, snapshot.count)}</output>
        <button type="button" part="search-button" data-search-action="next" data-pey-preserve="search-action-next" data-pey-preserve-state="focus">${escapeHtml(translate('parsinegar.search.next'))}</button>
      </div>
      <div part="search-row">
        <button type="button" part="search-button" data-search-action="replace-one" data-pey-preserve="search-action-replace-one" data-pey-preserve-state="focus">${escapeHtml(translate('parsinegar.search.replace-one'))}</button>
        <button type="button" part="search-button" data-search-action="replace-all" data-pey-preserve="search-action-replace-all" data-pey-preserve-state="focus">${escapeHtml(translate('parsinegar.search.replace-all'))}</button>
      </div>
      <p part="search-message" role="status" data-search-message>${renderMessage(translate, format, snapshot)}</p>
    </div>`;
}
