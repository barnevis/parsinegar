// Files view: renders the document list markup.
//
// Pure render function owned by this view module; the registry only references
// it and holds no view logic. Takes explicit data, never services or DOM.
import { escapeHtml, iconMarkup } from './html.js';

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
 * Builds a nested directory tree from flat device entries. Intermediate
 * directories are derived from relative paths; directories sort before
 * files, each alphabetically (Persian-aware).
 * @param {Array<object>} entries Flat entries with `{ id, title, path }`.
 * @returns {Array<object>} Tree nodes: `{ kind: 'dir', key, label, children }`
 *   or `{ kind: 'file', key, label, id, path }`.
 */
export function buildDiskTree(entries) {
  const root = { kind: 'dir', key: '', label: '', children: [], directories: new Map() };
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry.path !== 'string') {
      continue;
    }
    const segments = entry.path.split('/').filter((segment) => segment.length > 0);
    if (segments.length === 0) {
      continue;
    }
    let node = root;
    let prefix = '';
    for (const segment of segments.slice(0, -1)) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let child = node.directories.get(prefix);
      if (!child) {
        child = { kind: 'dir', key: prefix, label: segment, children: [], directories: new Map() };
        node.directories.set(prefix, child);
        node.children.push(child);
      }
      node = child;
    }
    node.children.push({
      kind: 'file',
      key: entry.path,
      label: segments[segments.length - 1],
      id: entry.id,
      path: entry.path,
    });
  }
  const order = (nodes) => {
    for (const node of nodes) {
      if (node.kind === 'dir') {
        order(node.children);
      }
    }
    nodes.sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'dir' ? -1 : 1;
      }
      return compareTitles(left.label, right.label);
    });
  };
  const strip = (nodes) => nodes.map(({ directories, ...node }) => (
    node.kind === 'dir' ? { ...node, children: strip(node.children) } : node
  ));
  order(root.children);
  return strip(root.children);
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
 * @param {string} [options.sortMode] Active ordering for the sort menu (defaults to `updated-desc`).
 * @param {boolean} [options.sortMenuOpen] Whether the sort menu renders open.
 * @param {object|null} [options.disk] Open device folder: `{ root, entries, collapsed }` (highlight via `currentId`).
 * @returns {string} Files view markup.
 */
export function renderFilesView({ t, items, currentId, openMenuId, editing, assetBaseUrl, sortMode, sortMenuOpen, disk = null }) {
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
  const newIcon = iconMarkup(assetBaseUrl, 'add-notes') || newLabel;
  const importLabel = escapeHtml(translate('parsinegar.documents.import'));
  const importIcon = iconMarkup(assetBaseUrl, 'upload') || importLabel;
  const sortLabel = escapeHtml(translate('parsinegar.documents.sort'));
  const sortIcon = iconMarkup(assetBaseUrl, 'sort') || sortLabel;
  const fileIcon = iconMarkup(assetBaseUrl, 'file-copy') || '';
  return `
    <div part="files-view">
      <div part="files-bar">
        <button type="button" part="docs-new" aria-label="${newLabel}" title="${newLabel}">${newIcon}</button>
        <button type="button" part="docs-import" aria-label="${importLabel}" title="${importLabel}">${importIcon}</button>
        <div part="docs-sort-wrap">
          <button type="button" part="docs-sort" data-doc-sort aria-haspopup="true" aria-expanded="${sortMenuOpen === true}" aria-label="${sortLabel}" title="${sortLabel}">${sortIcon}</button>
          ${sortMenuOpen === true ? renderSortMenu(translate, activeSort) : ''}
        </div>
      </div>
      <ul part="docs-list">${rows}</ul>
      ${renderDiskGroup(translate, fileIcon, disk, currentId)}
    </div>`;
}

/**
 * Renders one device-tree node: a directory toggle with a nested list, or
 * a file row (marked with the files glyph, no ⋯ menu — device entries have
 * no rename/download/delete).
 * @param {Function} translate Translation function.
 * @param {string|null} fileIcon Files glyph markup.
 * @param {object} node Tree node from `buildDiskTree`.
 * @param {string|null} currentId Open document id.
 * @param {Array<string>} collapsed Collapsed directory paths.
 * @returns {string} Node markup.
 */
function renderDiskNode(translate, fileIcon, node, currentId, collapsed) {
  if (node.kind === 'dir') {
    const shut = collapsed.includes(node.key);
    const toggle = escapeHtml(node.key);
    return `
    <li part="docs-item" data-disk-dir="true">
      <button type="button" part="docs-toggle" data-disk-toggle="${toggle}" aria-expanded="${shut ? 'false' : 'true'}"><span part="docs-toggle-icon"${shut ? ' data-collapsed="true"' : ''}></span><span>${escapeHtml(node.label)}</span></button>
      ${shut ? '' : `<ul part="docs-list">${node.children.map((child) => renderDiskNode(translate, fileIcon, child, currentId, collapsed)).join('')}</ul>`}
    </li>`;
  }
  const id = escapeHtml(node.id);
  return `
    <li part="docs-item"${node.id === currentId ? ' data-current="true"' : ''} data-disk="true" title="${escapeHtml(node.path)}">
      <button type="button" part="docs-open" data-doc-id="${id}" ${node.id === currentId ? 'aria-current="true"' : ''}>${fileIcon}<span>${escapeHtml(node.label)}</span></button>
    </li>`;
}

/**
 * Renders the open device folder as a second group below the documents:
 * a header with the folder label plus the collapsible file tree. The open
 * row highlights through the shared `currentId` (`disk:<path>` ids).
 * @param {Function} translate Translation function.
 * @param {string|null} fileIcon Files glyph markup.
 * @param {object} disk `{ root, entries, collapsed }`.
 * @param {string|null} currentId Open document id.
 * @returns {string} Group markup (empty when no folder is open).
 */
function renderDiskGroup(translate, fileIcon, disk, currentId) {
  if (!disk || !Array.isArray(disk.entries) || disk.entries.length === 0) {
    return '';
  }
  const collapsed = Array.isArray(disk.collapsed) ? disk.collapsed : [];
  const tree = buildDiskTree(disk.entries);
  return `
      <p part="docs-group">${fileIcon}<span>${escapeHtml(disk.root ?? '')}</span></p>
      <ul part="docs-list">${tree.map((node) => renderDiskNode(translate, fileIcon, node, currentId, collapsed)).join('')}</ul>`;
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
 * Renders the per-document action menu (rename, download, download-html,
 * properties, delete).
 * @param {Function} translate Translation function.
 * @param {string} id Escaped document id.
 * @returns {string} Menu markup.
 */
function renderFileMenu(translate, id) {
  const entry = (key, labelKey) => `
        <button type="button" part="file-menu-item" data-file-${key}="${id}">${escapeHtml(translate(labelKey))}</button>`;
  return `
      <div part="file-menu" role="menu">${entry('rename', 'parsinegar.documents.rename')}${entry('download', 'parsinegar.documents.download')}${entry('download-html', 'parsinegar.documents.downloadHtml')}${entry('properties', 'parsinegar.documents.properties')}${entry('delete', 'parsinegar.documents.delete')}
      </div>`;
}
