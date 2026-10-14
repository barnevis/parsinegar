// Files view: renders the document list markup.
//
// Pure render function owned by this view module; the registry only references
// it and holds no view logic. Takes explicit data, never services or DOM.
import { escapeHtml, iconMarkup } from './html.js';
import { isListOnlyDocument } from './mindmap.js';

/**
 * Available files-list orderings, in menu display order.
 */
export const FILES_SORT_MODES = [
  'name',
  'name-desc',
  'updated-desc',
  'updated-asc',
  'created-desc',
  'created-asc',
];

/**
 * Default ordering: most recently updated first (matches the service).
 */
export const DEFAULT_FILES_SORT = 'updated-desc';

/**
 * Sort menu groups: headings with their option modes, in display order.
 */
export const FILES_SORT_GROUPS = [
  { heading: 'parsinegar.documents.sort-group-name', modes: ['name', 'name-desc'] },
  { heading: 'parsinegar.documents.sort-group-updated', modes: ['updated-desc', 'updated-asc'] },
  { heading: 'parsinegar.documents.sort-group-created', modes: ['created-desc', 'created-asc'] },
];

/**
 * Translation keys for each sort mode label.
 */
export const FILES_SORT_LABELS = {
  name: 'parsinegar.documents.sort-name-asc',
  'name-desc': 'parsinegar.documents.sort-name-desc',
  'updated-desc': 'parsinegar.documents.sort-newest',
  'updated-asc': 'parsinegar.documents.sort-oldest',
  'created-desc': 'parsinegar.documents.sort-newest',
  'created-asc': 'parsinegar.documents.sort-oldest',
};

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
    case 'name-desc':
      return list.sort((left, right) => compareTitles(right.title, left.title));
    default:
      return list;
  }
}

/**
 * Builds a nested folder tree from flat folder records. Siblings sort
 * alphabetically (Persian-aware); documents attach at render time.
 * @param {Array<object>} folders Flat folders with `{ id, name, parentId }`.
 * @returns {Array<object>} Dir nodes `{ kind: 'dir', key, label, id, children }`.
 */
export function buildFolderTree(folders) {
  const byParent = new Map();
  for (const folder of Array.isArray(folders) ? folders : []) {
    if (!folder || typeof folder.id !== 'string') {
      continue;
    }
    const parent = folder.parentId ?? null;
    if (!byParent.has(parent)) {
      byParent.set(parent, []);
    }
    byParent.get(parent).push(folder);
  }
  const nest = (parentId) => (byParent.get(parentId) ?? [])
    .sort((left, right) => compareTitles(left.name, right.name))
    .map((folder) => ({
      kind: 'dir',
      key: folder.id,
      label: folder.name,
      id: folder.id,
      children: nest(folder.id),
    }));
  return nest(null);
}

/**
 * Narrows documents and folders to mindmap-eligible ones: documents whose
 * content is list-only, plus folders holding (transitively) at least one
 * of them. Order and record shapes pass through untouched.
 * @param {Array<object>} items Documents with `{ id, folderId, content }`.
 * @param {Array<object>} folders Flat folders with `{ id, parentId }`.
 * @returns {object} `{ items, folders }` filtered copies.
 */
export function filterMindmapTree(items, folders) {
  const documents = Array.isArray(items) ? items : [];
  const eligible = new Set(
    documents
      .filter((item) => isListOnlyDocument(item?.content ?? ''))
      .map((item) => item?.id),
  );
  const byId = new Map();
  for (const folder of Array.isArray(folders) ? folders : []) {
    if (folder && typeof folder.id === 'string') {
      byId.set(folder.id, folder);
    }
  }
  const keptFolders = new Set();
  for (const item of documents) {
    if (!eligible.has(item?.id)) {
      continue;
    }
    let current = item?.folderId ?? null;
    const seen = new Set();
    while (typeof current === 'string' && current !== '' && byId.has(current) && !seen.has(current)) {
      seen.add(current);
      keptFolders.add(current);
      current = byId.get(current).parentId ?? null;
    }
  }
  return {
    items: documents.filter((item) => eligible.has(item?.id)),
    folders: [...byId.values()].filter((folder) => keptFolders.has(folder.id)),
  };
}

/**
 * Builds the display path of a folder through its parents ("کار / زیر").
 * @param {Map<string, object>} foldersById Folders keyed by id.
 * @param {string} id Folder id.
 * @returns {string} Display path.
 */
function folderDisplayPath(foldersById, id) {
  const segments = [];
  let current = foldersById.get(id) ?? null;
  while (current) {
    segments.unshift(current.name);
    current = current.parentId ? (foldersById.get(current.parentId) ?? null) : null;
  }
  return segments.join(' / ');
}

