// Home page: workbench shell owning menus, rail, side panel and status as
// child elements plus the CodeMirror editor. Regions mount through the shared
// mount helper after render; children talk back only through bubbled
// CustomEvents. The editor itself stays helper-mounted (third-party widget).
// All DOM event handling stays declarative on PeyElement.
import { PeyElement } from 'pey.webui/base/pey-element';
import { createMarkdownView } from '../../components/editor/markdown-view.js';
import SAMPLE_DOCUMENT from '../../sample-document.js';
import { countStats, formatFileSize } from '../../components/workbench/stats.js';
import { parseOutline } from '../../components/workbench/outline.js';
import { renderConfirmModal, renderPropertiesModal } from '../../components/workbench/modal.js';
import { FILES_VIEW, getView, listViews } from '../../components/workbench/views.js';
import { mountComponent, scheduleAttachments } from '../../utils/mount.js';
import '../../components/menu-bar/menu-bar.js';
import '../../components/activity-rail/activity-rail.js';
import '../../components/side-panel/side-panel.js';
import '../../components/status-bar/status-bar.js';

const TAG = 'parsi-page-home';
const CHANGE_EVENT = 'parsi-page-home:changed';
const DOCUMENTS_SERVICE = 'parsinegar.documents.service';
const SETTINGS_SERVICE = 'parsinegar.settings.service';
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
const AUTOSAVE_DELAY_MS = 1000;
const STYLE_URL = new URL('./home.css', import.meta.url).href;

