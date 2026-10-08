// Home page: workbench shell owning menus, rail, side panel and status as
// child elements plus the CodeMirror editor. Regions mount through the shared
// mount helper after render; children talk back only through bubbled
// CustomEvents. The editor itself stays helper-mounted (third-party widget).
// All DOM event handling stays declarative on PeyElement.
import { PeyElement } from 'pey.webui/base/pey-element';
import { createMarkdownView } from '../../components/editor/markdown-view.js';
import SAMPLE_DOCUMENT from '../../sample-document.js';
import { countStats } from '../../components/workbench/stats.js';
import { FILES_VIEW, getView, listViews } from '../../components/workbench/views.js';
import { DEFAULT_FILES_SORT, FILES_SORT_MODES } from '../../components/workbench/views-files.js';
import { formatDate, formatNumber } from '../../utils/format.js';
import { mountComponent, scheduleAttachments } from '../../utils/mount.js';
import { createDocumentController, deriveImportTitle } from './document-controller.js';
import { createBuiltinDocs } from './builtin-docs.js';
import { createSettingsApplier } from './settings-applier.js';
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
// Side-panel ids for device entries: the service owns paths, the panel only
// needs opaque strings, so disk ids are namespaced and never collide.
const DISK_ID_PREFIX = 'disk:';
const FILESYSTEM_METHODS = ['getCapabilities', 'pickDirectory', 'pickFile', 'listDirectory', 'collectEntries', 'readEntry', 'writeEntry', 'saveShadow', 'readShadow', 'clearShadow'];
// Browser shadow persist lags typing like the IndexedDB autosave does;
// park operations (switch, close) persist immediately instead.
const SHADOW_SAVE_DELAY_MS = 1000;
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

/**
 * Resolves a stored theme preference to an export theme. `device` follows
 * the OS preference; anything unknown falls back to light (the export
 * service accepts only light, dark and sepia).
 * @param {unknown} value Stored theme value.
 * @returns {string} Export theme name.
 */
