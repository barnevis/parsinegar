// Help view: markdown cheatsheet, shortcuts and the mindmap guide.
//
// Pure render function owned by this view module; the registry only
// references it. Static reference content (labels translate, samples are
// universal syntax) — the full manual stays in the editor guide.
import { escapeHtml } from './html.js';

const MARKS = [
  { labelKey: 'parsinegar.help.heading-one', sample: '#' },
  { labelKey: 'parsinegar.help.heading-two', sample: '##' },
  { labelKey: 'parsinegar.help.ordered-list', sample: '1.' },
  { labelKey: 'parsinegar.help.unordered-list', sample: '-' },
];

const SHORTCUTS = [
  { labelKey: 'parsinegar.help.shortcut-bold', sample: 'Ctrl+B' },
  { labelKey: 'parsinegar.help.shortcut-italic', sample: 'Ctrl+I' },
  { labelKey: 'parsinegar.help.shortcut-heading', sample: 'Ctrl+H' },
  { labelKey: 'parsinegar.help.shortcut-ordered', sample: 'Ctrl+Shift+L' },
  { labelKey: 'parsinegar.help.shortcut-unordered', sample: 'Ctrl+Shift+U' },
  { labelKey: 'parsinegar.help.shortcut-search', sample: 'Ctrl+F' },
  { labelKey: 'parsinegar.help.shortcut-indent', sample: 'Tab' },
  { labelKey: 'parsinegar.help.shortcut-new-item', sample: 'Enter' },
];

/**
 * Renders one cheatsheet row: translated label plus literal sample.
 * @param {Function} translate Translation function.
 * @param {object} row `{ labelKey, sample }`.
 * @returns {string} Row markup.
 */
function renderHelpRow(translate, row) {
  return `
    <li part="help-row">
      <span>${escapeHtml(translate(row.labelKey))}</span>
      <code dir="ltr" part="help-code">${escapeHtml(row.sample)}</code>
    </li>`;
}

/**
 * Renders the help reference.
 * @param {object} options Render options.
 * @param {Function} options.t Translation function.
 * @returns {string} Help view markup.
 */
export function renderHelpView({ t }) {
  const translate = typeof t === 'function' ? t : (key) => key;
  return `
    <div part="settings-view">
      <fieldset part="settings-group">
        <legend part="settings-legend">${escapeHtml(translate('parsinegar.help.marks-title'))}</legend>
        <ul part="help-list">${MARKS.map((row) => renderHelpRow(translate, row)).join('')}</ul>
      </fieldset>
      <fieldset part="settings-group">
        <legend part="settings-legend">${escapeHtml(translate('parsinegar.help.shortcuts-title'))}</legend>
        <ul part="help-list">${SHORTCUTS.map((row) => renderHelpRow(translate, row)).join('')}</ul>
      </fieldset>
      <fieldset part="settings-group">
        <legend part="settings-legend">${escapeHtml(translate('parsinegar.help.mindmap-title'))}</legend>
        <p part="settings-note">${escapeHtml(translate('parsinegar.help.mindmap-body'))}</p>
        <div part="settings-actions">
          <button type="button" part="settings-button" data-help-full>${escapeHtml(translate('parsinegar.help.full-guide'))}</button>
        </div>
      </fieldset>
    </div>`;
}
