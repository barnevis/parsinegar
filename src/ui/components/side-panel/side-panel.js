// Side panel element: header plus the active view content.
//
// Renders view markup through the side-panel registry (views.js), which holds
// only metadata and references — each view owns its markup. Re-renders are
// skipped when neither the items nor the outline signature changed, so
// per-keystroke updates from the parent stay cheap. User actions leave as
// CustomEvents for the parent to map to behavior.
import { PeyElement } from 'pey.webui/base/pey-element';
import { escapeHtml } from '../workbench/html.js';
import { FILES_VIEW, getView } from '../workbench/views.js';
import { DEFAULT_FILES_SORT, FILES_SORT_MODES, filterMindmapTree, renderFilesView, sortDocuments } from '../workbench/views-files.js';
import { outlineSignature } from '../workbench/outline.js';

const TAG = 'parsi-side-panel';
const STYLE_URL = new URL('./side-panel.css', import.meta.url).href;

class ParsiSidePanel extends PeyElement {
  #t = (key) => key;
  #assetBaseUrl = null;
  #formatNumber = null;
  #onDocumentClick = (event) => {
    if (this.#openFileMenu === null && this.#sortMenuOpen === false) {
      return;
    }
    if (event.composedPath().includes(this)) {
      return;
    }
    this.#openFileMenu = null;
    this.#moveMenuId = null;
    this.#sortMenuOpen = false;
    this.requestRender();
  };
  #onDocumentKeydown = (event) => {
    if (event.key === 'Escape' && (this.#openFileMenu !== null || this.#sortMenuOpen)) {
      this.#openFileMenu = null;
      this.#moveMenuId = null;
      this.#sortMenuOpen = false;
      this.requestRender();
    }
  };
  #activeView = FILES_VIEW;
  #mindmapMode = false;
  #items = [];
  #folders = [];
  #currentId = null;
  #documentText = '';
  #settings = null;
  #activeLine = null;
  #openFileMenu = null;
  #sortMenuOpen = false;
  #editingId = null;
  #renameError = null;
  #filesSort = DEFAULT_FILES_SORT;
  #sync = null;
  #collapsedLines = new Set();
  #folderCollapsed = new Set();
  #moveMenuId = null;
  #applied = null;

  onConnect(refs = {}) {
    if (typeof refs.t === 'function') {
      this.#t = refs.t;
    }
    if (typeof refs.assetBaseUrl === 'string' && refs.assetBaseUrl.length > 0) {
      this.#assetBaseUrl = refs.assetBaseUrl;
    }
    if (typeof refs.formatNumber === 'function') {
      this.#formatNumber = refs.formatNumber;
    }
    // The imminent first render paints exactly these refs.
    this.#applied = this.#store(refs);
  }

  /**
   * Declares the external stylesheet attached by the base class before the
   * first contentful render (preload-and-cache contract of the kit).
   * @returns {string} Absolute stylesheet URL.
   */
  stylesheetHref() {
    return STYLE_URL;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this.#onDocumentClick);
    document.addEventListener('keydown', this.#onDocumentKeydown);
  }

  disconnectedCallback() {
    document.removeEventListener('click', this.#onDocumentClick);
    document.removeEventListener('keydown', this.#onDocumentKeydown);
    super.disconnectedCallback();
  }

  /**
   * Stores panel data fields, returning the full snapshot. The files ordering
   * is owned by the parent (it survives panel remounts); the select only
   * reports changes through the `files-sort` event.
   * @param {object} data Partial data.
   * @returns {object} Snapshot with signature.
   */
  #store({ activeView, mindmapMode, items, folders, currentId, documentText, settings, activeLine, renameError, sortMode, sync } = {}) {
    if (typeof activeView === 'string') {
      this.#activeView = activeView;
    }
    if (mindmapMode !== undefined) {
      this.#mindmapMode = mindmapMode === true;
    }
    if (Array.isArray(items)) {
      this.#items = items;
    }
    if (folders !== undefined) {
      this.#folders = Array.isArray(folders) ? folders : [];
    }
    if (currentId !== undefined) {
      this.#currentId = currentId;
    }
    if (typeof documentText === 'string') {
      this.#documentText = documentText;
    }
    if (settings !== undefined) {
      this.#settings = settings;
    }
    if (renameError !== undefined) {
      this.#renameError = renameError;
    }
    if (activeLine !== undefined) {
      this.#activeLine = activeLine;
    }
    if (FILES_SORT_MODES.includes(sortMode)) {
      this.#filesSort = sortMode;
    }
    if (sync !== undefined) {
      this.#sync = sync;
    }
    return {
      activeView: this.#activeView,
      mindmapMode: this.#mindmapMode,
      items: this.#items,
      folders: this.#folders,
      currentId: this.#currentId,
      documentText: this.#documentText,
      settings: this.#settings,
      activeLine: this.#activeLine,
      openFileMenu: this.#openFileMenu,
      moveMenuId: this.#moveMenuId,
      sortMenuOpen: this.#sortMenuOpen,
      editingId: this.#editingId,
      renameError: this.#renameError,
      filesSort: this.#filesSort,
      sync: this.#sync,
      collapsed: [...this.#collapsedLines].sort((left, right) => left - right).join(','),
      signature: outlineSignature(this.#documentText),
    };
  }

  /**
   * Closes the file menu and forwards the chosen action to the parent.
   * @param {string} type Event type to dispatch.
   * @param {Element} menuAction Clicked menu item carrying the document id.
   * @returns {void}
   */
  #emitFileAction(type, menuAction) {
    const id = menuAction.getAttribute('data-file-download')
      ?? menuAction.getAttribute('data-file-download-html')
      ?? menuAction.getAttribute('data-file-properties')
      ?? menuAction.getAttribute('data-file-delete')
      ?? '';
    this.#openFileMenu = null;
    this.requestRender();
    this.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail: { id } }));
  }

  /**
   * Closes an open inline rename editor without saving.
   * @returns {void}
   */
  cancelRename() {
    if (this.#editingId === null && this.#renameError === null) {
      return;
    }
    this.#editingId = null;
    this.#renameError = null;
    this.requestRender();
  }

  /**
   * Opens the inline rename editor on the given row id.
   * @param {string} id Row id (`folder:<id>` for folders).
   * @returns {void}
   */
  beginRename(id) {
    if (typeof id !== 'string' || id.length === 0) {
      return;
    }
    this.#editingId = id;
    this.#renameError = null;
    this.#openFileMenu = null;
    this.requestRender();
  }

  /**
   * Updates panel data, re-rendering only when the visible output would
   * change. Snapshots are compared by identity except the outline signature,
   * so per-keystroke updates from the parent stay cheap and never steal
   * scroll or focus.
   * @param {object} data New data (absent fields keep current values).
   * @param {string} [data.activeView] Active view id.
   * @param {boolean} [data.mindmapMode] Force the filtered mindmap files view.
   * @param {Array<object>} [data.items] Documents for the files view.
   * @param {Array<object>} [data.folders] Folders for the files tree.
   * @param {string|null} [data.currentId] Open document id.
   * @param {string} [data.documentText] Current document text for text views.
   * @param {object|null} [data.settings] Preferences for the settings view.
   * @param {number|null} [data.activeLine] Highlighted outline heading line.
   * @param {string|null} [data.renameError] Translation key for a rename failure.
   * @param {string} [data.sortMode] Files ordering (one of `FILES_SORT_MODES`).
   * @param {object|null} [data.sync] Sync snapshot for the settings view.
   * @returns {void}
   */
  configure({ activeView, mindmapMode, items, folders, currentId, documentText, settings, activeLine, renameError, sortMode, sync } = {}) {
    const next = this.#store({ activeView, mindmapMode, items, folders, currentId, documentText, settings, activeLine, renameError, sortMode, sync });
    const prev = this.#applied;
    // Collapsed lines refer to line numbers, so a changed document (new
    // signature) invalidates them.
    if (prev !== null && prev.signature !== next.signature && this.#collapsedLines.size > 0) {
      this.#collapsedLines.clear();
      next.collapsed = '';
    }
    const same = prev !== null
      && prev.activeView === next.activeView
      && prev.mindmapMode === next.mindmapMode
      && prev.items === next.items
      && prev.folders === next.folders
      && prev.currentId === next.currentId
      && prev.settings === next.settings
      && prev.activeLine === next.activeLine
      && prev.openFileMenu === next.openFileMenu
      && prev.moveMenuId === next.moveMenuId
      && prev.sortMenuOpen === next.sortMenuOpen
      && prev.editingId === next.editingId
      && prev.renameError === next.renameError
      && prev.filesSort === next.filesSort
      && prev.sync === next.sync
      && prev.collapsed === next.collapsed
      && prev.signature === next.signature;
    if (!same) {
      this.#applied = next;
      this.requestRender();
    }
  }

  eventTypes() {
    return ['click', 'change', 'keydown'];
  }

  handleEvent(event) {
    if (event.type === 'keydown') {
      const input = event.target?.closest?.('[data-rename-input]');
      if (input && event.key === 'Enter') {
        this.dispatchEvent(
          new CustomEvent('document-rename', {
            bubbles: true,
            composed: true,
            detail: { id: input.getAttribute('data-rename-input'), title: input.value },
          }),
        );
      } else if (input && event.key === 'Escape') {
        this.#editingId = null;
        this.#renameError = null;
        this.requestRender();
      }
      return;
    }
    if (event.type === 'change') {
      const input = event.target?.closest?.('input[data-setting]');
      const key = input?.getAttribute('data-setting') ?? '';
      const value = input?.value ?? '';
      if (key.length > 0 && value.length > 0) {
        this.dispatchEvent(
          new CustomEvent('settings-change', {
            bubbles: true,
            composed: true,
            detail: { key, value },
          }),
        );
      }
      return;
    }
    const stepButton = event.target?.closest?.('[data-setting-step]');
    if (stepButton) {
      const key = stepButton.getAttribute('data-setting-key') ?? '';
      const delta = Number(stepButton.getAttribute('data-setting-step'));
      if (key.length > 0 && Number.isFinite(delta)) {
        this.dispatchEvent(
          new CustomEvent('settings-step', {
            bubbles: true,
            composed: true,
            detail: { key, delta },
          }),
        );
      }
      return;
    }
    const closeButton = event.target?.closest?.('[part="side-close"]');
    if (closeButton) {
      this.dispatchEvent(new CustomEvent('side-close', { bubbles: true, composed: true }));
      return;
    }
    const syncSave = event.target?.closest?.('[data-sync-save]');
    if (syncSave) {
      const fields = [...(this.shadowRoot?.querySelectorAll('[data-sync-field]') ?? [])];
      const values = {};
      for (const field of fields) {
        values[field.getAttribute('data-sync-field')] = field.value ?? '';
      }
      const invalid = fields.find((field) => typeof field.reportValidity === 'function' && !field.checkValidity());
      if (invalid) {
        invalid.reportValidity();
        return;
      }
      this.dispatchEvent(
        new CustomEvent('sync-configure', {
          bubbles: true,
          composed: true,
          detail: { repo: values.repo ?? '', branch: values.branch || 'main', token: values.token ?? '' },
        }),
      );
      return;
    }
    const ignoreSave = event.target?.closest?.('[data-sync-ignore-save]');
    if (ignoreSave) {
      const area = this.shadowRoot?.querySelector('[data-sync-field="ignore"]');
      const patterns = String(area?.value ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));
      this.dispatchEvent(
        new CustomEvent('sync-ignore-save', {
          bubbles: true,
          composed: true,
          detail: { patterns },
        }),
      );
      return;
    }
    const syncRemove = event.target?.closest?.('[data-sync-remove]');
    if (syncRemove) {
      this.dispatchEvent(new CustomEvent('sync-remove', { bubbles: true, composed: true, detail: {} }));
      return;
    }
    const syncNow = event.target?.closest?.('[data-sync-now]');
    if (syncNow) {
      this.dispatchEvent(new CustomEvent('sync-now', { bubbles: true, composed: true, detail: {} }));
      return;
    }
    const outlineButton = event.target?.closest?.('[data-line]');
    if (outlineButton) {
      this.dispatchEvent(
        new CustomEvent('outline-jump', {
          bubbles: true,
          composed: true,
          detail: { line: Number(outlineButton.getAttribute('data-line')) },
        }),
      );
      return;
    }
    const outlineToggle = event.target?.closest?.('[data-outline-toggle]');
    if (outlineToggle) {
      const line = Number(outlineToggle.getAttribute('data-outline-toggle'));
      if (Number.isInteger(line)) {
        if (this.#collapsedLines.has(line)) {
          this.#collapsedLines.delete(line);
        } else {
          this.#collapsedLines.add(line);
        }
        this.requestRender();
      }
      return;
    }
    const openButton = event.target?.closest?.('[data-doc-id]');
    if (openButton) {
      this.dispatchEvent(
        new CustomEvent('document-open', {
          bubbles: true,
          composed: true,
          detail: { id: openButton.getAttribute('data-doc-id') },
        }),
      );
      return;
    }
    const folderToggle = event.target?.closest?.('[data-folder-toggle]');
    if (folderToggle) {
      const key = folderToggle.getAttribute('data-folder-toggle') ?? '';
      if (this.#folderCollapsed.has(key)) {
        this.#folderCollapsed.delete(key);
      } else {
        this.#folderCollapsed.add(key);
      }
      this.requestRender();
      return;
    }
    const moveToggle = event.target?.closest?.('[data-move-toggle]');
    if (moveToggle) {
      const id = moveToggle.getAttribute('data-move-toggle') ?? '';
      this.#moveMenuId = this.#moveMenuId === id ? null : id;
      this.requestRender();
      return;
    }
    const moveOption = event.target?.closest?.('[data-move-to]');
    if (moveOption) {
      const [id, folderId] = (moveOption.getAttribute('data-move-to') ?? '|').split('|');
      this.#moveMenuId = null;
      this.#openFileMenu = null;
      this.requestRender();
      this.dispatchEvent(
        new CustomEvent('document-move', {
          bubbles: true,
          composed: true,
          detail: { id, folderId: folderId.length > 0 ? folderId : null },
        }),
      );
      return;
    }
    if (event.target?.closest?.('[part="docs-new"]')) {
      this.dispatchEvent(new CustomEvent('document-create', { bubbles: true, composed: true }));
      return;
    }
    if (event.target?.closest?.('[part="docs-folder-new"]')) {
      this.dispatchEvent(new CustomEvent('folder-create', { bubbles: true, composed: true }));
      return;
    }
    if (event.target?.closest?.('[part="docs-import"]')) {
      this.dispatchEvent(new CustomEvent('document-import', { bubbles: true, composed: true }));
      return;
    }
    if (event.target?.closest?.('[data-mindmap-new]')) {
      this.dispatchEvent(new CustomEvent('document-create-mindmap', { bubbles: true, composed: true }));
      return;
    }
    const menuButton = event.target?.closest?.('[data-doc-menu]');
    if (menuButton) {
      const id = menuButton.getAttribute('data-doc-menu');
      this.#openFileMenu = this.#openFileMenu === id ? null : id;
      this.requestRender();
      return;
    }
    const sortButton = event.target?.closest?.('[data-doc-sort]');
    if (sortButton) {
      this.#sortMenuOpen = !this.#sortMenuOpen;
      this.requestRender();
      return;
    }
    const sortOption = event.target?.closest?.('[data-files-sort]');
    if (sortOption) {
      const mode = sortOption.getAttribute('data-files-sort') ?? '';
      this.#sortMenuOpen = false;
      this.requestRender();
      if (FILES_SORT_MODES.includes(mode)) {
        this.dispatchEvent(
          new CustomEvent('files-sort', {
            bubbles: true,
            composed: true,
            detail: { mode },
          }),
        );
      }
      return;
    }
    const menuAction = event.target?.closest?.('[data-file-rename],[data-file-download],[data-file-download-html],[data-file-properties],[data-file-delete],[data-folder-rename],[data-folder-new-doc],[data-folder-delete]');
    if (menuAction) {
      const renameId = menuAction.getAttribute('data-file-rename');
      if (renameId !== null) {
        this.#editingId = renameId;
        this.#renameError = null;
        this.#openFileMenu = null;
        this.requestRender();
        return;
      }
      const folderRenameId = menuAction.getAttribute('data-folder-rename');
      if (folderRenameId !== null) {
        this.#editingId = `folder:${folderRenameId}`;
        this.#renameError = null;
        this.#openFileMenu = null;
        this.requestRender();
        return;
      }
      const folderNewDocId = menuAction.getAttribute('data-folder-new-doc');
      if (folderNewDocId !== null) {
        const folderId = folderNewDocId;
        this.#openFileMenu = null;
        this.requestRender();
        this.dispatchEvent(
          new CustomEvent('folder-create-document', {
            bubbles: true,
            composed: true,
            detail: { folderId },
          }),
        );
        return;
      }
      const folderDeleteId = menuAction.getAttribute('data-folder-delete');
      if (folderDeleteId !== null) {
        const folderId = folderDeleteId;
        this.#openFileMenu = null;
        this.requestRender();
        this.dispatchEvent(
          new CustomEvent('folder-delete', {
            bubbles: true,
            composed: true,
            detail: { id: folderId },
          }),
        );
        return;
      }
      if (menuAction.hasAttribute('data-file-download')) {
        this.#emitFileAction('document-download', menuAction);
        return;
      }
      if (menuAction.hasAttribute('data-file-download-html')) {
        this.#emitFileAction('document-download-html', menuAction);
        return;
      }
      if (menuAction.hasAttribute('data-file-properties')) {
        this.#emitFileAction('document-properties', menuAction);
        return;
      }
      this.#emitFileAction('document-delete', menuAction);
    }
  }

  render() {
    const view = getView(this.#activeView) ?? getView(FILES_VIEW);
    const titleKey = this.#mindmapMode ? 'parsinegar.views.mindmap' : view.labelKey;
    const ordered = sortDocuments(this.#items, this.#filesSort);
    // Like the outline (which reads live text, not stored content), the
    // filter judges the open document by its current text: a fresh map
    // template lives in the draft before its first save.
    const liveItems = (this.#items ?? []).map((item) => (
      item && item.id === this.#currentId && typeof this.#documentText === 'string'
        ? { ...item, content: this.#documentText }
        : item
    ));
    const scope = this.#mindmapMode ? filterMindmapTree(sortDocuments(liveItems, this.#filesSort), this.#folders) : null;
    const body = this.#mindmapMode
      ? renderFilesView({ t: this.#t, items: scope.items, folders: scope.folders, currentId: this.#currentId, openMenuId: this.#openFileMenu, moveMenuId: this.#moveMenuId, sortMenuOpen: this.#sortMenuOpen, editing: this.#editingId === null ? null : { id: this.#editingId, error: this.#renameError }, assetBaseUrl: this.#assetBaseUrl, sortMode: this.#filesSort, folderCollapsed: [...this.#folderCollapsed], mindmap: true })
      : view.render({ t: this.#t, items: ordered, folders: this.#folders, currentId: this.#currentId, documentText: this.#documentText, settings: this.#settings, activeLine: this.#activeLine, collapsed: [...this.#collapsedLines], openMenuId: this.#openFileMenu, moveMenuId: this.#moveMenuId, sortMenuOpen: this.#sortMenuOpen, editing: this.#editingId === null ? null : { id: this.#editingId, error: this.#renameError }, formatNumber: this.#formatNumber ?? String, assetBaseUrl: this.#assetBaseUrl, sortMode: this.#filesSort, folderCollapsed: [...this.#folderCollapsed], sync: this.#sync });
    return `
      <aside part="side">
        <div part="side-header">
          <h2 part="side-title">${escapeHtml(this.#t(titleKey))}</h2>
          <button type="button" part="side-close" aria-label="${escapeHtml(this.#t('parsinegar.views.close'))}">×</button>
        </div>
        <div part="side-body" data-pey-preserve="side-body" data-pey-preserve-state="scroll">${body}</div>
      </aside>`;
  }
}

customElements.define(TAG, ParsiSidePanel);

export { ParsiSidePanel, TAG };
