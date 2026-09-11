// Outline view: renders the document heading outline markup.
//
// Pure render function owned by this view module; the registry only references
// it and holds no view logic. Takes explicit data, never services or DOM.
import { escapeHtml } from './html.js';
import { parseOutline } from './outline.js';

/**
 * Renders the heading outline with navigation targets.
 * @param {object} options Render options.
 * @param {Function} options.t Translation function.
 * @param {string} options.documentText Raw document text.
 * @returns {string} Outline markup.
 */
export function renderOutlineView({ t, documentText }) {
  const translate = typeof t === 'function' ? t : (key) => key;
  const headings = parseOutline(documentText);
  if (headings.length === 0) {
    return `<p part="outline-empty">${escapeHtml(translate('parsinegar.views.outline-empty'))}</p>`;
  }
  const rows = headings.map(({ level, text, line }) => `
    <li part="outline-item">
      <button type="button" part="outline-jump outline-level-${level}" data-line="${line}">${escapeHtml(text)}</button>
    </li>`).join('');
  return `<ul part="outline-list">${rows}</ul>`;
}
