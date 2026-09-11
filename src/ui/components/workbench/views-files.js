// Files view: renders the document list markup.
//
// Pure render function owned by this view module; the registry only references
// it and holds no view logic. Takes explicit data, never services or DOM.
import { escapeHtml } from './html.js';

/**
 * Renders the document list with management actions.
 * @param {object} options Render options.
 * @param {Function} options.t Translation function.
 * @param {Array<object>} options.items Documents with `{ id, title }`.
 * @param {string|null} options.currentId Open document id.
 * @returns {string} Files view markup.
 */
export function renderFilesView({ t, items, currentId }) {
  const translate = typeof t === 'function' ? t : (key) => key;
  const rows = (Array.isArray(items) ? items : []).map((item) => `
    <li part="docs-item">
      <button type="button" part="docs-open" data-doc-id="${escapeHtml(item.id)}" ${item.id === currentId ? 'aria-current="true"' : ''}>${escapeHtml(item.title)}</button>
    </li>`).join('');
  return `
    <div part="files-view">
      <div part="files-bar">
        <button type="button" part="docs-new">${escapeHtml(translate('parsinegar.documents.new'))}</button>
        <button type="button" part="docs-delete">${escapeHtml(translate('parsinegar.documents.delete'))}</button>
      </div>
      <ul part="docs-list">${rows}</ul>
    </div>`;
}
