// Home page: workbench with menu bar, activity rail, switchable side panel,
// editor and live status bar. The page (connected by the kit page host)
// renders all regions in its single template and mounts the CodeMirror view
// into the editor host; CodeMirror needs a live DOM node, so mounting happens
// after render and release in disconnectedCallback. Views render through the
// side-panel registry, which holds only metadata and references — each view
// owns its markup. Document titles are user content and are always escaped
// before entering the template. Status numbers sync imperatively on change
// (same values render() produces) so typing never drops editor focus.
// All DOM event handling stays declarative on PeyElement.
import { PeyElement } from 'pey.webui/base/pey-element';
import { createMarkdownView } from '../../components/editor/markdown-view.js';
import SAMPLE_DOCUMENT from '../../sample-document.js';
import { countStats } from '../../components/workbench/stats.js';
import { escapeHtml } from '../../components/workbench/html.js';
import { FILES_VIEW, getView } from '../../components/workbench/views.js';
import { renderMenubar, renderRail, renderSide, renderStatusbar } from '../../components/workbench/regions.js';

const TAG = 'parsi-page-home';
const CHANGE_EVENT = 'parsi-page-home:changed';
const DOCUMENTS_SERVICE = 'parsinegar.documents.service';
const AUTOSAVE_DELAY_MS = 1000;
const STYLE_URL = new URL('./home.css', import.meta.url).href;

class ParsiPageHome extends PeyElement {
  #t = (key) => key;
  #format = null;
  #assetBaseUrl = null;
  #direction = 'rtl';
  #documents = null;
  #editor = null;
  #items = [];
  #currentId = null;
  #docTitle = '';
  #draft = null;
  #saveTimer = null;
  #activeView = FILES_VIEW;
  #sideOpen = true;
  #bottomOpen = true;
  #openMenu = null;
  #renderObserver = null;
  #editorHost = null;

  onConnect(refs = {}) {
    if (typeof refs.t === 'function') {
      this.#t = refs.t;
    }
    if (typeof refs.format === 'function') {
      this.#format = refs.format;
    }
    if (refs.direction === 'ltr' || refs.direction === 'rtl') {
      this.#direction = refs.direction;
    }
    if (typeof refs.assetBaseUrl === 'string' && refs.assetBaseUrl.length > 0) {
      this.#assetBaseUrl = refs.assetBaseUrl;
    }
    const service = refs.services?.[DOCUMENTS_SERVICE] ?? null;
    if (service && typeof service.listDocuments === 'function') {
      this.#documents = service;
    }
  }

  eventTypes() {
    return ['click', 'input', 'keydown'];
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
    if (event.type === 'input' && event.target?.matches?.('[part="doc-title"]')) {
      this.#docTitle = event.target.value;
      this.#scheduleSave();
      return;
    }
    if (event.type === 'keydown') {
      if (event.key === 'Escape' && this.#openMenu !== null) {
        this.#openMenu = null;
        this.#syncMenu();
      }
      return;
    }
    if (event.type !== 'click') {
      return;
    }
    const target = event.target;
    if (this.#openMenu !== null && !target?.closest?.('[part="menubar"]')) {
      this.#openMenu = null;
      this.#syncMenu();
      return;
    }
    const menuButton = target?.closest?.('[data-menu]');
    if (menuButton) {
      const id = menuButton.getAttribute('data-menu');
      this.#openMenu = this.#openMenu === id ? null : id;
      this.#syncMenu();
      return;
    }
    const menuItem = target?.closest?.('[data-action]');
    if (menuItem && !menuItem.disabled) {
      this.#openMenu = null;
      this.#syncMenu();
      void this.#runMenuAction(menuItem.getAttribute('data-action'));
      return;
    }
    if (target?.closest?.('[part="editor-host"]')) {
      this.#editor?.focus();
      return;
    }
    const railButton = target?.closest?.('[data-view]');
    if (railButton) {
      this.#switchView(railButton.getAttribute('data-view'));
      return;
    }
    if (target?.closest?.('[part="side-close"]')) {
      this.#sideOpen = false;
      this.#requestEditor();
      return;
    }
    const outlineButton = target?.closest?.('[data-line]');
    if (outlineButton) {
      this.#editor?.gotoLine(Number(outlineButton.getAttribute('data-line')));
      return;
    }
    const openButton = target?.closest?.('[data-doc-id]');
    if (openButton) {
      void this.#switchDocument(openButton.getAttribute('data-doc-id'));
      return;
    }
    if (target?.closest?.('[part="docs-new"]')) {
      void this.#createDocument();
      return;
    }
    if (target?.closest?.('[part="docs-delete"]')) {
      void this.#deleteCurrent();
    }
  }

