// Files view: renders the document list markup.
//
// Pure render function owned by this view module; the registry only references
// it and holds no view logic. Takes explicit data, never services or DOM.
import { escapeHtml, iconMarkup } from './html.js';

/**
 * Renders the document list with management actions.
 * @param {object} options Render options.
 * @param {Function} options.t Translation function.
 * @param {Array<object>} options.items Documents with `{ id, title }`.
 * @param {string|null} options.currentId Open document id.
 * @param {string|null} options.assetBaseUrl Resolved asset directory URL.
 * @param {string|null} options.confirmId Id awaiting delete confirmation.
 * @returns {string} Files view markup.
 */
export function renderFilesView({ t, items, currentId, assetBaseUrl, confirmId }) {
  const translate = typeof t === 'function' ? t : (key) => key;
  const rows = (Array.isArray(items) ? items : []).map((item) => {
    const openButton = `
    <li part="docs-item">
      <button type="button" part="docs-open" data-doc-id="${escapeHtml(item.id)}" ${item.id === currentId ? 'aria-current="true"' : ''}>${escapeHtml(item.title)}</button>
    </li>`;
    if (item.id !== confirmId) {
      return openButton;
    }
    return `${openButton}
    <li part="docs-confirm" role="alert">
      <span part="docs-confirm-text">${escapeHtml(translate('parsinegar.documents.delete-confirm', { title: item.title }))}</span>
      <button type="button" part="docs-confirm-yes" data-confirm-delete="yes">${escapeHtml(translate('parsinegar.documents.delete-yes'))}</button>
      <button type="button" part="docs-confirm-no" data-confirm-delete="no">${escapeHtml(translate('parsinegar.documents.delete-no'))}</button>
    </li>`;
  }).join('');
  const newLabel = escapeHtml(translate('parsinegar.documents.new'));
  const deleteLabel = escapeHtml(translate('parsinegar.documents.delete'));
  const newIcon = iconMarkup(assetBaseUrl, 'plus') || newLabel;
  const deleteIcon = iconMarkup(assetBaseUrl, 'trash') || deleteLabel;
  return `
    <div part="files-view">
      <div part="files-bar">
        <button type="button" part="docs-new" aria-label="${newLabel}" title="${newLabel}">${newIcon}</button>
        <button type="button" part="docs-delete" aria-label="${deleteLabel}" title="${deleteLabel}">${deleteIcon}</button>
      </div>
      <ul part="docs-list">${rows}</ul>
    </div>`;
}
