// Home page: workbench shell owning menus, rail, side panel and status as
// child elements plus the CodeMirror editor. Regions mount through the shared
// mount helper after render; children talk back only through bubbled
// CustomEvents. The editor itself stays helper-mounted (third-party widget).
// All DOM event handling stays declarative on PeyElement.
import { PeyElement } from 'pey.webui/base/pey-element';
import { createMarkdownView } from '../../components/editor/markdown-view.js';
import SAMPLE_DOCUMENT from '../../sample-document.js';
import { countStats } from '../../components/workbench/stats.js';
import { ABOUT_VIEW, FILES_VIEW, MINDMAP_VIEW, getView, listViews } from '../../components/workbench/views.js';
import { DEFAULT_FILES_SORT, FILES_SORT_MODES } from '../../components/workbench/views-files.js';
import { formatDate, formatNumber } from '../../utils/format.js';
import { escapeHtml, iconMarkup } from '../../components/workbench/html.js';
import { mountComponent, scheduleAttachments } from '../../utils/mount.js';
import { createDocumentController, deriveImportTitle } from './document-controller.js';
import { createMindmapHost } from './mindmap-host.js';
import { createBuiltinDocs } from './builtin-docs.js';
import { createSettingsApplier } from './settings-applier.js';
import { createSyncController } from './sync-controller.js';
import { createExportFlow } from './export-flow.js';
import { createDiskImport } from './disk-import.js';
import { createScrollSpy } from './scroll-spy.js';
import '../../components/menu-bar/menu-bar.js';
import '../../components/activity-rail/activity-rail.js';
import '../../components/side-panel/side-panel.js';
import '../../components/status-bar/status-bar.js';
import '../../components/modal-dialog/modal-dialog.js';

const TAG = 'parsi-page-home';
const CHANGE_EVENT = 'parsi-page-home:changed';
const DOCUMENTS_SERVICE = 'parsinegar.documents.service';
const SETTINGS_SERVICE = 'parsinegar.settings.service';
const EXPORT_SERVICE = 'parsinegar.export.service';
const FILESYSTEM_SERVICE = 'pey.filesystem.service';
const SYNC_SERVICE = 'pey.sync.service';
const SYNC_METHODS = ['configureBackend', 'removeBackend', 'getStatus', 'syncNow', 'resolveConflict'];
// Side-panel ids for folders: documents keep raw ids, folders travel
// prefixed so rename/delete/move route to the folder flows.
const FOLDER_ID_PREFIX = 'folder:';
// Draft the «سند تازه» button plants beside the map: a starter list so the
// new document opens as a real map, not an empty picker.
const MINDMAP_TEMPLATE = '- ایدهٔ اصلی\n  - شاخهٔ یک\n  - شاخهٔ دو';
// The filesystem methods this page relies on (folder picking and reading
// for import; writing lives behind explicit download, never the service).
const FILESYSTEM_METHODS = ['pickDirectory', 'listDirectory', 'collectEntries', 'readEntry'];
const INSERT_ACTION_PREFIX = 'insert-';
const INSERT_MARK_KINDS = [
  'heading',
  'bold',
  'italic',
  'strikethrough',
  'quote',
  'link',
  'code',
  'unordered-list',
  'ordered-list',
  'task-list',
  'highlight',
  'image',
  'horizontal-rule',
  'table',
  'admonition-warning',
  'admonition-caution',
  'admonition-important',
  'admonition-tip',
  'admonition-note',
  'poem',
  'code-block',
];
const STYLE_URL = new URL('./home.css', import.meta.url).href;

