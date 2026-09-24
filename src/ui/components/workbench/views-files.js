// Files view: renders the document list markup.
//
// Pure render function owned by this view module; the registry only references
// it and holds no view logic. Takes explicit data, never services or DOM.
import { escapeHtml, iconMarkup } from './html.js';

/**
 * Available files-list orderings (select values, in display order).
 */
export const FILES_SORT_MODES = [
  'updated-desc',
  'updated-asc',
  'created-desc',
  'created-asc',
  'name',
];

/**
 * Default ordering: most recently updated first (matches the service).
 */
export const DEFAULT_FILES_SORT = 'updated-desc';

/**
 * Compares two titles in Persian alphabetical order, falling back to a
 * plain comparison when the locale is unavailable.
 * @param {string} left First title.
 * @param {string} right Second title.
 * @returns {number} Negative, zero or positive.
 */
function compareTitles(left, right) {
  try {
    return String(left ?? '').localeCompare(String(right ?? ''), 'fa');
  } catch {
    const plainLeft = String(left ?? '');
    const plainRight = String(right ?? '');
    if (plainLeft === plainRight) {
      return 0;
    }
    return plainLeft < plainRight ? -1 : 1;
  }
}

/**
 * Orders documents for display without mutating the input. Unknown modes
 * preserve the input order.
 * @param {Array<object>} items Documents with `{ id, title, createdAt, updatedAt }`.
 * @param {string} mode One of `FILES_SORT_MODES`.
 * @returns {Array<object>} Ordered copy (stable for equal keys).
 */
export function sortDocuments(items, mode) {
  const list = Array.isArray(items) ? [...items] : [];
  const stamp = (item, key) => Number(item?.[key] ?? item?.updatedAt ?? 0) || 0;
  switch (mode) {
    case 'updated-desc':
      return list.sort((left, right) => stamp(right, 'updatedAt') - stamp(left, 'updatedAt'));
    case 'updated-asc':
      return list.sort((left, right) => stamp(left, 'updatedAt') - stamp(right, 'updatedAt'));
    case 'created-desc':
      return list.sort((left, right) => stamp(right, 'createdAt') - stamp(left, 'createdAt'));
    case 'created-asc':
      return list.sort((left, right) => stamp(left, 'createdAt') - stamp(right, 'createdAt'));
    case 'name':
      return list.sort((left, right) => compareTitles(left.title, right.title));
    default:
      return list;
  }
}

/**
 * Renders the document list with management actions. The `openMenuId`
 * document (if any) renders its action menu open.
 * @param {object} options Render options.
 * @param {Function} options.t Translation function.
 * @param {Array<object>} options.items Documents with `{ id, title }` (already ordered).
 * @param {string|null} options.currentId Open document id.
 * @param {string|null} [options.openMenuId] Document whose menu is open.
 * @param {object|null} [options.editing] Inline rename state `{ id, error }`.
 * @param {string|null} options.assetBaseUrl Resolved asset directory URL.
 * @param {string} [options.sortMode] Active ordering for the sort select (defaults to `updated-desc`).
 * @returns {string} Files view markup.
 */
export function renderFilesView({ t, items, currentId, openMenuId, editing, assetBaseUrl, sortMode }) {
  const translate = typeof t === 'function' ? t : (key) => key;
  const activeSort = FILES_SORT_MODES.includes(sortMode) ? sortMode : DEFAULT_FILES_SORT;
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
  const sortOptions = FILES_SORT_MODES.map((mode) => `
        <option value="${mode}"${mode === activeSort ? ' selected' : ''}>${escapeHtml(translate(`parsinegar.documents.sort-${mode}`))}</option>`).join('');
  return `
    <div part="files-view">
      <div part="files-bar">
        <button type="button" part="docs-new" aria-label="${newLabel}" title="${newLabel}">${newIcon}</button>
        <select part="docs-sort" data-files-sort aria-label="${escapeHtml(translate('parsinegar.documents.sort'))}">${sortOptions}
        </select>
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
