// Files view: renders the document list markup.
//
// Pure render function owned by this view module; the registry only references
// it and holds no view logic. Takes explicit data, never services or DOM.
import { escapeHtml, iconMarkup } from './html.js';

/**
 * Renders the document list with management actions. The `openMenuId`
 * document (if any) renders its action menu open.
 * @param {object} options Render options.
 * @param {Function} options.t Translation function.
 * @param {Array<object>} options.items Documents with `{ id, title }`.
 * @param {string|null} options.currentId Open document id.
 * @param {string|null} [options.openMenuId] Document whose menu is open.
 * @param {object|null} [options.editing] Inline rename state `{ id, error }`.
 * @param {string|null} options.assetBaseUrl Resolved asset directory URL.
 * @returns {string} Files view markup.
 */
export function renderFilesView({ t, items, currentId, openMenuId, editing, assetBaseUrl }) {
  const translate = typeof t === 'function' ? t : (key) => key;
  const rows = (Array.isArray(items) ? items : []).map((item) => {
    const id = escapeHtml(item.id);
    const title = escapeHtml(item.title);
    if (editing && editing.id === item.id) {
      return `
    <li part="docs-item">
      <input type="text" part="docs-rename" data-rename-input="${id}" value="${title}" maxlength="120" aria-label="${escapeHtml(translate('parsinegar.documents.rename'))}">
      ${editing.error ? `<p part="docs-error" role="alert">${escapeHtml(translate(editing.error))}</p>` : ''}
    </li>`;
    }
    return `
    <li part="docs-item"${item.id === currentId ? ' data-current="true"' : ''}>
      <button type="button" part="docs-open" data-doc-id="${id}" ${item.id === currentId ? 'aria-current="true"' : ''}>${title}</button>
      <button type="button" part="docs-menu" data-doc-menu="${id}" aria-haspopup="true" aria-expanded="${openMenuId === item.id}" aria-label="${escapeHtml(translate('parsinegar.documents.menu'))}">⋯</button>
      ${openMenuId === item.id ? renderFileMenu(translate, id) : ''}
    </li>`;
  }).join('');
  const newLabel = escapeHtml(translate('parsinegar.documents.new'));
  const newIcon = iconMarkup(assetBaseUrl, 'plus') || newLabel;
  return `
    <div part="files-view">
      <div part="files-bar">
        <button type="button" part="docs-new" aria-label="${newLabel}" title="${newLabel}">${newIcon}</button>
      </div>
      <ul part="docs-list">${rows}</ul>
    </div>`;
}

/**
 * Renders the per-document action menu (rename, download, properties, delete).
 * @param {Function} translate Translation function.
 * @param {string} id Escaped document id.
 * @returns {string} Menu markup.
 */
function renderFileMenu(translate, id) {
  const entry = (key, labelKey) => `
        <button type="button" part="file-menu-item" data-file-${key}="${id}">${escapeHtml(translate(labelKey))}</button>`;
  return `
      <div part="file-menu" role="menu">${entry('rename', 'parsinegar.documents.rename')}${entry('download', 'parsinegar.documents.download')}${entry('properties', 'parsinegar.documents.properties')}${entry('delete', 'parsinegar.documents.delete')}
      </div>`;
}