class ParsiPageHome extends PeyElement {
  #t = (key) => key;
  #format = null;
  #assetBaseUrl = null;
  #documents = null;
  #settingsApi = null;
  #settings = null;
  #settingsWrite = Promise.resolve();
  #documentDirection = 'rtl';
  #fontSize = 16;
  #outlineActiveLine = null;
  #editor = null;
  #items = [];
  #currentId = null;
  #docTitle = '';
  #draft = null;
  #saveTimer = null;
  #activeView = FILES_VIEW;
  #sideOpen = true;
  #bottomOpen = true;
  #confirmDeleteId = null;
  #propsRecord = null;
  #renderObserver = null;
  #editorHost = null;
  #centerEl = null;
  #scrollFrame = 0;
  #onCenterScroll = () => {
    if (this.#scrollFrame !== 0) {
      return;
    }
    if (typeof globalThis.requestAnimationFrame === 'function') {
      this.#scrollFrame = globalThis.requestAnimationFrame(() => {
        this.#scrollFrame = 0;
        this.#reportScrollPosition();
      });
    } else {
      this.#reportScrollPosition();
    }
  };
  #colorSchemeQuery = null;
  #onColorSchemeChange = () => {
    const settings = this.#settings;
    if (settings && settings.theme === 'device') {
      this.#requestEditor();
    }
  };
  #menuEl = null;
  #railEl = null;
  #sideEl = null;
  #statusEl = null;
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
    if (service && typeof service.listDocuments === 'function') {
      this.#documents = service;
    }
    const settings = refs.services?.[SETTINGS_SERVICE] ?? null;
    if (settings && typeof settings.getSettings === 'function' && typeof settings.saveSettings === 'function') {
      this.#settingsApi = settings;
    }
  }

  eventTypes() {
    return [
      'click',
      'keydown',
      'menu-action',
      'view-select',
      'side-close',
      'outline-jump',
      'document-open',
      'document-create',
      'document-delete',
      'document-rename',
      'document-download',
      'document-properties',
      'settings-change',
      'settings-step',
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
      if (event.key === 'Escape' && (this.#confirmDeleteId !== null || this.#propsRecord !== null)) {
        this.#confirmDeleteId = null;
        this.#propsRecord = null;
        this.#requestEditor();
      }
      return;
    }
    if (event.type !== 'click') {
      const action = event.detail?.action;
      if (event.type === 'menu-action' && typeof action === 'string') {
        void this.#runMenuAction(action);
        return;
      }
      if (event.type === 'view-select' && typeof event.detail?.id === 'string') {
        this.#switchView(event.detail.id);
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
      if (event.type === 'document-delete') {
        this.#armDeleteConfirm(event.detail?.id);
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
      if (event.type === 'settings-change') {
        void this.#applySettingChange(event.detail?.key, event.detail?.value);
        return;
      }
      if (event.type === 'settings-step') {
        void this.#applySettingStep(event.detail?.key, event.detail?.delta);
        return;
      }
      return;
    }
    const target = event.target;
    if (target?.closest?.('[part="editor-host"]')) {
      this.#editor?.focus();
      return;
    }
    const confirmButton = target?.closest?.('[data-confirm-delete]');
    if (confirmButton) {
      if (confirmButton.getAttribute('data-confirm-delete') === 'yes') {
        void this.#deleteConfirmed();
      } else {
        this.#confirmDeleteId = null;
        this.#requestEditor();
      }
      return;
    }
    if (target?.closest?.('[data-close-props]')) {
      this.#propsRecord = null;
      this.#requestEditor();
      return;
    }
    if (target?.closest?.('[part="modal-backdrop"]') && !target?.closest?.('[part="modal-dialog"]')) {
      this.#confirmDeleteId = null;
      this.#propsRecord = null;
      this.#requestEditor();
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
    this.#watchColorScheme();
    queueMicrotask(() => void this.#initialLoad());
  }

  disconnectedCallback() {
    this.#clearSaveTimer();
    this.#unmountEditor();
    this.#unwatchColorScheme();
    this.#unwatchCenterScroll();
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
      if (center && center !== this.#centerEl) {
        this.#unwatchCenterScroll();
        this.#centerEl = center;
        center.addEventListener('scroll', this.#onCenterScroll, { passive: true });
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
   * Starts watching the operating-system color scheme so a `device` theme
   * remounts the editor when the system flips between light and dark.
   * @returns {void}
   */
  #watchColorScheme() {
    const matchMedia = globalThis.matchMedia;
    if (typeof matchMedia !== 'function' || this.#colorSchemeQuery) {
      return;
    }
    try {
      this.#colorSchemeQuery = matchMedia('(prefers-color-scheme: dark)');
      this.#colorSchemeQuery.addEventListener('change', this.#onColorSchemeChange);
    } catch {
      this.#colorSchemeQuery = null;
    }
  }

  #unwatchColorScheme() {
    try {
      this.#colorSchemeQuery?.removeEventListener('change', this.#onColorSchemeChange);
    } catch {
      // Listener removal is best-effort during teardown.
    }
    this.#colorSchemeQuery = null;
  }

  /**
   * Detaches the center-column scroll listener and drops a pending frame.
   * @returns {void}
   */
  #unwatchCenterScroll() {
    this.#centerEl?.removeEventListener('scroll', this.#onCenterScroll);
    if (this.#scrollFrame !== 0 && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(this.#scrollFrame);
    }
    this.#centerEl = null;
    this.#scrollFrame = 0;
  }

  /**
   * Reads the visible editor line and forwards it to the heading mapping.
   * The center column (not the editor scroller) scrolls in this layout, so
   * the measurement starts at the center top in viewport coordinates.
   * @returns {void}
   */
  #reportScrollPosition() {
    if (!this.isConnected || !this.#editor) {
      return;
    }
    const box = this.#centerEl?.getBoundingClientRect();
    const top = box && typeof box.top === 'number' ? box.top : 0;
    let line = 1;
    try {
      line = this.#editor.visibleLine(top);
    } catch {
      line = 1;
    }
    this.#handleVisibleLine(line);
  }

  /**
   * Resolves the editor color scheme from the stored theme.
   * @returns {string} 'dark', 'sepia' or 'light'.
   */
  #resolveColorScheme() {
    if (this.#settings?.theme === 'dark') {
      return 'dark';
    }
    if (this.#settings?.theme === 'sepia') {
      return 'sepia';
    }
    if (this.#settings?.theme === 'device') {
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
    return this.#editor?.getValue() ?? this.#draft ?? SAMPLE_DOCUMENT;
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
    this.#draft = text;
    this.#editor?.setDocument(text);
    this.#scheduleSave();
  }

  async #runMenuAction(action) {
    try {
      switch (action) {
        case 'new-document':
          await this.#createDocument();
          return;
        case 'delete-document':
          this.#armDeleteConfirm();
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
      ${this.#renderModal()}
    `;
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
    this.#menuEl = mountComponent({
      shadowRoot: this.shadowRoot,
      slot: '[data-slot="menubar"]',
      tag: 'parsi-menu-bar',
      infrastructure,
      refs: { t: this.#t, hasDocument: this.#currentId !== null },
      configure: (element) => element.configure({ hasDocument: this.#currentId !== null }),
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
          items: this.#items,
          currentId: this.#currentId,
          documentText: this.value,
          settings: this.#settings,
          formatNumber: (value) => this.#formatNumber(value),
        },
        configure: (element) => element.configure({
          activeView: this.#activeView,
          items: this.#items,
          currentId: this.#currentId,
          documentText: this.value,
          settings: this.#settings,
          activeLine: this.#outlineActiveLine,
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
  }

  /**
   * Renders the delete-confirmation modal for the pending document, if any.
   * @returns {string} Modal markup or ''.
   */
  #renderModal() {
    if (this.#confirmDeleteId !== null) {
      const pending = this.#items.find((item) => item.id === this.#confirmDeleteId) ?? null;
      return renderConfirmModal({
        t: this.#t,
        title: pending?.title ?? null,
        assetBaseUrl: this.#assetBaseUrl,
      });
    }
    if (this.#propsRecord !== null) {
      const record = this.#propsRecord;
      return renderPropertiesModal({
        t: this.#t,
        title: record.title ?? '',
        createdText: this.#formatDate(record.createdAt),
        updatedText: this.#formatDate(record.updatedAt),
        sizeText: formatFileSize(
          new TextEncoder().encode(record.content ?? '').length,
          (value) => this.#formatNumber(value),
          this.#t,
        ),
        assetBaseUrl: this.#assetBaseUrl,
      });
    }
    return '';
  }

  async #initialLoad() {
    if (!this.isConnected) {
      return;
    }
    await this.#loadSettings();
    if (!this.isConnected) {
      return;
    }
    if (!this.#documents) {
      this.#requestEditor();
      return;
    }
    try {
      const items = await this.#documents.listDocuments();
      if (!this.isConnected) {
        return;
      }
      if (items.length === 0) {
        const created = await this.#documents.saveDocument({
          title: this.#t('parsinegar.documents.welcome-title'),
          content: SAMPLE_DOCUMENT,
        });
        if (!this.isConnected) {
          return;
        }
        this.#applyDocument(created, [created]);
        return;
      }
      const opened = await this.#documents.openDocument(items[0].id);
      if (!this.isConnected) {
        return;
      }
      this.#applyDocument(opened ?? items[0], items);
    } catch (error) {
      console.error('[parsi-page-home] document load failed');
      this.#requestEditor();
    }
  }

  async #switchDocument(id) {
    if (!id || id === this.#currentId || !this.#documents) {
      return;
    }
    this.#confirmDeleteId = null;
    try {
      await this.#flushSave();
      if (!this.isConnected) {
        return;
      }
      const opened = await this.#documents.openDocument(id);
      if (!this.isConnected || !opened) {
        return;
      }
      const items = await this.#documents.listDocuments();
      if (!this.isConnected) {
        return;
      }
      this.#applyDocument(opened, items);
    } catch (error) {
      console.error('[parsi-page-home] document switch failed');
    }
  }

  async #createDocument() {
    if (!this.#documents) {
      return;
    }
    this.#confirmDeleteId = null;
    try {
      await this.#flushSave();
      if (!this.isConnected) {
        return;
      }
      const created = await this.#documents.createDocument(this.#t('parsinegar.documents.new-title'));
      if (!this.isConnected) {
        return;
      }
      const items = await this.#documents.listDocuments();
      if (!this.isConnected) {
        return;
      }
      this.#applyDocument({ ...created, content: '' }, items);
    } catch (error) {
      console.error('[parsi-page-home] document creation failed');
    }
  }

  /**
   * Arms the delete confirmation for the document named by the file menu
   * (or the current document when no id travels with the event, e.g. the
   * top menu-bar action). Re-render shows the question with the doc name.
   * @param {unknown} id Document id from the event detail.
   * @returns {void}
   */
  #armDeleteConfirm(id) {
    if (!this.#documents) {
      return;
    }
    const target = typeof id === 'string' && id.length > 0 ? id : this.#currentId;
    if (!target) {
      return;
    }
    this.#confirmDeleteId = target;
    this.#propsRecord = null;
    this.#requestEditor();
  }

  /**
   * Renames a document through the service, keeping the inline editor open
   * with an error when the title is taken. Empty titles cancel silently.
   * @param {unknown} id Document id from the event detail.
   * @param {unknown} title New title from the event detail.
   * @returns {Promise<void>}
   */
  async #renameDocument(id, title) {
    if (!this.#documents || typeof id !== 'string' || id.length === 0) {
      return;
    }
    const next = typeof title === 'string' ? title.trim() : '';
    if (next.length === 0) {
      this.#sideEl?.cancelRename();
      return;
    }
    try {
      const saved = await this.#documents.renameDocument(id, next);
      if (!this.isConnected || !saved) {
        return;
      }
      if (id === this.#currentId) {
        this.#docTitle = saved.title;
      }
      this.#items = await this.#documents.listDocuments();
      if (!this.isConnected) {
        return;
      }
      this.#sideEl?.cancelRename();
      this.#requestEditor();
    } catch (error) {
      if (error?.code === 'DOCUMENT_TITLE_DUPLICATE') {
        this.#sideEl?.configure({ renameError: 'parsinegar.documents.duplicate' });
        return;
      }
      console.error('[parsi-page-home] document rename failed');
      this.#sideEl?.cancelRename();
    }
  }

  /**
   * Downloads a document as a Markdown file through a temporary anchor in
   * the page shadow (released right after the click).
   * @param {unknown} id Document id from the event detail.
   * @returns {Promise<void>}
   */
  async #downloadDocument(id) {
    if (!this.#documents || typeof id !== 'string' || id.length === 0) {
      return;
    }
    if (typeof URL.createObjectURL !== 'function') {
      console.error('[parsi-page-home] download is unsupported here');
      return;
    }
    try {
      const record = await this.#documents.openDocument(id);
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
    if (!this.#documents) {
      return;
    }
    try {
      const record = await this.#documents.openDocument(id);
      if (!this.isConnected || !record) {
        return;
      }
      this.#confirmDeleteId = null;
      this.#propsRecord = record;
      this.#requestEditor();
    } catch (error) {
      console.error('[parsi-page-home] properties load failed');
    }
  }

  /**
   * Deletes the confirmed document. Removing the open document switches to
   * the most recent survivor (or a fresh one); removing a background
   * document leaves the editor untouched.
   * @returns {Promise<void>}
   */
  async #deleteConfirmed() {
    if (!this.#documents) {
      return;
    }
    const removedId = this.#confirmDeleteId ?? this.#currentId;
    if (!removedId) {
      return;
    }
    const removingCurrent = removedId === this.#currentId;
    if (removingCurrent) {
      this.#clearSaveTimer();
    }
    this.#confirmDeleteId = null;
    try {
      await this.#documents.deleteDocument(removedId);
      if (!this.isConnected) {
        return;
      }
      const items = await this.#documents.listDocuments();
      if (!this.isConnected) {
        return;
      }
      if (!removingCurrent) {
        // A background document went away: keep editing the current one
        // (timer, focus and undo stay alive) and only refresh the list.
        this.#items = items;
        this.#requestEditor();
        return;
      }
      if (items.length === 0) {
        const created = await this.#documents.saveDocument({
          title: this.#t('parsinegar.documents.new-title'),
          content: '',
        });
        if (!this.isConnected) {
          return;
        }
        this.#applyDocument(created, [created]);
        return;
      }
      const opened = await this.#documents.openDocument(items[0].id);
      if (!this.isConnected) {
        return;
      }
      this.#applyDocument(opened ?? items[0], items);
    } catch (error) {
      console.error('[parsi-page-home] document deletion failed');
    }
  }

  /**
   * Loads stored preferences before the first editor mount. A failed load
   * keeps the built-in fallbacks (rtl, 16px) and never blocks documents.
   * @returns {Promise<void>}
   */
  async #loadSettings() {
    if (!this.#settingsApi) {
      return;
    }
    try {
      const settings = await this.#settingsApi.getSettings();
      if (!this.isConnected) {
        return;
      }
      this.#settings = settings;
      this.#documentDirection = settings.direction;
      this.#fontSize = settings.fontSize;
    } catch (error) {
      console.error('[parsi-page-home] settings load failed');
    }
  }

  #applyDocument(document, items) {
    this.#unmountEditor();
    this.#items = items;
    this.#currentId = document.id;
    this.#docTitle = document.title ?? '';
    this.#draft = document.content ?? '';
    this.#outlineActiveLine = null;
    this.#requestEditor();
  }

  /**
   * Maps a visible editor line to its heading and pushes highlight changes
   * to the side panel. Re-renders only when the active heading changes, so
   * scroll bursts stay cheap and never steal focus.
   * @param {unknown} line First visible 1-based line number.
   * @returns {void}
   */
  #handleVisibleLine(line) {
    if (!this.isConnected || !Number.isInteger(line) || line < 1) {
      return;
    }
    let active = null;
    for (const heading of parseOutline(this.value)) {
      if (heading.line <= line) {
        active = heading.line;
      } else {
        break;
      }
    }
    if (active !== this.#outlineActiveLine) {
      this.#outlineActiveLine = active;
      this.#sideEl?.configure({ activeLine: active });
    }
  }

  /**
   * Queues a settings write behind earlier ones so rapid changes apply in
   * order instead of racing on stale reads. The chain itself never rejects;
   * the caller still sees the real outcome.
   * @param {Function} task Async write task.
   * @returns {Promise} Task outcome.
   */
  #chainSettingWrite(task) {
    const run = this.#settingsWrite.then(task, task);
    this.#settingsWrite = run.catch(() => {});
    return run;
  }

  /**
   * Persists one radio-group setting (theme or direction) and applies the
   * saved result. Theme reaches the shell through the `settings:changed`
   * domain event handled by the entry point; direction remounts the editor.
   * @param {unknown} key Setting key from the event detail.
   * @param {unknown} value Setting value from the event detail.
   * @returns {Promise<void>}
   */
  async #applySettingChange(key, value) {
    if (!this.#settingsApi || (key !== 'theme' && key !== 'direction')) {
      return;
    }
    if (typeof value !== 'string' || value.length === 0) {
      return;
    }
    try {
      await this.#chainSettingWrite(async () => {
        const saved = await this.#settingsApi.saveSettings({ [key]: value });
        if (!this.isConnected) {
          return;
        }
        this.#settings = saved;
        this.#documentDirection = saved.direction;
        this.#fontSize = saved.fontSize;
        this.#requestEditor();
      });
    } catch (error) {
      console.error('[parsi-page-home] setting save failed');
    }
  }

  /**
   * Persists one font-size step and remounts the editor with the saved size.
   * Out-of-range steps reject in the service and leave everything unchanged.
   * @param {unknown} key Setting key from the event detail.
   * @param {unknown} delta Step delta from the event detail.
   * @returns {Promise<void>}
   */
  async #applySettingStep(key, delta) {
    if (!this.#settingsApi || key !== 'fontSize') {
      return;
    }
    const step = Number(delta);
    if (step !== 1 && step !== -1) {
      return;
    }
    try {
      await this.#chainSettingWrite(async () => {
        const saved = await this.#settingsApi.saveSettings({ fontSize: this.#fontSize + step });
        if (!this.isConnected) {
          return;
        }
        this.#settings = saved;
        this.#documentDirection = saved.direction;
        this.#fontSize = saved.fontSize;
        this.#requestEditor();
      });
    } catch (error) {
      console.error('[parsi-page-home] setting save failed');
    }
  }

  #requestEditor() {
    this.#unmountEditor();
    this.#ensureRenderObserver();
    this.requestRender();
  }

  #scheduleSave() {
    if (!this.#documents || !this.#currentId) {
      return;
    }
    this.#clearSaveTimer();
    this.#saveTimer = setTimeout(() => void this.#saveNow(), AUTOSAVE_DELAY_MS);
  }

  async #flushSave() {
    if (!this.#saveTimer) {
      return;
    }
    this.#clearSaveTimer();
    await this.#saveNow();
  }

  async #saveNow() {
    this.#clearSaveTimer();
    if (!this.#documents || !this.#currentId || !this.isConnected) {
      return;
    }
    try {
      const saved = await this.#documents.saveDocument({
        id: this.#currentId,
        title: this.#docTitle,
        content: this.#editor?.getValue() ?? this.#draft ?? '',
      });
      void saved;
      this.#items = await this.#documents.listDocuments();
    } catch (error) {
      console.error('[parsi-page-home] autosave failed');
    }
  }

  #clearSaveTimer() {
    if (this.#saveTimer !== null) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
  }

  /**
   * Formats a number for the active language, falling back to plain text
   * when no formatter was handed down.
   * @param {number} value Number value.
   * @returns {string} Formatted number.
   */
  #formatNumber(value) {
    if (typeof this.#format === 'function') {
      try {
        return this.#format(value, 'number', {});
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  /**
   * Formats a timestamp for the active language, falling back to ISO text
   * when no formatter was handed down.
   * @param {number} value Epoch milliseconds.
   * @returns {string} Formatted date and time.
   */
  #formatDate(value) {
    const time = new Date(value);
    if (Number.isNaN(time.getTime())) {
      return String(value ?? '');
    }
    if (typeof this.#format === 'function') {
      try {
        return this.#format(time, 'dateTime', {});
      } catch {
        return time.toISOString();
      }
    }
    return time.toISOString();
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
    this.#sideEl?.configure({
      activeView: this.#activeView,
      items: this.#items,
      currentId: this.#currentId,
      documentText: this.value,
      settings: this.#settings,
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
        document: this.#draft ?? SAMPLE_DOCUMENT,
        label: this.#t('parsinegar.editor.label'),
        direction: this.#documentDirection,
        fontSize: this.#fontSize,
        colorScheme: this.#resolveColorScheme(),
        onChange: (value) => {
          this.#draft = value;
          this.dispatchEvent(
            new CustomEvent(CHANGE_EVENT, {
              bubbles: true,
              composed: true,
              detail: { value },
            }),
          );
          this.#pushLiveUpdates();
          this.#scheduleSave();
        },
      });
      this.#editorHost = host;
      this.#reportScrollPosition();
    } catch (error) {
      this.#editor = null;
      this.#editorHost = null;
      throw error;
    }
  }

  #unmountEditor() {
    if (this.#editor) {
      this.#draft = this.#editor.getValue();
      this.#editor.destroy();
      this.#editor = null;
    }
    this.#editorHost = null;
  }
}

customElements.define(TAG, ParsiPageHome);

export { ParsiPageHome, TAG };