class ParsiPageHome extends PeyElement {
  #t = (key) => key;
  #format = null;
  #assetBaseUrl = null;
  #docs = null;
  #prefs = null;
  #spy = createScrollSpy({
    getVisibleLine: (top) => this.#editor?.visibleLine(top) ?? null,
    getText: () => this.value,
    onActiveLine: (line) => this.#sideEl?.configure({ activeLine: line }),
    isLive: () => this.isConnected,
  });
  #editor = null;
  #centerMode = 'editor';
  #mind = null;
  #mindmapHost = null;
  #mindmapReturnLine = 1;
  #pendingGotoLine = null;
  #pendingBuiltin = null;
  #activeView = FILES_VIEW;
  #sideOpen = true;
  #filesSort = DEFAULT_FILES_SORT;
  #folderCollapsed = new Set();
  #bottomOpen = true;
  #fullscreen = false;
  #renderObserver = null;
  #editorHost = null;
  #menuEl = null;
  #searchOpen = false;
  #exporter = null;
  #downloads = null;
  #documentsService = null;
  #syncer = null;
  #sync = null;
  #searchSpec = null;
  #builtIn = null;
  #guides = null;
  #filesystem = null;
  #disk = null;
  #railEl = null;
  #sideEl = null;
  #statusEl = null;
  #modalEl = null;
  #events = null;

  onConnect(refs = {}) {
    if (typeof refs.t === 'function') {
      this.#t = refs.t;
    }
    if (typeof refs.format === 'function') {
      this.#format = refs.format;
    }
    // Note: refs.direction (app-chrome direction) is intentionally ignored;
    // the shell owns it and the edited document follows stored settings.
    if (typeof refs.assetBaseUrl === 'string' && refs.assetBaseUrl.length > 0) {
      this.#assetBaseUrl = refs.assetBaseUrl;
    }
    // Scoped Event Bus facade for connecting child elements (decisions §11).
    // Absent in older callers — composition then degrades, editing never breaks.
    if (
      refs.events
      && typeof refs.events.subscribe === 'function'
      && typeof refs.events.publish === 'function'
    ) {
      this.#events = refs.events;
    }
    const service = refs.services?.[DOCUMENTS_SERVICE] ?? null;
    const documents = service && typeof service.listDocuments === 'function' ? service : null;
    this.#documentsService = documents && typeof documents.listFolders === 'function' ? documents : null;
    // Raw values (not wrappers): the controller guards absent services and
    // formatters itself, and reconnect re-passes them without losing state.
    const docRefs = { documents, t: this.#t, format: this.#format };
    if (!this.#docs) {
      this.#docs = createDocumentController({
        ...docRefs,
        isLive: () => this.isConnected,
        readEditorContent: () => this.#editor?.getValue(),
        onSaved: () => void this.#sync?.updateDirty(),
      });
    } else {
      this.#docs.reconnect(docRefs);
    }
    const settings = refs.services?.[SETTINGS_SERVICE] ?? null;
    const settingsApi = settings && typeof settings.getSettings === 'function' && typeof settings.saveSettings === 'function'
      ? settings
      : null;
    if (!this.#prefs) {
      this.#prefs = createSettingsApplier({ settingsApi, isLive: () => this.isConnected });
    } else {
      this.#prefs.reconnect({ settingsApi });
    }
    const exporter = refs.services?.[EXPORT_SERVICE] ?? null;
    this.#exporter = exporter && typeof exporter.exportHtml === 'function'
      ? exporter
      : null;
    if (!this.#downloads) {
      this.#downloads = createExportFlow({
        getDocs: () => this.#docs,
        getExporter: () => this.#exporter,
        getSettings: () => this.#prefs,
        getShadowRoot: () => this.shadowRoot,
        isConnected: () => this.isConnected,
      });
    }
    const syncer = refs.services?.[SYNC_SERVICE] ?? null;
    this.#syncer = syncer && SYNC_METHODS.every((method) => typeof syncer[method] === 'function')
      ? syncer
      : null;
    if (!this.#sync) {
      this.#sync = createSyncController({
        getSyncer: () => this.#syncer,
        getSettings: () => this.#prefs,
        formatDate: (value) => this.#formatDate(value),
        translate: (key) => this.#t(key),
        isConnected: () => this.isConnected,
        flushDraft: async () => {
          await this.#docs?.flushSave();
        },
        onSettled: async () => {
          await this.#reloadLibrary();
        },
        onChromeChanged: ({ dot, hint }) => {
          this.#railEl?.configure({ syncDot: dot, syncHint: hint });
        },
        onPanelChanged: ({ snapshot }) => {
          this.#sideEl?.configure({ sync: snapshot });
        },
        onModalChanged: () => {
          this.#modalEl?.configure({ modal: this.#docs?.getModal() ?? this.#sync?.conflictModal() ?? this.#sync?.messageModal() ?? null });
        },
      });
    }
    const filesystem = refs.services?.[FILESYSTEM_SERVICE] ?? null;
    this.#filesystem = filesystem && FILESYSTEM_METHODS.every((method) => typeof filesystem[method] === 'function')
      ? filesystem
      : null;
    if (!this.#disk) {
      this.#disk = createDiskImport({
        getFilesystem: () => this.#filesystem,
        getDocs: () => this.#docs,
        getShadowRoot: () => this.shadowRoot,
        isConnected: () => this.isConnected,
        applyResult: (result) => this.#applyResult(result),
      });
    }
    if (!this.#guides) {
      this.#guides = createBuiltinDocs({ t: this.#t, isLive: () => this.isConnected });
    }
  }

  eventTypes() {
    return [
      'click',
      'keydown',
      'menu-action',
      'view-select',
      'about-open',
      'side-close',
      'outline-jump',
      'document-open',
      'document-create',
      'document-import',
      'document-delete',
      'document-rename',
      'document-move',
      'folder-create',
      'folder-create-document',
      'folder-delete',
      'folder-toggle',
      'document-download',
      'document-download-html',
      'document-properties',
      'modal-confirm',
      'modal-dismiss',
      'files-sort',
      'settings-change',
      'settings-step',
      'search-query',
      'search-next',
      'search-previous',
      'search-replace-one',
      'search-replace-all',
      'search-close',
      'sync-configure',
      'sync-remove',
      'sync-now',
      'sync-auto-commit',
      'sync-message-send',
      'sync-ignore-save',
      'sync-resolve',
      'sync-later',
      'help-open-full',
    ];
  }

  /**
   * Declares the external stylesheet attached by the base class before the
   * first contentful render (preload-and-cache contract of the kit).
   * @returns {string} Absolute stylesheet URL.
   */
  stylesheetHref() {
    return STYLE_URL;
  }

  handleEvent(event) {
    if (event.type === 'keydown') {
      // Layout-independent (physical KeyF): Ctrl+H stays the heading toggle,
      // so replace-focus takes Ctrl+Shift+F instead. The browser find is
      // only claimed when a document is actually open to search.
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.code === 'KeyF') {
        if (this.#openSearch(event.shiftKey ? 'replace' : 'query')) {
          event.preventDefault();
        }
        return;
      }
      if (event.key === 'Escape' && this.#docs) {
        const { confirmDeleteId, confirmFolderDeleteId, propsRecord } = this.#docs.getState();
        if (confirmDeleteId !== null || confirmFolderDeleteId !== null || propsRecord !== null) {
          this.#docs.cancelOverlays();
          this.#requestEditor();
        }
      }
      return;
    }
    if (event.type !== 'click') {
      const action = event.detail?.action;
      if (event.type === 'menu-action' && typeof action === 'string') {
        void this.#runMenuAction(action);
        return;
      }
      if (event.type === 'search-close') {
        this.#clearSearch();
        return;
      }
      if (event.type === 'search-query'
        || event.type === 'search-next'
        || event.type === 'search-previous'
        || event.type === 'search-replace-one'
        || event.type === 'search-replace-all') {
        this.#runSearch(event.type, event.detail);
        return;
      }
      if (event.type === 'view-select' && typeof event.detail?.id === 'string') {
        this.#switchView(event.detail.id);
        return;
      }
      if (event.type === 'about-open') {
        this.#switchView(ABOUT_VIEW);
        return;
      }
      if (event.type === 'files-sort' && FILES_SORT_MODES.includes(event.detail?.mode)) {
        if (event.detail.mode !== this.#filesSort) {
          this.#filesSort = event.detail.mode;
          this.#requestEditor();
          void this.#prefs?.saveFilesSort(event.detail.mode);
        }
        return;
      }
      if (event.type === 'side-close') {
        this.#sideOpen = false;
        this.#requestEditor();
        return;
      }
      if (event.type === 'outline-jump') {
        this.#editor?.gotoLine(Number(event.detail?.line));
        return;
      }
      if (event.type === 'document-open' && typeof event.detail?.id === 'string') {
        void this.#switchDocument(event.detail.id);
        return;
      }
      if (event.type === 'document-create') {
        void this.#createDocument(this.#centerMode === 'mindmap' ? MINDMAP_TEMPLATE : null);
        return;
      }
      if (event.type === 'folder-create') {
        void this.#createFolder();
        return;
      }
      if (event.type === 'document-import') {
        void this.#importDocument();
        return;
      }
      if (event.type === 'document-delete') {
        if (this.#docs?.armDelete(event.detail?.id)) {
          this.#requestEditor();
        }
        return;
      }
      if (event.type === 'document-rename') {
        void this.#renameDocument(event.detail?.id, event.detail?.title);
        return;
      }
      if (event.type === 'document-move' && typeof event.detail?.id === 'string') {
        void this.#moveDocument(event.detail.id, event.detail?.folderId ?? null);
        return;
      }
      if (event.type === 'folder-create-document') {
        void this.#createDocumentInFolder(event.detail?.folderId ?? null, this.#centerMode === 'mindmap' ? MINDMAP_TEMPLATE : null);
        return;
      }
      if (event.type === 'folder-delete' && typeof event.detail?.id === 'string') {
        if (this.#docs?.armFolderDelete(event.detail.id)) {
          this.#requestEditor();
        }
        return;
      }
      if (event.type === 'folder-toggle' && typeof event.detail?.id === 'string') {
        // Collapse state is ours (the panel remounts with every page
        // render): toggling reports up, the page owns and re-sends it.
        const id = event.detail.id;
        if (this.#folderCollapsed.has(id)) {
          this.#folderCollapsed.delete(id);
        } else {
          this.#folderCollapsed.add(id);
        }
        this.#requestEditor();
        return;
      }
      if (event.type === 'document-download') {
        void this.#downloads?.downloadDocument(event.detail?.id);
        return;
      }
      if (event.type === 'document-download-html') {
        void this.#downloads?.downloadHtmlDocument(event.detail?.id);
        return;
      }
      if (event.type === 'document-properties' && typeof event.detail?.id === 'string') {
        void this.#showProperties(event.detail.id);
        return;
      }
      if (event.type === 'modal-confirm') {
        if (event.detail?.accepted === true) {
          void this.#confirmDeleteAndApply();
        } else {
          this.#docs?.cancelOverlays();
          this.#requestEditor();
        }
        return;
      }
      if (event.type === 'modal-dismiss') {
        if (this.#sync?.messageOpen()) {
          this.#sync.dismissMessage();
          this.#modalEl?.configure({ modal: this.#docs?.getModal() ?? null });
          return;
        }
        this.#docs?.cancelOverlays();
        this.#requestEditor();
        return;
      }
      if (event.type === 'settings-change') {
        void this.#applySettingChange(event.detail?.key, event.detail?.value);
        return;
      }
      if (event.type === 'settings-step') {
        void this.#applySettingStep(event.detail?.key, event.detail?.delta);
        return;
      }
      if (event.type === 'sync-configure') {
        void this.#sync?.configureBackend(event.detail);
        return;
      }
      if (event.type === 'sync-remove') {
        void this.#sync?.removeBackend();
        return;
      }
      if (event.type === 'sync-now') {
        this.#sync?.beginNow();
        return;
      }
      if (event.type === 'sync-auto-commit') {
        void this.#sync?.saveCommitAuto(event.detail?.enabled);
        return;
      }
      if (event.type === 'sync-message-send') {
        this.#sync?.sendMessage(event.detail?.message);
        return;
      }
      if (event.type === 'sync-ignore-save') {
        void this.#sync?.saveIgnore(event.detail?.patterns);
        return;
      }
      if (event.type === 'sync-resolve') {
        void this.#sync?.resolveConflict(event.detail);
        return;
      }
      if (event.type === 'sync-later') {
        this.#modalEl?.configure({ modal: this.#docs?.getModal() ?? null });
        void this.#sync?.later();
        return;
      }
      if (event.type === 'help-open-full') {
        void this.#openBuiltin('help');
        return;
      }
    }
    const target = event.target;
    if (target?.closest?.('[data-fullscreen-exit]')) {
      this.#setFullscreen(false);
      return;
    }
    if (target?.closest?.('[part="editor-host"]')) {
      // In-place editing owns its own focus (table cells): stealing it to
      // the CodeMirror view would blur the cell mid-gesture and make
      // rendered editing impossible.
      if (target?.closest?.('[contenteditable="true"]')) {
        return;
      }
      this.#editor?.focus();
      return;
    }
  }

  connectedCallback() {
    super.connectedCallback();
    // The base class flushes render() on its own schedule — synchronously for
    // plain templates, asynchronously when gated on the external stylesheet.
    // Mounting CodeMirror needs the live host node, so instead of guessing
    // microtask order, observe render completion and mount then.
    this.#ensureRenderObserver();
    this.#prefs?.watchColorScheme(() => this.#requestEditor());
    queueMicrotask(() => void this.#initialLoad());
  }

  disconnectedCallback() {
    this.#docs?.dispose();
    this.#unmountEditor();
    this.#unmountMindmap();
    this.#prefs?.unwatchColorScheme();
    this.#spy.unwatch();
    this.#renderObserver?.disconnect();
    this.#renderObserver = null;
    super.disconnectedCallback();
  }

  /**
   * Arms one-purpose observers that mount the center content as soon as a
   * render produces its host node. Tracks host node identity (not just
   * presence) because a full re-render detaches the previous view while
   * the reference stays set. Stays armed across re-renders; the mounted
   * views' own DOM lives inside their host nodes, so they never retrigger
   * themselves.
   * @returns {void}
   */
  #ensureRenderObserver() {
    if (this.#renderObserver) {
      return;
    }
    this.#renderObserver = new MutationObserver(() => {
      if (!this.isConnected) {
        return;
      }
      const center = this.shadowRoot.querySelector('[part="center"]');
      if (center) {
        this.#spy.watch(center);
      }
      const mindHost = this.shadowRoot.querySelector('[part="mindmap-host"]');
      if (!mindHost) {
        this.#unmountMindmap();
      } else if (this.#mindmapHost !== mindHost) {
        this.#unmountMindmap();
        this.#mindmapHost = mindHost;
        void this.#mountMindmap();
      }
      const host = this.shadowRoot.querySelector('[part="editor-host"]');
      if (!host) {
        return;
      }
      if (this.#editorHost !== host) {
        this.#unmountEditor();
        this.#editorHost = host;
        this.#mountEditor();
      }
    });
    this.#renderObserver.observe(this.shadowRoot, { childList: true, subtree: false });
  }

  /**
   * Resolves the editor color scheme from the stored theme.
   * @returns {string} 'dark', 'sepia' or 'light'.
   */
  #resolveColorScheme() {
    const { settings } = this.#prefs?.getState() ?? {};
    if (settings?.theme === 'dark') {
      return 'dark';
    }
    if (settings?.theme === 'sepia') {
      return 'sepia';
    }
    if (settings?.theme === 'device') {
      try {
        if (typeof globalThis.matchMedia === 'function'
          && globalThis.matchMedia('(prefers-color-scheme: dark)').matches) {
          return 'dark';
        }
      } catch {
        // Media query unavailable — fall through to light.
      }
    }
    return 'light';
  }

  /**
   * Returns the current Markdown text.
   * @returns {string} Current document content.
   */
  get value() {
    return this.#editor?.getValue() ?? this.#docs?.getDraft() ?? SAMPLE_DOCUMENT;
  }

  /**
   * Replaces the editor content and schedules a save.
   * @param {string} text New Markdown text.
   * @returns {void}
   */
  setDocument(text) {
    if (typeof text !== 'string') {
      return;
    }
    this.#docs?.setDraft(text);
    this.#editor?.setDocument(text);
    this.#docs?.scheduleSave();
  }

  async #runMenuAction(action) {
    try {
      switch (action) {
        case 'new-document':
          await this.#createDocument();
          return;
        case 'new-folder':
          await this.#createFolder();
          return;
        case 'import-document':
          await this.#importDocument();
          return;
        case 'open-folder':
          await this.#disk?.openDiskFolder();
          return;
        case 'about':
          this.#switchView(ABOUT_VIEW);
          return;
        case 'open-help':
          await this.#openBuiltin('help');
          return;
        case 'back-to-documents':
          this.#closeBuiltin();
          return;
        case 'toggle-lock':
          await this.#toggleLock();
          return;
        case 'download-markdown': {
          if (!this.#builtIn) {
            const { currentId = null } = this.#docs?.getState() ?? {};
            if (currentId) {
              await this.#downloads?.downloadDocument(currentId);
            }
          }
          return;
        }
        case 'download-html': {
          if (!this.#builtIn) {
            const { currentId = null } = this.#docs?.getState() ?? {};
            if (currentId) {
              await this.#downloads?.downloadHtmlDocument(currentId);
            }
          }
          return;
        }
        case 'download-zip': {
          if (!this.#builtIn) {
            await this.#downloads?.downloadZipLibrary();
          }
          return;
        }
        case 'read-mode':
          await this.#setLockState(true);
          return;
        case 'write-mode':
          await this.#setLockState(false);
          return;
        case 'delete-document':
          if (this.#docs?.armDelete()) {
            this.#requestEditor();
          }
          return;
        case 'undo':
          this.#editor?.undo();
          return;
        case 'redo':
          this.#editor?.redo();
          return;
        case 'toggle-side':
          this.#sideOpen = !this.#sideOpen;
          this.#requestEditor();
          return;
        case 'toggle-fullscreen':
          this.#setFullscreen(!this.#fullscreen);
          return;
        case 'toggle-status':
          this.#bottomOpen = !this.#bottomOpen;
          this.#requestEditor();
          return;
        default:
          if (typeof action === 'string' && action.startsWith(INSERT_ACTION_PREFIX)) {
            const kind = action.slice(INSERT_ACTION_PREFIX.length);
            if (INSERT_MARK_KINDS.includes(kind)) {
              this.#editor?.insertMark(kind);
              this.#editor?.focus();
            }
          }
          return;
      }
    } catch (error) {
      console.error('[parsi-page-home] menu action failed');
    }
  }

  /**
   * Opens the search dropdown and focuses a form field. No-op without an
   * open document, a mounted editor, or outside fullscreen mode (the form
   * would hide with the chrome).
   * @param {string} focus 'replace' focuses the replacement input, anything
   *   else the query input.
   * @returns {boolean} True when the dropdown was opened.
   */
  #openSearch(focus) {
    const { currentId = null } = this.#docs?.getState() ?? {};
    if (currentId === null || !this.#editor || this.#fullscreen) {
      return false;
    }
    this.#searchOpen = true;
    this.#menuEl?.configure({ searchOpen: true, searchFocus: focus === 'replace' ? 'replace' : 'query' });
    return true;
  }

  /**
   * Sanitizes a search event detail into a form spec.
   * @param {object} detail Event detail from the menubar.
   * @returns {object} `{ query, replace, caseSensitive, wholeWord, regexp, inSelection }`.
   */
  #searchSpecFrom(detail) {
    const source = detail !== null && typeof detail === 'object' ? detail : {};
    return {
      query: typeof source.query === 'string' ? source.query : '',
      replace: typeof source.replace === 'string' ? source.replace : '',
      caseSensitive: source.caseSensitive === true,
      wholeWord: source.wholeWord === true,
      regexp: source.regexp === true,
      inSelection: source.inSelection === true,
    };
  }

  /**
   * Runs one search event against the editor and echoes the fresh result
   * back to the menubar form. No-op without a mounted editor.
   * @param {string} kind Search event type.
   * @param {object} detail Event detail with the form spec.
   * @returns {void}
   */
  #runSearch(kind, detail) {
    if (!this.#editor) {
      return;
    }
    const spec = this.#searchSpecFrom(detail);
    this.#searchOpen = true;
    this.#searchSpec = spec;
    let result;
    if (kind === 'search-next') {
      result = this.#editor.searchStep(spec, 1);
    } else if (kind === 'search-previous') {
      result = this.#editor.searchStep(spec, -1);
    } else if (kind === 'search-replace-one') {
      result = this.#editor.searchReplaceOne(spec);
    } else if (kind === 'search-replace-all') {
      result = this.#editor.searchReplaceAll(spec);
    } else {
      result = this.#editor.setSearch(spec);
    }
    this.#menuEl?.configure({
      search: {
        ...spec,
        count: spec.query === '' ? null : { current: result.current, total: result.total },
        invalidRegexp: result.invalidRegexp === true,
        replaced: Number.isInteger(result.replaced) ? result.replaced : null,
      },
    });
  }

  /**
   * Clears the editor highlight and resets the menubar form after an
   * explicit search close.
   * @returns {void}
   */
  #clearSearch() {
    this.#searchOpen = false;
    this.#searchSpec = null;
    this.#editor?.setSearch({ query: '' });
    this.#menuEl?.configure({ searchOpen: false, search: null });
  }

  /**
   * Recounts the live search result after the document changed under an
   * open search (typing, undo, replace). Keeps the counter truthful while
   * the dropdown stays open.
   * @returns {void}
   */
  #recountSearch() {
    if (!this.#searchOpen || !this.#searchSpec || !this.#editor) {
      return;
    }
    const result = this.#editor.setSearch(this.#searchSpec);
    this.#menuEl?.configure({
      search: {
        ...this.#searchSpec,
        count: this.#searchSpec.query === '' ? null : { current: result.current, total: result.total },
        invalidRegexp: result.invalidRegexp === true,
        replaced: null,
      },
    });
  }

  #switchView(id) {
    if (id === MINDMAP_VIEW) {
      // Identical rail law for both center sections: a click shows the
      // section, a click on the active one only toggles the side panel.
      if (this.#activeView === MINDMAP_VIEW) {
        this.#sideOpen = !this.#sideOpen;
      } else {
        this.#enterMindmap();
        return;
      }
    } else {
      const view = getView(id);
      if (!view) {
        return;
      }
      if (id === FILES_VIEW && this.#centerMode === 'mindmap') {
        // Files means the editor, even while the map is on the center.
        this.#exitMindmap();
        this.#sideOpen = true;
      } else if (id === this.#activeView) {
        this.#sideOpen = !this.#sideOpen;
      } else {
        this.#activeView = id;
        this.#sideOpen = true;
      }
    }
    this.#requestEditor();
  }

  /**
   * Enters the mindmap center mode: parks the editor draft and its visible
   * line, then re-renders onto the mindmap host (the observer mounts it).
   * The map owns the rail mark while it is displayed; the picker panel
   * opens beside it. No-op when already there or disconnected.
   * @returns {void}
   */
  #enterMindmap() {
    if (this.#centerMode === 'mindmap' || !this.isConnected) {
      return;
    }
    this.#mindmapReturnLine = this.#editor?.visibleLine?.(0) ?? 1;
    this.#centerMode = 'mindmap';
    this.#activeView = MINDMAP_VIEW;
    this.#sideOpen = true;
    this.#requestEditor();
  }

  /**
   * Returns to the editor center mode, landing on the given line (or the
   * line parked on entry). The pending line is consumed by the fresh mount.
   * The heading mark falls back to files, the editor's rail section.
   * Rendering stays with the caller. No-op outside mindmap mode.
   * @param {number|null} [line] 1-based line to land on.
   * @returns {void}
   */
  #exitMindmap(line = null) {
    if (this.#centerMode !== 'mindmap') {
      return;
    }
    this.#centerMode = 'editor';
    this.#activeView = FILES_VIEW;
    this.#pendingGotoLine = line ?? this.#mindmapReturnLine;
    this.#unmountMindmap();
  }

  render() {
    scheduleAttachments(() => this.#attachChildren());
    return `
      <div part="workbench" data-side="${this.#sideOpen ? 'open' : 'closed'}" data-fullscreen="${this.#fullscreen ? 'on' : 'off'}">
        <div data-slot="menubar"></div>
        <div data-slot="rail"></div>
        ${this.#sideOpen ? '<div data-slot="side"></div>' : ''}
        <div part="center">
          ${this.#centerMode === 'mindmap' ? '<div part="mindmap-host"></div>' : '<div part="editor-host"></div>'}
        </div>
        ${this.#bottomOpen ? '<div data-slot="status"></div>' : ''}
      </div>
      ${this.#fullscreen ? this.#fullscreenExitMarkup() : ''}
      <div data-slot="modal"></div>
    `;
  }

  /**
   * Builds the floating fullscreen-exit button. It lives with the page
   * (not the menubar) because the menubar itself hides in fullscreen mode;
   * it parks at the inline-end top corner, where the toggle sat.
   * @returns {string} Button markup.
   */
  #fullscreenExitMarkup() {
    const label = this.#t('parsinegar.view.exitFullscreen');
    return `<button type="button" part="fullscreen-exit" data-fullscreen-exit aria-label="${escapeHtml(label)}" data-tooltip="${escapeHtml(label)}">${iconMarkup(this.#assetBaseUrl, 'fullscreen-exit')}</button>`;
  }

  /**
   * Flips fullscreen writing mode without a page render: re-rendering
   * would detach the editor host and drop undo history, so only the chrome
   * attribute, the exit button and the menubar snapshot move.
   * @param {boolean} on True enters, false exits.
   * @returns {void}
   */
  #setFullscreen(on) {
    const next = on === true;
    if (this.#fullscreen === next || !this.isConnected) {
      return;
    }
    this.#fullscreen = next;
    if (next && this.#searchOpen) {
      this.#clearSearch();
    }
    this.shadowRoot.querySelector('[part="workbench"]')?.setAttribute('data-fullscreen', next ? 'on' : 'off');
    this.shadowRoot.querySelector('[data-fullscreen-exit]')?.remove();
    if (next) {
      this.shadowRoot.querySelector('[data-slot="modal"]')?.insertAdjacentHTML('beforebegin', this.#fullscreenExitMarkup());
    }
    this.#menuEl?.configure({ fullscreen: next });
  }

  /**
   * Opens the built-in user guide in the mounted
   * editor, locked for reading. The user draft is parked first, so closing
   * returns to it untouched; the built-in never touches the draft, the
   * save timer or the documents service.
   * @param {unknown} id Built-in doc id.
   * @returns {Promise<void>}
   */
  async #openBuiltin(id) {
    if (this.#centerMode === 'mindmap') {
      // Remounts the editor asynchronously; the pending id opens on mount.
      this.#exitMindmap();
      this.#pendingBuiltin = id;
      this.#requestEditor();
      return;
    }
    const opened = await this.#guides?.open(id);
    if (!opened || !this.isConnected || !this.#editor) {
      return;
    }
    this.#docs?.setDraft(this.#editor.getValue());
    this.#builtIn = opened;
    this.#editor.setDocument(opened.content);
    this.#editor.setReadOnly(true);
    this.#refreshChrome();
  }

  /**
   * Returns from a built-in doc to the open user document, restoring its
   * draft content and its stored lock. No-op when no built-in is open.
   * @returns {void}
   */
  #closeBuiltin() {
    if (!this.#builtIn) {
      return;
    }
    this.#builtIn = null;
    if (this.#editor) {
      this.#editor.setDocument(this.#docs?.getDraft() ?? SAMPLE_DOCUMENT);
      this.#editor.setReadOnly(this.#currentLocked());
    }
    this.#refreshChrome();
  }

  /**
   * Reports whether the open user document carries the stored lock.
   * Built-in docs are always locked; they never reach this check.
   * @returns {boolean} True when the current record is locked.
   */
  #currentLocked() {
    const { items = [], currentId = null } = this.#docs?.getState() ?? {};
    return items.some((item) => item.id === currentId && item.readOnly === true);
  }

  /**
   * Toggles the stored lock on the open user document.
   * @returns {Promise<void>}
   */
  async #toggleLock() {
    if (this.#builtIn) {
      return;
    }
    const { currentId = null } = this.#docs?.getState() ?? {};
    if (!currentId) {
      return;
    }
    await this.#setLockState(!this.#currentLocked());
  }

  /**
   * Sets the stored lock on the open user document to an explicit value
   * and applies it to the mounted editor without remounting. No-op for
   * built-ins (always locked) and without a document or service.
   * @param {boolean} locked True locks, false unlocks.
   * @returns {Promise<void>}
   */
  async #setLockState(locked) {
    if (this.#builtIn) {
      return;
    }
    const { currentId = null } = this.#docs?.getState() ?? {};
    if (!currentId) {
      return;
    }
    const updated = await this.#docs?.setLock(currentId, locked === true);
    if (!updated || !this.isConnected) {
      return;
    }
    this.#editor?.setReadOnly(updated.readOnly === true);
    this.#refreshChrome();
  }

  /**
   * Refreshes chrome snapshots (menu capabilities, status bar) without a
   * page render: re-rendering would detach the editor host and force a
   * remount, losing undo history.
   * @returns {void}
   */
  #refreshChrome() {
    const { currentId = null } = this.#docs?.getState() ?? {};
    const locked = this.#builtIn !== null || this.#currentLocked();
    this.#menuEl?.configure({
      hasDocument: currentId !== null,
      readOnly: locked,
      builtInOpen: this.#builtIn !== null,
      fullscreen: this.#fullscreen,
    });
    this.#pushLiveUpdates();
  }

  /**
   * Reloads the library snapshot after external (sync) writes and repoints
   * the editor surgically: no remount, undo preserved unless pulled content
   * actually replaced the open text.
   * @returns {Promise<void>}
   */
  async #reloadLibrary() {
    const service = this.#documentsService;
    if (!service || !this.isConnected) {
      return;
    }
    let items = null;
    let folders = [];
    try {
      items = await service.listDocuments();
      folders = await service.listFolders();
    } catch {
      return;
    }
    if (!Array.isArray(items)) {
      return;
    }
    const { currentId = null } = this.#docs?.getState() ?? {};
    const current = items.find((item) => item?.id === currentId) ?? items[0] ?? null;
    if (!current) {
      const result = await this.#docs?.ensureInitial() ?? { none: true };
      this.#applyResult(result);
      return;
    }
    this.#docs?.adopt(current, items, folders);
    this.#sideEl?.configure({ items, folders, currentId: current.id });
    if (this.#centerMode === 'editor' && !this.#builtIn && this.#editor) {
      const live = this.#editor.getValue();
      if (typeof live === 'string' && live !== (current.content ?? '')) {
        this.#editor.setDocument(current.content ?? '');
        this.#searchOpen = false;
        this.#searchSpec = null;
        this.#menuEl?.configure({ searchOpen: false, search: null });
        this.#pushLiveUpdates();
      }
    }
  }

  /**
   * Mounts region children into their placeholders (or reconfigures the
   * mounted ones). Runs after render lands; skipped entirely without the
   * events facade, in which case only the editor is available.
   * @returns {void}
   */
  #attachChildren() {
    if (!this.isConnected || !this.#events) {
      return;
    }
    const infrastructure = { events: this.#events };
    const { items = [], folders = [], currentId = null } = this.#docs?.getState() ?? {};
    this.#menuEl = mountComponent({
      shadowRoot: this.shadowRoot,
      slot: '[data-slot="menubar"]',
      tag: 'parsi-menu-bar',
      infrastructure,
      refs: {
        t: this.#t,
        hasDocument: currentId !== null,
        formatNumber: (value) => this.#formatNumber(value),
        assetBaseUrl: this.#assetBaseUrl,
      },
        configure: (element) => element.configure({
          hasDocument: currentId !== null,
          readOnly: this.#builtIn !== null || this.#currentLocked(),
          builtInOpen: this.#builtIn !== null,
          fullscreen: this.#fullscreen,
        }),
    });
    this.#railEl = mountComponent({
      shadowRoot: this.shadowRoot,
      slot: '[data-slot="rail"]',
      tag: 'parsi-activity-rail',
      infrastructure,
      refs: {
        t: this.#t,
        assetBaseUrl: this.#assetBaseUrl,
        views: listViews(),
        activeView: this.#activeView,
        syncDot: this.#sync?.dot(),
        syncHint: this.#sync?.hint(),
      },
      configure: (element) => element.configure({ views: listViews(), activeView: this.#activeView, syncDot: this.#sync?.dot(), syncHint: this.#sync?.hint() }),
    });
    if (this.#sideOpen) {
      this.#sideEl = mountComponent({
        shadowRoot: this.shadowRoot,
        slot: '[data-slot="side"]',
        tag: 'parsi-side-panel',
        infrastructure,
        refs: {
          t: this.#t,
          assetBaseUrl: this.#assetBaseUrl,
          activeView: this.#activeView,
          mindmapMode: this.#centerMode === 'mindmap',
          items,
          folders,
          currentId,
          documentText: this.value,
          settings: this.#prefs?.getState().settings ?? null,
          formatNumber: (value) => this.#formatNumber(value),
          sortMode: this.#filesSort,
          folderCollapsed: [...this.#folderCollapsed],
        },
        configure: (element) => element.configure({
          activeView: this.#activeView,
          mindmapMode: this.#centerMode === 'mindmap',
          items,
          folders,
          currentId,
          documentText: this.value,
          settings: this.#prefs?.getState().settings ?? null,
          activeLine: this.#spy.getActiveLine(),
          sortMode: this.#filesSort,
          sync: this.#sync?.snapshot(),
          folderCollapsed: [...this.#folderCollapsed],
        }),
      });
    } else {
      this.#sideEl = null;
    }
    if (this.#bottomOpen) {
      const stats = countStats(this.value);
      this.#statusEl = mountComponent({
        shadowRoot: this.shadowRoot,
        slot: '[data-slot="status"]',
        tag: 'parsi-status-bar',
        infrastructure,
        refs: {
          t: this.#t,
          stats,
          formatNumber: (value) => this.#formatNumber(value),
        },
        configure: (element) => element.configure({
          stats: countStats(this.value),
          formatNumber: (value) => this.#formatNumber(value),
          readOnly: this.#builtIn !== null || this.#currentLocked(),
        }),
      });
    } else {
      this.#statusEl = null;
    }
    this.#modalEl = mountComponent({
      shadowRoot: this.shadowRoot,
      slot: '[data-slot="modal"]',
      tag: 'parsi-modal-dialog',
      infrastructure,
      refs: { t: this.#t, assetBaseUrl: this.#assetBaseUrl },
      configure: (element) => element.configure({ modal: this.#docs?.getModal() ?? this.#sync?.conflictModal() ?? this.#sync?.messageModal() ?? null }),
    });
  }

  async #initialLoad() {
    if (!this.isConnected) {
      return;
    }
    await this.#prefs?.load();
    if (!this.isConnected) {
      return;
    }
    const storedSort = this.#prefs?.getState().settings?.filesSort;
    if (typeof storedSort === 'string' && FILES_SORT_MODES.includes(storedSort)) {
      this.#filesSort = storedSort;
    }
    const result = await this.#docs?.ensureInitial() ?? { none: true };
    if (!this.isConnected) {
      return;
    }
    this.#applyResult(result);
    void this.#sync?.refresh();
  }

  async #switchDocument(id) {
    const result = await this.#docs?.switchDocument(id);
    this.#applyResult(result);
  }

  /**
   * Creates a document and opens it. A template (the map picker passes
   * `MINDMAP_TEMPLATE`) is planted into the fresh draft right after, so
   * list documents are instantly a map.
   * @param {string|null} [template] Seed text to place in the new draft.
   * @returns {Promise<void>}
   */
  async #createDocument(template = null) {
    this.#applyResult(await this.#docs?.createDocument());
    this.#seedDraft(template);
  }

  /**
   * Creates a document inside a folder and opens it.
   * @param {string|null} folderId Target folder id, null for the root.
   * @param {string|null} [template] Seed text to place in the new draft.
   * @returns {Promise<void>}
   */
  async #createDocumentInFolder(folderId, template = null) {
    const target = typeof folderId === 'string' && folderId.length > 0 ? folderId : null;
    this.#applyResult(await this.#docs?.createDocument(target));
    this.#seedDraft(template);
  }

  /**
   * Seeds the just-opened draft with template text. Like the parent's own
   * editor handler, the draft feeds the map directly before any save.
   * @param {string|null} template Seed text; null keeps the empty draft.
   * @returns {void}
   */
  #seedDraft(template) {
    if (!this.isConnected || template === null) {
      return;
    }
    this.#docs?.setDraft(template);
    this.#docs?.scheduleSave();
    this.#pushLiveUpdates();
  }

  /**
   * Creates a root folder and opens the inline rename editor on it.
   * @returns {Promise<void>}
   */
  async #createFolder() {
    const result = await this.#docs?.createFolder();
    if (!result?.created) {
      return;
    }
    this.#refreshChrome();
    this.#sideEl?.beginRename(`folder:${result.created.id}`);
  }

  /**
   * Moves a document into a folder (or back to the root) and refreshes
   * the list. The open document stays open wherever it lands.
   * @param {string} id Document id.
   * @param {string|null} folderId Target folder id, null for the root.
   * @returns {Promise<void>}
   */
  async #moveDocument(id, folderId) {
    if (await this.#docs?.moveDocument(id, folderId)) {
      this.#refreshChrome();
    }
  }

  /**
   * Imports a local Markdown file as a new document: opens the system file
   * picker, reads the chosen file as text and hands title plus content to
   * the controller (mirrors the download anchor trick, in reverse).
   * @returns {Promise<void>}
   */
  async #importDocument() {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      return;
    }
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.md,.markdown,.mdown,.txt';
    picker.style.display = 'none';
    this.shadowRoot.append(picker);
    const cleanup = () => picker.remove();
    picker.addEventListener('cancel', cleanup, { once: true });
    picker.addEventListener('change', async () => {
      try {
        const file = picker.files?.[0] ?? null;
        if (!file) {
          return;
        }
        const content = await file.text();
        const result = await this.#docs?.importContent({ title: deriveImportTitle(file.name), content });
        this.#applyResult(result);
      } catch (error) {
        console.error('[parsi-page-home] document import failed');
      } finally {
        cleanup();
      }
    }, { once: true });
    picker.click();
  }

  /**
   * Renames a document through the service, keeping the inline editor open
   * with an error when the title is taken. Empty titles cancel silently.
   * @param {unknown} id Document id from the event detail.
   * @param {unknown} title New title from the event detail.
   * @returns {Promise<void>}
   */
  async #renameDocument(id, title) {
    // Folder rows rename through the same inline editor under a prefix.
    if (typeof id === 'string' && id.startsWith(FOLDER_ID_PREFIX)) {
      const outcome = await this.#docs?.renameFolder(id.slice(FOLDER_ID_PREFIX.length), title);
      if (outcome === 'renamed' || outcome === 'empty' || outcome === 'failed') {
        this.#sideEl?.cancelRename();
      }
      if (outcome === 'renamed') {
        this.#requestEditor();
      }
      if (outcome === 'duplicate') {
        this.#sideEl?.configure({ renameError: 'parsinegar.folders.duplicate' });
      }
      return;
    }    const outcome = await this.#docs?.renameDocument(id, title);
    if (outcome === 'renamed' || outcome === 'empty' || outcome === 'failed') {
      this.#sideEl?.cancelRename();
    }
    if (outcome === 'renamed') {
      this.#requestEditor();
    }
    if (outcome === 'duplicate') {
      this.#sideEl?.configure({ renameError: 'parsinegar.documents.duplicate' });
    }
  }

  /**
   * Opens the properties modal for a document.
   * @param {string} id Document id.
   * @returns {Promise<void>}
   */
  async #showProperties(id) {
    const record = await this.#docs?.showProperties(id);
    if (record) {
      this.#requestEditor();
    }
  }

  /**
   * Deletes the confirmed document or folder through the controller, then
   * opens the adopted record (if the open document went away with it).
   * @returns {Promise<void>}
   */
  async #confirmDeleteAndApply() {
    const { confirmFolderDeleteId = null } = this.#docs?.getState() ?? {};
    if (confirmFolderDeleteId !== null) {
      const result = await this.#docs?.confirmFolderDelete();
      this.#applyResult(result);
      return;
    }
    const result = await this.#docs?.confirmDelete();
    this.#applyResult(result);
  }

  /**
   * Persists one radio-group setting and remounts the editor when it applies.
   * Theme reaches the shell through the `settings:changed` domain event
   * handled by the entry point; direction remounts the editor.
   * @param {unknown} key Setting key from the event detail.
   * @param {unknown} value Setting value from the event detail.
   * @returns {Promise<void>}
   */
  async #applySettingChange(key, value) {
    const outcome = await this.#prefs?.applyChange(key, value);
    if (outcome === 'applied' && this.isConnected) {
      this.#requestEditor();
    }
  }

  /**
   * Persists one font-size step and remounts the editor when it applies.
   * Out-of-range steps reject in the service and leave everything unchanged.
   * @param {unknown} key Setting key from the event detail.
   * @param {unknown} delta Step delta from the event detail.
   * @returns {Promise<void>}
   */
  async #applySettingStep(key, delta) {
    const outcome = await this.#prefs?.applyStep(key, delta);
    if (outcome === 'applied' && this.isConnected) {
      this.#requestEditor();
    }
  }

  /**
   * Applies a controller result to the editor: adopted records replace the
   * mounted view, list-only results just refresh the chrome.
   * @param {object|null|undefined} result Controller result (`{ apply, items, folders }`, `{ none: true }`) or null on no-op.
   * @returns {void}
   */
  #applyResult(result) {
    if (!result) {
      return;
    }
    if (result.apply) {
      // Unmount first: it parks the old editor content into the draft,
      // which adopt() then overwrites with the incoming record.
      this.#unmountEditor();
      this.#docs?.adopt(result.apply, result.items, result.folders ?? null);
      this.#spy.reset();
      // Any opened document leaves a built-in doc behind; the fresh mount
      // below picks the adopted record content and its stored lock.
      this.#builtIn = null;
      // A new document owns a new search: drop the old query and form.
      this.#searchOpen = false;
      this.#searchSpec = null;
      this.#menuEl?.configure({ searchOpen: false, search: null });
    }
    this.#requestEditor();
    void this.#sync?.updateDirty();
  }

  #requestEditor() {
    this.#unmountEditor();
    this.#ensureRenderObserver();
    this.requestRender();
  }

  /**
   * Formats a number for the active language, falling back to plain text
   * when no formatter was handed down.
   * @param {number} value Number value.
   * @returns {string} Formatted number.
   */
  #formatNumber(value) {
    return formatNumber(this.#format, value);
  }

  /**
   * Formats a timestamp for the active language, falling back to ISO text
   * when no formatter was handed down.
   * @param {number} value Epoch milliseconds.
   * @returns {string} Formatted date and time.
   */
  #formatDate(value) {
    return formatDate(this.#format, value);
  }

  #pushLiveUpdates() {
    if (!this.isConnected) {
      return;
    }
    const stats = countStats(this.value);
    this.#statusEl?.configure({
      stats,
      formatNumber: (value) => this.#formatNumber(value),
      readOnly: this.#builtIn !== null || this.#currentLocked(),
    });
    const { items = [], folders = [], currentId = null } = this.#docs?.getState() ?? {};
    const { settings = null } = this.#prefs?.getState() ?? {};
    this.#sideEl?.configure({
      activeView: this.#activeView,
      mindmapMode: this.#centerMode === 'mindmap',
      items,
      folders,
      currentId,
      documentText: this.value,
      settings,
      sortMode: this.#filesSort,
    });
    if (this.#centerMode === 'mindmap') {
      void this.#mind?.refresh();
    }
  }

  #mountEditor() {
    if (this.#editor || !this.isConnected) {
      return;
    }
    const host = this.shadowRoot.querySelector('[part="editor-host"]');
    if (!host) {
      return;
    }
    try {
      this.#editor = createMarkdownView(host, {
        document: this.#builtIn?.content ?? this.#docs?.getDraft() ?? SAMPLE_DOCUMENT,
        label: this.#t('parsinegar.editor.label'),
        direction: this.#prefs?.getState().direction ?? 'rtl',
        fontSize: this.#prefs?.getState().fontSize ?? 16,
        colorScheme: this.#resolveColorScheme(),
        readOnly: this.#builtIn !== null || this.#currentLocked(),
        t: this.#t,
        assetBaseUrl: this.#assetBaseUrl,
        onChange: (value) => {
          // Built-in docs never touch the draft, the change event or the
          // save timer: loading them dispatches through setDocument, and
          // the lock refuses every user edit anyway.
          if (this.#builtIn) {
            this.#pushLiveUpdates();
            return;
          }
          this.#docs?.setDraft(value);
          this.dispatchEvent(
            new CustomEvent(CHANGE_EVENT, {
              bubbles: true,
              composed: true,
              detail: { value },
            }),
          );
          this.#pushLiveUpdates();
          this.#recountSearch();
          this.#docs?.scheduleSave();
        },
      });
      this.#editorHost = host;
      this.#spy.report();
      if (this.#pendingBuiltin !== null) {
        const pending = this.#pendingBuiltin;
        this.#pendingBuiltin = null;
        void this.#openBuiltin(pending);
      } else if (this.#pendingGotoLine !== null) {
        const line = this.#pendingGotoLine;
        this.#pendingGotoLine = null;
        this.#editor.gotoLine(line);
      }
    } catch (error) {
      this.#editor = null;
      this.#editorHost = null;
      throw error;
    }
  }

  #unmountEditor() {
    if (this.#editor) {
      this.#docs?.setDraft(this.#editor.getValue());
      this.#editor.destroy();
      this.#editor = null;
    }
    this.#editorHost = null;
  }

  /**
   * Mounts the mindmap controller into its host node (no-op when already
   * mounted or disconnected). The library loads lazily on first mount.
   * @returns {void}
   */
  #mountMindmap() {
    if (this.#mind || !this.isConnected) {
      return;
    }
    const host = this.shadowRoot.querySelector('[part="mindmap-host"]');
    if (!host) {
      return;
    }
    try {
      this.#mind = createMindmapHost(host, {
        getText: () => this.value,
        t: this.#t,
        dark: this.#resolveColorScheme() === 'dark',
        layout: this.#prefs?.getState().settings?.mindmapLayout,
        onChange: (text) => {
          this.#docs?.setDraft(text);
          this.#docs?.scheduleSave();
        },
        onJump: (line) => {
          this.#exitMindmap(line);
          this.#requestEditor();
        },
        onLayoutChange: (value) => {
          this.#prefs?.saveMindmapLayout(value);
        },
      });
      this.#mindmapHost = host;
    } catch (error) {
      this.#mind = null;
      this.#mindmapHost = null;
      throw error;
    }
  }

  /**
   * Destroys the mindmap controller, releasing the library instance.
   * @returns {void}
   */
  #unmountMindmap() {
    if (this.#mind) {
      this.#mind.destroy();
      this.#mind = null;
    }
    this.#mindmapHost = null;
  }
}

customElements.define(TAG, ParsiPageHome);

export { ParsiPageHome, TAG };