function resolveExportTheme(value) {
  if (value === 'dark' || value === 'sepia' || value === 'light') {
    return value;
  }
  if (value === 'device' && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches === true ? 'dark' : 'light';
  }
  return 'light';
}

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
  #activeView = FILES_VIEW;
  #sideOpen = true;
  #filesSort = DEFAULT_FILES_SORT;
  #bottomOpen = true;
  #renderObserver = null;
  #editorHost = null;
  #menuEl = null;
  #searchOpen = false;
  #exporter = null;
  #searchSpec = null;
  #builtIn = null;
  #guides = null;
  #filesystem = null;
  #disk = null;
  #shadowTimer = null;
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
    // Raw values (not wrappers): the controller guards absent services and
    // formatters itself, and reconnect re-passes them without losing state.
    const docRefs = { documents, t: this.#t, format: this.#format };
    if (!this.#docs) {
      this.#docs = createDocumentController({
        ...docRefs,
        isLive: () => this.isConnected,
        readEditorContent: () => this.#editor?.getValue(),
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
    this.#exporter = exporter && typeof exporter.exportHtml === 'function' ? exporter : null;
    const filesystem = refs.services?.[FILESYSTEM_SERVICE] ?? null;
    this.#filesystem = filesystem && FILESYSTEM_METHODS.every((method) => typeof filesystem[method] === 'function')
      ? filesystem
      : null;
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
      // Explicit disk save (v1 has no autosave to disk): claims Ctrl+S only
      // while a device entry is open, so the browser keeps its own save
      // dialog everywhere else.
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.code === 'KeyS') {
        if (this.#disk?.currentPath != null && this.#editor) {
          event.preventDefault();
          void this.#saveDisk();
        }
        return;
      }
      if (event.key === 'Escape' && this.#docs) {
        const { confirmDeleteId, propsRecord } = this.#docs.getState();
        if (confirmDeleteId !== null || propsRecord !== null) {
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
        void this.#openBuiltin('about');
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
        if (event.detail.id.startsWith(DISK_ID_PREFIX)) {
          void this.#switchDiskEntry(event.detail.id.slice(DISK_ID_PREFIX.length));
        } else {
          void this.#switchDocument(event.detail.id);
        }
        return;
      }
      if (event.type === 'document-create') {
        void this.#createDocument();
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
      if (event.type === 'document-download') {
        void this.#downloadDocument(event.detail?.id);
        return;
      }
      if (event.type === 'document-download-html') {
        void this.#downloadHtmlDocument(event.detail?.id);
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
    }
    const target = event.target;
    if (target?.closest?.('[part="editor-host"]')) {
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
    this.#prefs?.unwatchColorScheme();
    this.#spy.unwatch();
    this.#renderObserver?.disconnect();
    this.#renderObserver = null;
    super.disconnectedCallback();
  }

  /**
   * Arms a one-purpose observer that mounts the editor as soon as a render
   * produces its host node. Tracks host node identity (not just editor
   * presence) because a full re-render detaches the previous view while the
   * reference stays set. Stays armed across re-renders; CodeMirror's own DOM
   * lives inside the host node, so it never retriggers itself.
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
        case 'import-document':
          await this.#importDocument();
          return;
        case 'open-file':
          await this.#openDiskFile();
          return;
        case 'open-folder':
          await this.#openDiskFolder();
          return;
        case 'close-disk':
          await this.#closeDisk();
          return;
        case 'save-disk':
          await this.#saveDisk();
          return;
        case 'about':
          await this.#openBuiltin('about');
          return;
        case 'open-help':
          await this.#openBuiltin('help');
          return;
        case 'open-changelog':
          await this.#openBuiltin('changelog');
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
              await this.#downloadDocument(currentId);
            }
          }
          return;
        }
        case 'download-html': {
          if (!this.#builtIn) {
            const { currentId = null } = this.#docs?.getState() ?? {};
            if (currentId) {
              await this.#downloadHtmlDocument(currentId);
            }
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
   * open document or a mounted editor.
   * @param {string} focus 'replace' focuses the replacement input, anything
   *   else the query input.
   * @returns {boolean} True when the dropdown was opened.
   */
  #openSearch(focus) {
    const { currentId = null } = this.#docs?.getState() ?? {};
    if ((currentId === null && !this.#diskActive()) || !this.#editor) {
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
    const view = getView(id);
    if (!view) {
      return;
    }
    if (id === this.#activeView) {
      this.#sideOpen = !this.#sideOpen;
    } else {
      this.#activeView = id;
      this.#sideOpen = true;
    }
    this.#requestEditor();
  }

  render() {
    scheduleAttachments(() => this.#attachChildren());
    return `
      <div part="workbench" data-side="${this.#sideOpen ? 'open' : 'closed'}">
        <div data-slot="menubar"></div>
        <div data-slot="rail"></div>
        ${this.#sideOpen ? '<div data-slot="side"></div>' : ''}
        <div part="center">
          <div part="editor-host"></div>
        </div>
        ${this.#bottomOpen ? '<div data-slot="status"></div>' : ''}
      </div>
      <div data-slot="modal"></div>
    `;
  }

  /**
   * Opens a built-in project doc (help, changelog, about) in the mounted
   * editor, locked for reading. The user draft is parked first, so closing
   * returns to it untouched; the built-in never touches the draft, the
   * save timer or the documents service.
   * @param {unknown} id Built-in doc id.
   * @returns {Promise<void>}
   */
  async #openBuiltin(id) {
    const opened = await this.#guides?.open(id);
    if (!opened || !this.isConnected || !this.#editor) {
      return;
    }
    this.#parkEditorDraft();
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
      if (this.#diskActive()) {
        this.#editor.setDocument(this.#diskContent() ?? SAMPLE_DOCUMENT);
        this.#editor.setReadOnly(false);
      } else {
        this.#editor.setDocument(this.#docs?.getDraft() ?? SAMPLE_DOCUMENT);
        this.#editor.setReadOnly(this.#currentLocked());
      }
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
    if (this.#builtIn || this.#diskActive()) {
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
    if (this.#builtIn || this.#diskActive()) {
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
    const diskList = this.#disk !== null;
    const diskActive = this.#diskActive();
    const { currentId = null } = this.#docs?.getState() ?? {};
    const shownId = diskActive ? `${DISK_ID_PREFIX}${this.#disk.currentPath}` : currentId;
    const locked = this.#builtIn !== null || (!diskActive && this.#currentLocked());
    this.#menuEl?.configure({
      hasDocument: shownId !== null,
      readOnly: locked,
      builtInOpen: this.#builtIn !== null,
      diskOpen: diskList,
      diskActive,
    });
    this.#pushLiveUpdates();
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
    const { items = [], currentId = null } = this.#docs?.getState() ?? {};
    const diskList = this.#disk !== null;
    const diskActive = this.#diskActive();
    const shownId = diskActive ? `${DISK_ID_PREFIX}${this.#disk.currentPath}` : currentId;
    this.#menuEl = mountComponent({
      shadowRoot: this.shadowRoot,
      slot: '[data-slot="menubar"]',
      tag: 'parsi-menu-bar',
      infrastructure,
      refs: {
        t: this.#t,
        hasDocument: shownId !== null,
        formatNumber: (value) => this.#formatNumber(value),
        assetBaseUrl: this.#assetBaseUrl,
      },
      configure: (element) => element.configure({
        hasDocument: shownId !== null,
        readOnly: this.#builtIn !== null || (!diskActive && this.#currentLocked()),
        builtInOpen: this.#builtIn !== null,
        diskOpen: diskList,
        diskActive,
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
      },
      configure: (element) => element.configure({ views: listViews(), activeView: this.#activeView }),
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
          items,
          currentId: shownId,
          documentText: this.value,
          settings: this.#prefs?.getState().settings ?? null,
          formatNumber: (value) => this.#formatNumber(value),
          sortMode: this.#filesSort,
          disk: this.#disk,
        },
        configure: (element) => element.configure({
          activeView: this.#activeView,
          items,
          currentId: shownId,
          documentText: this.value,
          settings: this.#prefs?.getState().settings ?? null,
          activeLine: this.#spy.getActiveLine(),
          sortMode: this.#filesSort,
          disk: this.#disk,
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
      configure: (element) => element.configure({ modal: this.#docs?.getModal() ?? null }),
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
  }

  async #switchDocument(id) {
    this.#applyResult(await this.#docs?.switchDocument(id));
  }

  async #createDocument() {
    this.#applyResult(await this.#docs?.createDocument());
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
   * Returns the bound environment picker for files or folders, or null when
   * the browser has none (the caller then falls back to a hidden input).
   * @param {string} kind 'file' or 'directory'.
   * @returns {Function|null} Bound picker or null.
   */
  #envPicker(kind) {
    const scope = typeof window !== 'undefined' ? window : globalThis;
    const picker = kind === 'directory' ? scope?.showDirectoryPicker : scope?.showOpenFilePicker;
    return typeof picker === 'function' ? picker.bind(scope) : null;
  }

  /**
   * Returns the open device entry, or null when no entry is in the editor
   * (outside disk mode, or the folder list is open with an IndexedDB
   * document showing).
   * @returns {object|null} Current `{ name, path, handle?, file?, base?, draft? }`.
   */
  #diskCurrent() {
    if (!this.#diskActive()) {
      return null;
    }
    return this.#disk.entries.find((entry) => entry?.path === this.#disk.currentPath) ?? null;
  }

  /**
   * Reports whether a device entry (not an IndexedDB document) is open in
   * the editor. The folder list alone (`#disk` set, `currentPath` null)
   * does not count.
   * @returns {boolean} True when a device entry is showing.
   */
  #diskActive() {
    return this.#disk?.currentPath != null;
  }

  /**
   * Returns the open device content for mounting (adopt pre-reads, so the
   * draft is always set while a current path exists).
   * @returns {string|null} Current disk text or null.
   */
  #diskContent() {
    return this.#diskCurrent()?.draft ?? null;
  }

  /**
   * Maps disk entries to side-panel items (opaque `disk:` ids, relative
   * paths as titles). Built once per adoption so the panel snapshot keeps
   * a stable identity across keystrokes.
   * @param {Array} entries Service entries to map.
   * @returns {Array<object>} `{ id, title, path }` items.
   */
  #diskViewItems(entries) {
    return (Array.isArray(entries) ? entries : []).map((entry) => ({
      id: `${DISK_ID_PREFIX}${entry.path}`,
      title: entry.path,
      path: entry.path,
    }));
  }

  /**
   * Parks the mounted editor content: into the open disk entry when one is
   * showing, into the documents draft otherwise.
   * @returns {void}
   */
  #parkEditorDraft() {
    if (!this.#editor) {
      return;
    }
    if (this.#diskActive()) {
      const current = this.#diskCurrent();
      if (current) {
        current.draft = this.#editor.getValue();
      }
      return;
    }
    this.#docs?.setDraft(this.#editor.getValue());
  }

  /**
   * Persists one disk entry draft to its browser shadow immediately.
   * Failures stay console-loud and UI-silent: the in-memory draft (and a
   * later explicit disk save) still carries the content.
   * @param {object} entry Device entry with `{ base, draft }`.
   * @returns {Promise<object|null>} Save result, or null.
   */
  async #persistShadow(entry) {
    const filesystem = this.#filesystem;
    if (!filesystem || !entry || !this.#disk || !this.isConnected) {
      return null;
    }
    try {
      return await filesystem.saveShadow(this.#disk.rootName, entry.path, entry.base ?? '', entry.draft ?? '');
    } catch (error) {
      console.error('[parsi-page-home] shadow save failed');
      return null;
    }
  }

  /**
   * Schedules a browser-shadow persist after typing settles; park
   * operations persist immediately instead (and cancel this timer).
   * @returns {void}
   */
  #scheduleShadowSave() {
    const entry = this.#diskCurrent();
    if (!entry) {
      return;
    }
    if (this.#shadowTimer !== null) {
      clearTimeout(this.#shadowTimer);
    }
    this.#shadowTimer = setTimeout(() => {
      this.#shadowTimer = null;
      void this.#persistShadow(entry);
    }, SHADOW_SAVE_DELAY_MS);
  }

  /**
   * Cancels a pending shadow persist (an immediate persist replaces it).
   * @returns {void}
   */
  #cancelShadowSave() {
    if (this.#shadowTimer !== null) {
      clearTimeout(this.#shadowTimer);
      this.#shadowTimer = null;
    }
  }

  /**
   * Loads device content with the shadow rule: a stored draft returns only
   * when the disk bytes still match the base it started from — an
   * externally changed file always wins, and its stale shadow is dropped.
   * Shadow failures never block opening.
   * @param {object} entry Device entry to load.
   * @param {string} root Folder label for shadow lookup.
   * @returns {Promise<object>} `{ content, base }`.
   */
  async #loadDiskContent(entry, root) {
    const filesystem = this.#filesystem;
    const diskContent = await filesystem.readEntry(entry);
    let content = diskContent;
    try {
      const shadow = await filesystem.readShadow(root, entry.path);
      if (shadow && typeof shadow.draft === 'string') {
        if (shadow.base === diskContent) {
          content = shadow.draft;
        } else {
          await filesystem.clearShadow(root, entry.path).catch(() => null);
        }
      }
    } catch (error) {
      console.error('[parsi-page-home] shadow restore failed');
    }
    return { content, base: diskContent };
  }

  /**
   * Opens a single device file for live editing: picker first, hidden
   * input fallback (Firefox has no file picker) second.
   * @returns {Promise<void>}
   */
  async #openDiskFile() {
    const filesystem = this.#filesystem;
    if (!filesystem) {
      return;
    }
    try {
      const capabilities = await filesystem.getCapabilities();
      if (!this.isConnected) {
        return;
      }
      if (capabilities.filePicker === true) {
        const entry = await filesystem.pickFile(this.#envPicker('file'));
        if (!this.isConnected || !entry) {
          return;
        }
        await this.#adoptDiskEntries([entry], entry.path, entry.name);
        return;
      }
    } catch (error) {
      console.error('[parsi-page-home] disk file open failed');
      return;
    }
    this.#diskFallbackInput(false);
  }

  /**
   * Opens a device folder for live editing: picker first, hidden
   * webkitdirectory input fallback (Firefox has no directory picker)
   * second. Empty (Markdown-less) folders refuse cleanly.
   * @returns {Promise<void>}
   */
  async #openDiskFolder() {
    const filesystem = this.#filesystem;
    if (!filesystem) {
      return;
    }
    try {
      const capabilities = await filesystem.getCapabilities();
      if (!this.isConnected) {
        return;
      }
      if (capabilities.directoryPicker === true) {
        const picked = await filesystem.pickDirectory(this.#envPicker('directory'));
        if (!this.isConnected || !picked?.handle) {
          return;
        }
        const entries = await filesystem.listDirectory(picked.handle);
        if (!this.isConnected) {
          return;
        }
        if (entries.length === 0) {
          console.error('[parsi-page-home] disk folder has no markdown files');
          return;
        }
        await this.#adoptDiskEntries(entries, entries[0].path, picked.name);
        return;
      }
    } catch (error) {
      console.error('[parsi-page-home] disk folder open failed');
      return;
    }
    this.#diskFallbackInput(true);
  }

  /**
   * Fallback file input for browsers without pickers: single file, or a
   * whole folder via `webkitdirectory` (its File list carries relative
   * paths, so the service filters it like a walk).
   * @param {boolean} directory True for folder input, false for single file.
   * @returns {void}
   */
  #diskFallbackInput(directory) {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      return;
    }
    const picker = document.createElement('input');
    picker.type = 'file';
    if (directory === true) {
      picker.setAttribute('webkitdirectory', '');
    } else {
      picker.accept = '.md,.markdown,.mdown,.txt';
    }
    picker.style.display = 'none';
    this.shadowRoot.append(picker);
    const cleanup = () => picker.remove();
    picker.addEventListener('cancel', cleanup, { once: true });
    picker.addEventListener('change', async () => {
      try {
        const entries = await this.#filesystem?.collectEntries([...(picker.files ?? [])]) ?? [];
        if (!this.isConnected) {
          return;
        }
        if (entries.length === 0) {
          console.error('[parsi-page-home] disk fallback found no markdown files');
          return;
        }
        const root = directory === true ? (entries[0].path.split('/')[0] ?? '') : entries[0].name;
        await this.#adoptDiskEntries(entries, entries[0].path, root);
      } catch (error) {
        console.error('[parsi-page-home] disk fallback failed');
      } finally {
        cleanup();
      }
    }, { once: true });
    picker.click();
  }

  /**
   * Adopts device entries: reads the target (with the shadow rule), parks
   * the previous draft (persisting a disk one to its shadow), and mounts
   * the content unlocked. IndexedDB drafts stay untouched; explicit save is
   * the only way disk bytes change.
   * @param {Array} entries Service entries to adopt.
   * @param {string} currentPath Path to open.
   * @param {string} rootName Folder/file label for the session.
   * @returns {Promise<void>}
   */
  async #adoptDiskEntries(entries, currentPath, rootName) {
    const filesystem = this.#filesystem;
    if (!filesystem || !this.isConnected || !Array.isArray(entries) || entries.length === 0) {
      return;
    }
    const target = entries.find((entry) => entry?.path === currentPath) ?? null;
    if (!target) {
      return;
    }
    try {
      const root = typeof rootName === 'string' ? rootName : '';
      const { content, base } = await this.#loadDiskContent(target, root);
      if (!this.isConnected) {
        return;
      }
      await this.#parkActiveDraft();
      target.base = base;
      target.draft = content;
      this.#disk = {
        entries,
        currentPath: target.path,
        rootName: root,
        items: this.#diskViewItems(entries),
      };
      this.#builtIn = null;
      this.#searchOpen = false;
      this.#searchSpec = null;
      this.#menuEl?.configure({ searchOpen: false, search: null });
      if (this.#editor) {
        this.#editor.setDocument(content);
        this.#editor.setReadOnly(false);
      }
      this.#spy.reset();
      this.#refreshChrome();
    } catch (error) {
      console.error('[parsi-page-home] disk open failed');
    }
  }

  /**
   * Parks the active draft wherever it belongs and persists a disk draft
   * to its browser shadow immediately (cancelling the typing timer).
   * @returns {Promise<void>}
   */
  async #parkActiveDraft() {
    this.#parkEditorDraft();
    const entry = this.#diskCurrent();
    if (entry) {
      this.#cancelShadowSave();
      await this.#persistShadow(entry);
    }
  }

  /**
   * Switches the open device entry: the previous draft stays parked on its
   * entry (persisted to its shadow — in-session and refresh lossless), the
   * target loads from its draft, its shadow, or disk.
   * @param {string} path Entry path to open.
   * @returns {Promise<void>}
   */
  async #switchDiskEntry(path) {
    const filesystem = this.#filesystem;
    if (!filesystem || !this.#disk || typeof path !== 'string' || path === this.#disk.currentPath) {
      return;
    }
    const target = this.#disk.entries.find((entry) => entry?.path === path) ?? null;
    if (!target) {
      return;
    }
    try {
      let content = target.draft;
      if (content === undefined) {
        const loaded = await this.#loadDiskContent(target, this.#disk.rootName);
        content = loaded.content;
        target.base = loaded.base;
      }
      if (!this.isConnected || !this.#disk) {
        return;
      }
      await this.#parkActiveDraft();
      target.draft = content;
      this.#disk.currentPath = target.path;
      this.#builtIn = null;
      if (this.#editor) {
        this.#editor.setDocument(content);
        this.#editor.setReadOnly(false);
      }
      this.#spy.reset();
      this.#refreshChrome();
    } catch (error) {
      console.error('[parsi-page-home] disk switch failed');
    }
  }

  /**
   * Saves the open device entry explicitly (v1 has no disk autosave):
   * write-through on handles, download fallback otherwise (Firefox entries
   * carry no handle) or on failure — clean degradation, never data loss.
   * A successful write moves the shadow base forward and drops the now
   * redundant shadow.
   * @returns {Promise<string|null>} 'saved', 'downloaded', or null.
   */
  async #saveDisk() {
    const filesystem = this.#filesystem;
    const entry = this.#diskCurrent();
    if (!filesystem || !entry || !this.#editor || !this.isConnected) {
      return null;
    }
    const content = this.#editor.getValue();
    try {
      const result = await filesystem.writeEntry(entry, content);
      if (!this.isConnected) {
        return null;
      }
      if (result) {
        entry.draft = content;
        entry.base = content;
        this.#cancelShadowSave();
        await filesystem.clearShadow(this.#disk.rootName, entry.path).catch(() => null);
        return 'saved';
      }
    } catch (error) {
      console.error('[parsi-page-home] disk save failed');
    }
    return this.#downloadDiskFallback(entry, content);
  }

  /**
   * Downloads device content through a temporary anchor (the save fallback
   * for handle-less entries and write failures).
   * @param {object} entry Device entry (supplies the filename).
   * @param {string} content Text to deliver.
   * @returns {string|null} 'downloaded' or null when unsupported.
   */
  #downloadDiskFallback(entry, content) {
    if (typeof URL.createObjectURL !== 'function') {
      console.error('[parsi-page-home] disk download is unsupported here');
      return null;
    }
    try {
      const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }));
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = entry?.name ?? 'document.md';
        this.shadowRoot.append(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      return 'downloaded';
    } catch (error) {
      console.error('[parsi-page-home] disk download failed');
      return null;
    }
  }

  /**
   * Closes the folder list and returns to the IndexedDB working set, whose
   * draft was never touched while device entries were open. Browser shadows
   * stay stored (reopening restores them through the shadow rule), so
   * closing is lossless too.
   * @returns {Promise<void>}
   */
  async #closeDisk() {
    if (!this.#disk) {
      return;
    }
    const wasActive = this.#diskActive();
    await this.#parkActiveDraft();
    this.#disk = null;
    if (wasActive && this.#editor) {
      this.#editor.setDocument(this.#docs?.getDraft() ?? SAMPLE_DOCUMENT);
      this.#editor.setReadOnly(this.#currentLocked());
    }
    this.#refreshChrome();
  }

  /**
   * Renames a document through the service, keeping the inline editor open
   * with an error when the title is taken. Empty titles cancel silently.
   * @param {unknown} id Document id from the event detail.
   * @param {unknown} title New title from the event detail.
   * @returns {Promise<void>}
   */
  async #renameDocument(id, title) {
    // Device entries have no rename in v1 (their ⋯ menu stays hidden).
    if (typeof id === 'string' && id.startsWith(DISK_ID_PREFIX)) {
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
   * Downloads a document as a Markdown file through a temporary anchor in
   * the page shadow (released right after the click).
   * @param {unknown} id Document id from the event detail.
   * @returns {Promise<void>}
   */
  async #downloadDocument(id) {
    if (typeof id === 'string' && id.startsWith(DISK_ID_PREFIX)) {
      return;
    }
    if (typeof URL.createObjectURL !== 'function') {
      console.error('[parsi-page-home] download is unsupported here');
      return;
    }
    try {
      const record = await this.#docs?.prepareDownload(id);
      if (!this.isConnected || !record) {
        return;
      }
      const url = URL.createObjectURL(new Blob([record.content ?? ''], { type: 'text/markdown' }));
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${String(record.title ?? '').replace(/[\\/]/g, '-')}.md`;
        this.shadowRoot.append(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('[parsi-page-home] document download failed');
    }
  }

  /**
   * Downloads a document as a standalone HTML file: the export service
   * renders the content with the effective theme, the page only delivers
   * the resulting bytes through a temporary anchor (released after click).
   * @param {unknown} id Document id from the event detail.
   * @returns {Promise<void>}
   */
  async #downloadHtmlDocument(id) {
    if (typeof id === 'string' && id.startsWith(DISK_ID_PREFIX)) {
      return;
    }
    if (typeof URL.createObjectURL !== 'function') {
      console.error('[parsi-page-home] download is unsupported here');
      return;
    }
    try {
      const record = await this.#docs?.prepareDownload(id);
      const exporter = this.#exporter;
      if (!this.isConnected || !record || !exporter) {
        return;
      }
      const stored = this.#prefs?.getState().settings ?? null;
      const result = await exporter.exportHtml({
        markdown: record.content ?? '',
        title: record.title ?? '',
        theme: resolveExportTheme(stored?.theme),
      });
      if (!this.isConnected || !result) {
        return;
      }
      const url = URL.createObjectURL(new Blob([result.html ?? ''], { type: 'text/html' }));
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = result.filename ?? 'document.html';
        this.shadowRoot.append(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('[parsi-page-home] html download failed');
    }
  }

  /**
   * Opens the properties modal for a document.
   * @param {string} id Document id.
   * @returns {Promise<void>}
   */
  async #showProperties(id) {
    if (typeof id === 'string' && id.startsWith(DISK_ID_PREFIX)) {
      return;
    }
    const record = await this.#docs?.showProperties(id);
    if (record) {
      this.#requestEditor();
    }
  }

  /**
   * Deletes the confirmed document through the controller, then opens the
   * adopted record (if the open document went away with it).
   * @returns {Promise<void>}
   */
  async #confirmDeleteAndApply() {
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
   * @param {object|null|undefined} result Controller result (`{ apply, items }`, `{ none: true }`) or null on no-op.
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
      this.#docs?.adopt(result.apply, result.items);
      this.#spy.reset();
      // Any opened document leaves a built-in doc behind; the fresh mount
      // below picks the adopted record content and its stored lock.
      this.#builtIn = null;
      // Adopting an IndexedDB record shows it in the editor, but an open
      // folder list stays listed: only the active entry steps back (its
      // parked draft persists to its shadow immediately).
      const parkedEntry = this.#diskCurrent();
      if (this.#disk) {
        this.#disk.currentPath = null;
      }
      if (parkedEntry) {
        this.#cancelShadowSave();
        void this.#persistShadow(parkedEntry);
      }
      // A new document owns a new search: drop the old query and form.
      this.#searchOpen = false;
      this.#searchSpec = null;
      this.#menuEl?.configure({ searchOpen: false, search: null });
    }
    this.#requestEditor();
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
    const diskActive = this.#diskActive();
    const stats = countStats(this.value);
    this.#statusEl?.configure({
      stats,
      formatNumber: (value) => this.#formatNumber(value),
      readOnly: this.#builtIn !== null || (!diskActive && this.#currentLocked()),
    });
    const { items = [], currentId = null } = this.#docs?.getState() ?? {};
    const { settings = null } = this.#prefs?.getState() ?? {};
    this.#sideEl?.configure({
      activeView: this.#activeView,
      items,
      currentId: diskActive ? `${DISK_ID_PREFIX}${this.#disk.currentPath}` : currentId,
      documentText: this.value,
      settings,
      sortMode: this.#filesSort,
      disk: this.#disk,
    });
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
      const diskActive = this.#diskActive();
      this.#editor = createMarkdownView(host, {
        document: this.#builtIn?.content ?? this.#diskContent() ?? this.#docs?.getDraft() ?? SAMPLE_DOCUMENT,
        label: this.#t('parsinegar.editor.label'),
        direction: this.#prefs?.getState().direction ?? 'rtl',
        fontSize: this.#prefs?.getState().fontSize ?? 16,
        colorScheme: this.#resolveColorScheme(),
        readOnly: this.#builtIn !== null || (!diskActive && this.#currentLocked()),
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
          // An open device entry keeps edits on its own draft (persisted to
          // its browser shadow on settle) while IndexedDB drafts — and their
          // autosave — stay untouched behind it.
          if (this.#diskActive()) {
            const current = this.#diskCurrent();
            if (current) {
              current.draft = value;
              this.#scheduleShadowSave();
            }
            this.#pushLiveUpdates();
            this.#recountSearch();
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
    } catch (error) {
      this.#editor = null;
      this.#editorHost = null;
      throw error;
    }
  }

  #unmountEditor() {
    if (this.#editor) {
      this.#parkEditorDraft();
      this.#editor.destroy();
      this.#editor = null;
    }
    this.#editorHost = null;
  }
}

customElements.define(TAG, ParsiPageHome);

export { ParsiPageHome, TAG };
