// Files view: renders the document list markup.
//
// Pure render function owned by this view module; the registry only references
// it and holds no view logic. Takes explicit data, never services or DOM.
import { escapeHtml } from './html.js';

/**
 * Renders the document list.
 * @param {object} options Render options.
 * @param {Array<object>} options.items Documents with `{ id, title }`.
 * @param {string|null} options.currentId Open document id.
 * @returns {string} List markup.
 */
export function renderFilesView({ items, currentId }) {
  const rows = (Array.isArray(items) ? items : []).map((item) => `
    <li part="docs-item">
      <button type="button" part="docs-open" data-doc-id="${escapeHtml(item.id)}" ${item.id === currentId ? 'aria-current="true"' : ''}>${escapeHtml(item.title)}</button>
    </li>`).join('');
  return `<ul part="docs-list">${rows}</ul>`;
}