  connectedCallback() {
    super.connectedCallback();
    // The base class flushes render() on its own schedule — synchronously for
    // plain templates, asynchronously when gated on the external stylesheet.
    // Mounting CodeMirror needs the live host node, so instead of guessing
    // microtask order, observe render completion and mount then.
    this.#ensureRenderObserver();
    queueMicrotask(() => void this.#initialLoad());
  }

  disconnectedCallback() {
    this.#clearSaveTimer();
    this.#unmountEditor();
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
          await this.#deleteCurrent();
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
          return;
      }
    } catch (error) {
      console.error('[parsi-page-home] menu action failed');
    }
  }

  /**
   * Syncs menu dropdown visibility without a full render, so the editor
   * (and its undo history) survives menu interaction. Only visibility and
   * expansion state change; no content is mutated.
   * @returns {void}
   */
  #syncMenu() {
    for (const button of this.shadowRoot.querySelectorAll('[data-menu]')) {
      const open = button.getAttribute('data-menu') === this.#openMenu;
      button.setAttribute('aria-expanded', String(open));
      button.parentElement?.querySelector('[part="menu-dropdown"]')?.toggleAttribute('hidden', !open);
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
    return `
      <div part="workbench">
        ${renderMenubar({ t: this.#t, openMenu: this.#openMenu, hasDocument: this.#currentId !== null })}
        ${renderRail({ t: this.#t, assetBaseUrl: this.#assetBaseUrl, activeView: this.#activeView })}
        ${renderSide({ t: this.#t, activeView: this.#activeView, sideOpen: this.#sideOpen, items: this.#items, currentId: this.#currentId, documentText: this.value })}
        <div part="center">
          <input part="doc-title" value="${escapeHtml(this.#docTitle)}" aria-label="${escapeHtml(this.#t('parsinegar.documents.title-label'))}" />
          <div part="editor-host"></div>
        </div>
        ${renderStatusbar({ t: this.#t, bottomOpen: this.#bottomOpen, stats: countStats(this.value), formatNumber: (value) => this.#formatNumber(value) })}
      </div>
    `;
  }

  async #initialLoad() {
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

  async #deleteCurrent() {
    if (!this.#documents || !this.#currentId) {
      return;
    }
    const removedId = this.#currentId;
    this.#clearSaveTimer();
    try {
      await this.#documents.deleteDocument(removedId);
      if (!this.isConnected) {
        return;
      }
      const items = await this.#documents.listDocuments();
      if (!this.isConnected) {
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

  #applyDocument(document, items) {
    this.#unmountEditor();
    this.#items = items;
    this.#currentId = document.id;
    this.#docTitle = document.title ?? '';
    this.#draft = document.content ?? '';
    this.#requestEditor();
  }

  #requestEditor() {
    this.#openMenu = null;
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

  #syncStats() {
    if (!this.#bottomOpen) {
      return;
    }
    const stats = countStats(this.value);
    for (const [key, value] of Object.entries({ chars: stats.chars, words: stats.words, lines: stats.lines })) {
      this.shadowRoot.querySelector(`[data-stat="${key}"]`)?.replaceChildren(this.#formatNumber(value));
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
        document: this.#draft ?? SAMPLE_DOCUMENT,
        label: this.#t('parsinegar.editor.label'),
        direction: this.#direction,
        onChange: (value) => {
          this.#draft = value;
          this.dispatchEvent(
            new CustomEvent(CHANGE_EVENT, {
              bubbles: true,
              composed: true,
              detail: { value },
            }),
          );
          this.#syncStats();
          this.#scheduleSave();
        },
      });
      this.#editorHost = host;
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
