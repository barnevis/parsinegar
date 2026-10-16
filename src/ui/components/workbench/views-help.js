// Help view: the complete supported reference — every markdown mark,
// every editor shortcut and every mindmap gesture Parsinegar supports.
// Labels translate; samples are literal universal syntax. The full manual
// stays in the editor guide.
//
// Sources of truth: INSERT_MARK_KINDS (marks), menu-model shortcuts plus
// the guide prose (Tab/Enter/Alt+Arrow/Escape), and the mindmap section.
// A supported capability missing here is a bug in this file.
import { escapeHtml } from './html.js';

// Label keys reuse the insert menu catalog (same Persian words everywhere);
// samples are the exact syntax from the guide.
const MARKS = [
  { labelKey: 'parsinegar.help.mark-heading', sample: '#' },
  { labelKey: 'parsinegar.insert.bold', sample: '**متن**' },
  { labelKey: 'parsinegar.insert.italic', sample: '*متن*' },
  { labelKey: 'parsinegar.insert.strikethrough', sample: '~~متن~~' },
  { labelKey: 'parsinegar.insert.quote', sample: '> ' },
  { labelKey: 'parsinegar.insert.link', sample: '[متن]()' },
  { labelKey: 'parsinegar.insert.image', sample: '![](src)' },
  { labelKey: 'parsinegar.insert.code', sample: '`متن`' },
  { labelKey: 'parsinegar.insert.code-block', sample: '```' },
  { labelKey: 'parsinegar.insert.unordered-list', sample: '- ' },
  { labelKey: 'parsinegar.insert.ordered-list', sample: '1. ' },
  { labelKey: 'parsinegar.insert.task-list', sample: '- [ ] ' },
  { labelKey: 'parsinegar.insert.highlight', sample: '==متن==' },
  { labelKey: 'parsinegar.insert.horizontal-rule', sample: '---' },
  { labelKey: 'parsinegar.insert.table', sample: '| |' },
  { labelKey: 'parsinegar.insert.admonition-warning', sample: '...هشدار' },
  { labelKey: 'parsinegar.insert.admonition-caution', sample: '...احتیاط' },
  { labelKey: 'parsinegar.insert.admonition-important', sample: '...مهم' },
  { labelKey: 'parsinegar.insert.admonition-tip', sample: '...راهنما' },
  { labelKey: 'parsinegar.insert.admonition-note', sample: '...نکته' },
  { labelKey: 'parsinegar.insert.poem', sample: '...شعر' },
];

const SHORTCUTS = [
  { labelKey: 'parsinegar.insert.heading', sample: 'Ctrl+H' },
  { labelKey: 'parsinegar.insert.bold', sample: 'Ctrl+B' },
  { labelKey: 'parsinegar.insert.italic', sample: 'Ctrl+I' },
  { labelKey: 'parsinegar.insert.strikethrough', sample: 'Ctrl+Shift+S' },
  { labelKey: 'parsinegar.insert.quote', sample: 'Ctrl+Alt+Q' },
  { labelKey: 'parsinegar.insert.link', sample: 'Ctrl+K' },
  { labelKey: 'parsinegar.insert.code', sample: 'Ctrl+`' },
  { labelKey: 'parsinegar.insert.unordered-list', sample: 'Ctrl+Shift+U' },
  { labelKey: 'parsinegar.insert.ordered-list', sample: 'Ctrl+Shift+L' },
  { labelKey: 'parsinegar.insert.task-list', sample: 'Ctrl+Shift+T' },
  { labelKey: 'parsinegar.insert.highlight', sample: 'Ctrl+Shift+H' },
  { labelKey: 'parsinegar.insert.image', sample: 'Ctrl+Shift+M' },
  { labelKey: 'parsinegar.insert.horizontal-rule', sample: 'Ctrl+Shift+Y' },
  { labelKey: 'parsinegar.insert.table', sample: 'Ctrl+Shift+G' },
  { labelKey: 'parsinegar.insert.poem', sample: 'Ctrl+Shift+X' },
  { labelKey: 'parsinegar.insert.code-block', sample: 'Ctrl+E' },
  { labelKey: 'parsinegar.search.button', sample: 'Ctrl+F' },
  { labelKey: 'parsinegar.help.shortcut-replace', sample: 'Ctrl+Shift+F' },
  { labelKey: 'parsinegar.help.shortcut-indent', sample: 'Tab / Shift+Tab' },
  { labelKey: 'parsinegar.help.shortcut-new-item', sample: 'Enter' },
  { labelKey: 'parsinegar.help.shortcut-move', sample: 'Alt+Arrow' },
  { labelKey: 'parsinegar.help.shortcut-cancel', sample: 'Escape' },
];

const MINDMAP = [
  { labelKey: 'parsinegar.help.mindmap-edit', sample: 'دابل‌کلیک' },
  { labelKey: 'parsinegar.help.mindmap-child', sample: 'Tab' },
  { labelKey: 'parsinegar.help.mindmap-sibling', sample: 'Enter' },
  { labelKey: 'parsinegar.help.mindmap-sibling-before', sample: 'Shift+Enter' },
  { labelKey: 'parsinegar.help.mindmap-delete', sample: 'Delete' },
  { labelKey: 'parsinegar.help.mindmap-drag', sample: 'درگ' },
  { labelKey: 'parsinegar.help.mindmap-collapse', sample: 'دایره کنار گره' },
];

/**
 * Renders one reference row: translated label plus literal sample.
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
        <ul part="help-list">${MINDMAP.map((row) => renderHelpRow(translate, row)).join('')}</ul>
        <div part="settings-actions">
          <button type="button" part="settings-button" data-help-full>${escapeHtml(translate('parsinegar.help.full-guide'))}</button>
        </div>
      </fieldset>
    </div>`;
}
