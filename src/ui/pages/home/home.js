// Home page: workbench shell owning menus, rail, side panel and status as
// child elements plus the CodeMirror editor. Regions mount through the shared
// mount helper after render; children talk back only through bubbled
// CustomEvents. The editor itself stays helper-mounted (third-party widget).
// All DOM event handling stays declarative on PeyElement.
import { PeyElement } from 'pey.webui/base/pey-element';
import { createMarkdownView } from '../../components/editor/markdown-view.js';
import SAMPLE_DOCUMENT from '../../sample-document.js';
import { countStats } from '../../components/workbench/stats.js';
import { logoMarkup } from '../../components/workbench/logo.js';
import { FILES_VIEW, getView, listViews } from '../../components/workbench/views.js';
import { DEFAULT_FILES_SORT, FILES_SORT_MODES } from '../../components/workbench/views-files.js';
import { formatDate, formatNumber } from '../../utils/format.js';
import { mountComponent, scheduleAttachments } from '../../utils/mount.js';
import { createDocumentController, deriveImportTitle } from './document-controller.js';
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
// Displayed on the about pane; bump together with package.json (no build
// step exists to read it at runtime).
const APP_VERSION = '۰.۶.۰';
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
  #activeView = FILES_VIEW;
  #sideOpen = true;
  #filesSort = DEFAULT_FILES_SORT;
  #bottomOpen = true;
  #renderObserver = null;
  #editorHost = null;
  #menuEl = null;
  #searchOpen = false;
  #searchSpec = null;
  #railEl = null;
  #sideEl = null;
  #statusEl = null;
  #modalEl = null;
  #events = null;
  #centerView = 'editor';

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
        this.#openAbout();
        return;
      }
      if (event.type === 'files-sort' && FILES_SORT_MODES.includes(event.detail?.mode)) {
        if (event.detail.mode !== this.#filesSort) {
          this.#filesSort = event.detail.mode;
          this.#requestEditor();
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
    if (target?.closest?.('[part="about-back"]')) {
      this.#hideAboutPane();
      return;
    }
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
        case 'about':
          this.#openAbout();
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
    if (currentId === null || !this.#editor) {
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
    const about = this.#centerView === 'about';
    return `
      <div part="workbench" data-side="${this.#sideOpen ? 'open' : 'closed'}">
        <div data-slot="menubar"></div>
        <div data-slot="rail"></div>
        ${this.#sideOpen ? '<div data-slot="side"></div>' : ''}
        <div part="center">
          <div part="editor-host"${about ? ' hidden' : ''}></div>
          ${about ? this.#renderAbout() : ''}
        </div>
        ${this.#bottomOpen ? '<div data-slot="status"></div>' : ''}
      </div>
      <div data-slot="modal"></div>
    `;
  }

  /**
   * Opens the about pane in the center column, shared by the file-menu
   * action and the rail logotype button.
   * @returns {void}
   */
  #openAbout() {
    // Imperative swap on purpose: a full render replaces the shadow
    // DOM, which would destroy the editor-host node and force an
    // editor remount (losing undo). Toggling hidden state keeps the
    // mounted view alive; render() below already reflects #centerView,
    // so any later render reconciles the same state.
    this.#centerView = 'about';
    this.#showAboutPane();
  }

  /**
   * Shows the about pane without re-rendering (see `#openAbout`), and
   * hides the editor host in place. Falls back to a render when the nodes
   * are not there yet.
   * @returns {void}
   */
  #showAboutPane() {
    const center = this.shadowRoot.querySelector('[part="center"]');
    const host = this.shadowRoot.querySelector('[part="editor-host"]');
    if (!center || !host) {
      this.requestRender();
      return;
    }
    host.setAttribute('hidden', '');
    if (!center.querySelector('[part="about"]')) {
      host.insertAdjacentHTML('afterend', this.#renderAbout());
    }
  }

  /**
   * Returns to the editor without re-rendering, keeping the mounted view
   * (and its undo history) alive.
   * @returns {void}
   */
  #hideAboutPane() {
    this.#centerView = 'editor';
    this.shadowRoot.querySelector('[part="editor-host"]')?.removeAttribute('hidden');
    this.shadowRoot.querySelector('[part="about"]')?.remove();
  }

  /**
   * Renders the static about pane shown in place of the editor. The editor
   * stays mounted (hidden) underneath, so no content, focus or undo is lost.
   * @returns {string} About markup.
   */
  #renderAbout() {
    return `
      <div part="about">
        <div part="about-logo" aria-hidden="true">${logoMarkup()}</div>
        <h1 part="about-title">${this.#t('parsinegar.about.title')}</h1>
        <p part="about-lead">${this.#t('parsinegar.about.lead')}</p>
        <p part="about-version">${this.#t('parsinegar.about.version', { version: APP_VERSION })}</p>
        <div part="about-actions">
          <button part="about-back" type="button">${this.#t('parsinegar.about.action')}</button>
          <a part="about-link" href="https://github.com/barnevis/parsinegar" target="_blank" rel="noopener">${this.#t('parsinegar.menu.github')}</a>
        </div>
      </div>`;
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
      configure: (element) => element.configure({ hasDocument: currentId !== null }),
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
          currentId,
          documentText: this.value,
          settings: this.#prefs?.getState().settings ?? null,
          formatNumber: (value) => this.#formatNumber(value),
          sortMode: this.#filesSort,
        },
        configure: (element) => element.configure({
          activeView: this.#activeView,
          items,
          currentId,
          documentText: this.value,
          settings: this.#prefs?.getState().settings ?? null,
          activeLine: this.#spy.getActiveLine(),
          sortMode: this.#filesSort,
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
   * Renames a document through the service, keeping the inline editor open
   * with an error when the title is taken. Empty titles cancel silently.
   * @param {unknown} id Document id from the event detail.
   * @param {unknown} title New title from the event detail.
   * @returns {Promise<void>}
   */
  async #renameDocument(id, title) {
    const outcome = await this.#docs?.renameDocument(id, title);
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
      // Any opened document leaves the about pane behind.
      this.#centerView = 'editor';
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
    const stats = countStats(this.value);
    this.#statusEl?.configure({
      stats,
      formatNumber: (value) => this.#formatNumber(value),
    });
    const { items = [], currentId = null } = this.#docs?.getState() ?? {};
    const { settings = null } = this.#prefs?.getState() ?? {};
    this.#sideEl?.configure({
      activeView: this.#activeView,
      items,
      currentId,
      documentText: this.value,
      settings,
      sortMode: this.#filesSort,
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
      this.#editor = createMarkdownView(host, {
        document: this.#docs?.getDraft() ?? SAMPLE_DOCUMENT,
        label: this.#t('parsinegar.editor.label'),
        direction: this.#prefs?.getState().direction ?? 'rtl',
        fontSize: this.#prefs?.getState().fontSize ?? 16,
        colorScheme: this.#resolveColorScheme(),
        t: this.#t,
        assetBaseUrl: this.#assetBaseUrl,
        onChange: (value) => {
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
      this.#docs?.setDraft(this.#editor.getValue());
      this.#editor.destroy();
      this.#editor = null;
    }
    this.#editorHost = null;
  }
}

customElements.define(TAG, ParsiPageHome);

export { ParsiPageHome, TAG };