/**
 * Renders the document list with management actions. The `openMenuId`
 * document (if any) renders its action menu open.
 * @param {object} options Render options.
 * @param {Function} options.t Translation function.
 * @param {Array<object>} options.items Documents with `{ id, title }` (already ordered).
 * @param {Array<object>} [options.folders] Flat folders with `{ id, name, parentId }`.
 * @param {string|null} options.currentId Open document id.
 * @param {string|null} [options.openMenuId] Document whose menu is open (or `folder:<id>`).
 * @param {string|null} [options.moveMenuId] Document whose move submenu is open.
 * @param {object|null} [options.editing] Inline rename state `{ id, error }` (`folder:<id>` for folders).
 * @param {string|null} options.assetBaseUrl Resolved asset directory URL.
 * @param {string} [options.sortMode] Active ordering for the sort menu (defaults to `updated-desc`).
 * @param {boolean} [options.sortMenuOpen] Whether the sort menu renders open.
 * @param {Array<string>} [options.folderCollapsed] Collapsed folder ids.
 * @param {boolean} [options.mindmap] Mindmap section mode: only the new-map
 *   button and sorting stay in the bar (plain create/import would make
 *   documents the filtered list hides).
 * @returns {string} Files view markup.
 */
export function renderFilesView({ t, items, folders = [], currentId, openMenuId, moveMenuId, editing, assetBaseUrl, sortMode, sortMenuOpen, folderCollapsed = [], mindmap = false }) {
  const translate = typeof t === 'function' ? t : (key) => key;
  const activeSort = FILES_SORT_MODES.includes(sortMode) ? sortMode : DEFAULT_FILES_SORT;
  const documents = Array.isArray(items) ? items : [];
  const folderList = Array.isArray(folders) ? folders : [];
  const foldersById = new Map(folderList.filter((folder) => folder && typeof folder.id === 'string').map((folder) => [folder.id, folder]));
  const collapsed = new Set(Array.isArray(folderCollapsed) ? folderCollapsed : []);
  const scope = {
    translate, currentId, openMenuId, moveMenuId, editing, foldersById, collapsed,
  };
  const rootDocs = documents.filter((item) => (item.folderId ?? null) === null);
  const docsOf = (folderId) => documents.filter((item) => (item.folderId ?? null) === folderId);
  const renderDocRow = (item) => {
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
      <button type="button" part="docs-menu" data-doc-menu="${id}" aria-haspopup="true" aria-expanded="${openMenuId === item.id}" aria-label="${escapeHtml(translate('parsinegar.documents.menu'))}">⋮</button>
      ${openMenuId === item.id ? renderFileMenu(scope, id, item.id) : ''}
    </li>`;
  };
  const renderFolderNode = (node) => {
    const folderKey = `folder:${node.id}`;
    if (editing && editing.id === folderKey) {
      return `
    <li part="docs-item">
      <input type="text" part="docs-rename" data-rename-input="${escapeHtml(folderKey)}" value="${escapeHtml(node.label)}" maxlength="120" aria-label="${escapeHtml(translate('parsinegar.folders.rename'))}">
      ${editing.error ? `<p part="docs-error" role="alert">${escapeHtml(translate(editing.error))}</p>` : ''}
    </li>`;
    }
    const shut = collapsed.has(node.id);
    return `
    <li part="docs-item" data-folder-dir="true">
      <button type="button" part="docs-toggle" data-folder-toggle="${escapeHtml(node.id)}" aria-expanded="${shut ? 'false' : 'true'}" aria-label="${escapeHtml(translate(shut ? 'parsinegar.disk.expand' : 'parsinegar.disk.collapse'))}"><span part="outline-chevron" aria-hidden="true"></span><span>${escapeHtml(node.label)}</span></button>
      <button type="button" part="docs-menu" data-doc-menu="${escapeHtml(folderKey)}" aria-haspopup="true" aria-expanded="${openMenuId === folderKey}" aria-label="${escapeHtml(translate('parsinegar.folders.menu'))}">⋮</button>
      ${openMenuId === folderKey ? renderFolderMenu(translate, node.id) : ''}
      ${shut ? '' : `<ul part="docs-list">${node.children.map(renderFolderNode).join('')}${docsOf(node.id).map(renderDocRow).join('')}</ul>`}
    </li>`;
  };
  const rows = [
    ...rootDocs.map(renderDocRow),
    ...buildFolderTree(folderList).map(renderFolderNode),
  ].join('');
  const newLabel = escapeHtml(translate('parsinegar.documents.new'));
  const newIcon = iconMarkup(assetBaseUrl, 'add-notes') || newLabel;
  const newFolderLabel = escapeHtml(translate('parsinegar.folders.new'));
  const newFolderIcon = iconMarkup(assetBaseUrl, 'create-new-folder') || newFolderLabel;
  const importLabel = escapeHtml(translate('parsinegar.documents.import'));
  const importIcon = iconMarkup(assetBaseUrl, 'upload') || importLabel;
  const sortLabel = escapeHtml(translate('parsinegar.documents.sort'));
  const sortIcon = iconMarkup(assetBaseUrl, 'sort') || sortLabel;
  const sortBit = `
        <div part="docs-sort-wrap">
          <button type="button" part="docs-sort" data-doc-sort aria-haspopup="true" aria-expanded="${sortMenuOpen === true}" aria-label="${sortLabel}" title="${sortLabel}">${sortIcon}</button>
          ${sortMenuOpen === true ? renderSortMenu(translate, activeSort) : ''}
        </div>`;
  const mindmapNewLabel = escapeHtml(translate('parsinegar.views.mindmap-new'));
  const mindmapNewIcon = iconMarkup(assetBaseUrl, 'account-tree') || mindmapNewLabel;
  const createBit = mindmap === true
    ? `<button type="button" part="docs-mindmap-new" data-mindmap-new aria-label="${mindmapNewLabel}" title="${mindmapNewLabel}">${mindmapNewIcon}</button>`
    : `<button type="button" part="docs-new" aria-label="${newLabel}" title="${newLabel}">${newIcon}</button>
        <button type="button" part="docs-folder-new" aria-label="${newFolderLabel}" title="${newFolderLabel}">${newFolderIcon}</button>
        <button type="button" part="docs-import" aria-label="${importLabel}" title="${importLabel}">${importIcon}</button>`;
  return `
    <div part="files-view">
      <div part="files-bar">
        ${createBit}
        ${sortBit}
      </div>
      <ul part="docs-list">${rows}</ul>
    </div>`;
}

/**
 * Renders the sort menu with grouped options, marking the active mode.
 * @param {Function} translate Translation function.
 * @param {string} activeSort Active ordering mode.
 * @returns {string} Sort menu markup.
 */
function renderSortMenu(translate, activeSort) {
  const groups = FILES_SORT_GROUPS.map((group) => `
      <div part="file-menu-group">
        <p part="file-menu-heading">${escapeHtml(translate(group.heading))}</p>${group.modes.map((mode) => `
        <button type="button" part="file-menu-item" data-files-sort="${mode}" role="menuitemradio" aria-checked="${mode === activeSort}">${escapeHtml(translate(FILES_SORT_LABELS[mode]))}</button>`).join('')}
      </div>`).join('');
  return `
      <div part="file-menu" role="menu">${groups}
      </div>`;
}

/**
 * Renders the per-document action menu (rename, move submenu, download,
 * download-html, properties, delete).
 * @param {object} scope Render scope `{ translate, moveMenuId, foldersById }`.
 * @param {string} id Escaped document id.
 * @param {string} rawId Unescaped document id for move targets.
 * @returns {string} Menu markup.
 */
function renderFileMenu(scope, id, rawId) {
  const { translate, moveMenuId, foldersById } = scope;
  const entry = (key, labelKey) => `
        <button type="button" part="file-menu-item" data-file-${key}="${id}">${escapeHtml(translate(labelKey))}</button>`;
  const open = moveMenuId === rawId;
  const targets = [`<button type="button" part="file-menu-item" data-move-to="${id}|">${escapeHtml(translate('parsinegar.folders.moveRoot'))}</button>`];
  for (const folder of [...foldersById.values()].sort((left, right) => compareTitles(left.name, right.name))) {
    targets.push(`<button type="button" part="file-menu-item" data-move-to="${id}|${escapeHtml(folder.id)}">${escapeHtml(folderDisplayPath(foldersById, folder.id))}</button>`);
  }
  return `
      <div part="file-menu" role="menu">${entry('rename', 'parsinegar.documents.rename')}<div part="file-submenu-wrap"><button type="button" part="file-menu-item" role="menuitem" data-move-toggle="${id}" aria-haspopup="true" aria-expanded="${open ? 'true' : 'false'}"><span>${escapeHtml(translate('parsinegar.folders.moveTo'))}</span><span part="file-sub-indicator" aria-hidden="true">‹</span></button><div part="file-submenu" role="menu" ${open ? '' : 'hidden'}>${targets.join('')}</div></div>${entry('download', 'parsinegar.documents.download')}${entry('download-html', 'parsinegar.documents.downloadHtml')}${entry('properties', 'parsinegar.documents.properties')}${entry('delete', 'parsinegar.documents.delete')}
      </div>`;
}

/**
 * Renders the per-folder action menu (rename, new document here, delete).
 * @param {Function} translate Translation function.
 * @param {string} id Unescaped folder id.
 * @returns {string} Menu markup.
 */
function renderFolderMenu(translate, id) {
  const safe = escapeHtml(id);
  const entry = (key, labelKey) => `
        <button type="button" part="file-menu-item" data-folder-${key}="${safe}">${escapeHtml(translate(labelKey))}</button>`;
  return `
      <div part="file-menu" role="menu">${entry('rename', 'parsinegar.folders.rename')}${entry('new-doc', 'parsinegar.folders.newHere')}${entry('delete', 'parsinegar.folders.delete')}
      </div>`;
}
