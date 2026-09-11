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
import { createIconMarkup } from 'pey.webui/base/icon-sprite';
import { PeyElement } from 'pey.webui/base/pey-element';
import { createMarkdownView } from '../../components/editor/markdown-view.js';
import SAMPLE_DOCUMENT from '../../sample-document.js';
import { buildMenuModel } from '../../components/workbench/menubar.js';
import { countStats } from '../../components/workbench/stats.js';
import { FILES_VIEW, getView, listViews } from '../../components/workbench/views.js';

const TAG = 'parsi-page-home';
const CHANGE_EVENT = 'parsi-page-home:change';
const DOCUMENTS_SERVICE = 'parsinegar.documents.service';
const AUTOSAVE_DELAY_MS = 1000;

/**
 * Escapes user content for safe template interpolation.
 * @param {string} value Raw text.
 * @returns {string} Escaped text.
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class ParsiPageHome extends PeyElement {
  #t = (key) => key;
  #assetBaseUrl = null;
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

  onConnect(refs = {}) {
    if (typeof refs.t === 'function') {
      this.#t = refs.t;
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
    // The base class flushes render() in a microtask queued inside
    // connectedCallback; loading and mounting wait for their own turn.
    queueMicrotask(() => void this.#initialLoad());
  }

  disconnectedCallback() {
    this.#clearSaveTimer();
    this.#unmountEditor();
    super.disconnectedCallback();
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

  #railIcon(symbol) {
    if (!this.#assetBaseUrl) {
      return '';
    }
    try {
      return createIconMarkup(this.#assetBaseUrl, symbol);
    } catch {
      return '';
    }
  }

  #renderRail() {
    const buttons = listViews().map((view) => `
      <button type="button" part="rail-button" data-view="${view.id}" aria-pressed="${view.id === this.#activeView}" aria-label="${escapeHtml(this.#t(view.labelKey))}" title="${escapeHtml(this.#t(view.labelKey))}">${this.#railIcon(view.icon)}<span part="rail-fallback">${escapeHtml(this.#t(view.labelKey))}</span></button>`).join('');
    return `<nav part="rail" aria-label="${escapeHtml(this.#t('parsinegar.app.title'))}">${buttons}</nav>`;
  }

  #renderSide() {
    if (!this.#sideOpen) {
      return '';
    }
    const view = getView(this.#activeView) ?? getView(FILES_VIEW);
    return `
      <aside part="side">
        <div part="side-header">
          <h2 part="side-title">${escapeHtml(this.#t(view.labelKey))}</h2>
          <button type="button" part="side-close" aria-label="${escapeHtml(this.#t('parsinegar.views.close'))}">×</button>
        </div>
        <div part="side-body">${view.render({ t: this.#t, items: this.#items, currentId: this.#currentId, documentText: this.value })}</div>
      </aside>`;
  }

  #renderMenubar() {
    const menus = buildMenuModel({ t: this.#t, hasDocument: this.#currentId !== null });
    const markup = menus.map((menu) => {
      const open = this.#openMenu === menu.id;
      return `
        <div part="menu">
          <button type="button" part="menu-button" data-menu="${menu.id}" aria-haspopup="true" aria-expanded="${open}">${escapeHtml(menu.label)}</button>
          <div part="menu-dropdown" role="menu" ${open ? '' : 'hidden'}>${menu.items.map((item) => `
            <button type="button" part="menu-item" role="menuitem" data-action="${item.id}" ${item.disabled ? 'disabled' : ''}>${escapeHtml(item.label)}</button>`).join('')}
          </div>
        </div>`;
    }).join('');
    return `<div part="menubar" role="menubar">${markup}</div>`;
  }

  #renderStatusbar() {
    if (!this.#bottomOpen) {
      return '';
    }
    const stats = countStats(this.value);
    return `
      <footer part="statusbar">
        <span part="stat"><b part="stat-value" data-stat="chars">${stats.chars}</b> ${escapeHtml(this.#t('parsinegar.stats.chars'))}</span>
        <span part="stat"><b part="stat-value" data-stat="words">${stats.words}</b> ${escapeHtml(this.#t('parsinegar.stats.words'))}</span>
        <span part="stat"><b part="stat-value" data-stat="lines">${stats.lines}</b> ${escapeHtml(this.#t('parsinegar.stats.lines'))}</span>
      </footer>`;
  }

  render() {
    return `
      <style>
        :host {
          display: block;
          padding: 1rem 1rem 2rem;
        }
        [part="title"] {
          font-size: 1.5rem;
          margin: 0 0 0.25rem;
        }
        [part="subtitle"] {
          margin: 0 0 1rem;
          opacity: 0.75;
        }
        [part="workbench"] {
          display: grid;
          grid-template-columns: auto minmax(12rem, 17rem) minmax(0, 1fr);
          grid-template-areas:
            "menubar menubar menubar"
            "rail side center"
            "status status status";
          gap: 0.75rem;
          align-items: start;
        }
        [part="menubar"] {
          grid-area: menubar;
          display: flex;
          gap: 0.25rem;
        }
        [part="menu"] {
          position: relative;
        }
        [part="menu-button"] {
          font: inherit;
          border: 1px solid transparent;
          border-radius: 8px;
          background-color: transparent;
          padding: 0.35rem 0.8rem;
          cursor: pointer;
          color: inherit;
        }
        [part="menu-button"][aria-expanded="true"] {
          border-color: #c8c8d2;
          background-color: #ffffff;
        }
        [part="menu-dropdown"] {
          position: absolute;
          inset-block-start: calc(100% + 0.25rem);
          inset-inline-start: 0;
          min-inline-size: 11rem;
          z-index: 10;
          display: flex;
          flex-direction: column;
          padding: 0.3rem;
          border: 1px solid #e2e2e8;
          border-radius: 10px;
          background-color: #ffffff;
          box-shadow: 0 8px 24px rgb(0 0 0 / 0.1);
        }
        [part="menu-dropdown"][hidden] {
          display: none;
        }
        [part="menu-item"] {
          font: inherit;
          text-align: start;
          border: 0;
          border-radius: 6px;
          background-color: transparent;
          padding: 0.4rem 0.6rem;
          cursor: pointer;
          color: inherit;
        }
        [part="menu-item"]:hover {
          background-color: #f1f1f5;
        }
        [part="menu-item"][disabled] {
          opacity: 0.45;
          cursor: default;
        }
        [part="rail"] {
          grid-area: rail;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        [part="rail-button"] {
          font: inherit;
          display: flex;
          align-items: center;
          justify-content: center;
          inline-size: 2.75rem;
          block-size: 2.75rem;
          border: 1px solid transparent;
          border-radius: 8px;
          background-color: transparent;
          cursor: pointer;
          color: inherit;
        }
        [part="rail-button"] svg {
          inline-size: 1.4rem;
          block-size: 1.4rem;
        }
        [part="rail-fallback"] {
          display: none;
        }
        [part="rail-button"][aria-pressed="true"] {
          border-color: #c8c8d2;
          background-color: #ffffff;
        }
        [part="side"] {
          grid-area: side;
          border: 1px solid #e2e2e8;
          border-radius: 12px;
          background-color: #ffffff;
          overflow: hidden;
        }
        [part="side-header"] {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.6rem 0.8rem;
          border-block-end: 1px solid #ececf1;
        }
        [part="side-title"] {
          font-size: 1rem;
          margin: 0;
        }
        [part="side-body"] {
          padding: 0.6rem 0.8rem;
          max-block-size: 60vh;
          overflow: auto;
        }
        [part="center"] {
          grid-area: center;
          min-inline-size: 0;
        }
        [part="doc-title"] {
          inline-size: 100%;
          box-sizing: border-box;
          font: inherit;
          font-weight: 700;
          padding: 0.4rem 0.6rem;
          margin-block-end: 0.75rem;
          border: 1px solid #d8d8de;
          border-radius: 8px;
          background-color: #ffffff;
        }
        [part="editor-host"] {
          overflow: hidden;
          background-color: #ffffff;
          border: 1px solid #e2e2e8;
          border-radius: 12px;
          box-shadow: 0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px rgb(0 0 0 / 0.07);
          padding: 2rem 2.25rem;
          cursor: text;
        }
        [part="editor-host"] .cm-editor {
          min-block-size: 65vh;
        }
        [part="statusbar"] {
          grid-area: status;
          display: flex;
          gap: 1.25rem;
          padding: 0.45rem 0.9rem;
          border: 1px solid #e2e2e8;
          border-radius: 10px;
          background-color: #ffffff;
          font-size: 0.85rem;
        }
        [part="stat-value"] {
          font-weight: 700;
        }
      </style>
      <h1 part="title">${this.#t('parsinegar.app.title')}</h1>
      <p part="subtitle">${this.#t('parsinegar.app.subtitle')}</p>
      <div part="workbench">
        ${this.#renderMenubar()}
        ${this.#renderRail()}
        ${this.#renderSide()}
        <div part="center">
          <input part="doc-title" value="${escapeHtml(this.#docTitle)}" aria-label="${escapeHtml(this.#t('parsinegar.documents.title-label'))}" />
          <div part="editor-host"></div>
        </div>
        ${this.#renderStatusbar()}
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
  }

  async #createDocument() {
    if (!this.#documents) {
      return;
    }
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
  }

  async #deleteCurrent() {
    if (!this.#documents || !this.#currentId) {
      return;
    }
    const removedId = this.#currentId;
    this.#clearSaveTimer();
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
    this.requestRender();
    queueMicrotask(() => this.#mountEditor());
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
      const index = this.#items.findIndex((item) => item.id === saved.id);
      if (index >= 0) {
        this.#items[index] = saved;
      } else {
        this.#items.unshift(saved);
      }
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

  #syncStats() {
    if (!this.#bottomOpen) {
      return;
    }
    const stats = countStats(this.value);
    for (const [key, value] of Object.entries({ chars: stats.chars, words: stats.words, lines: stats.lines })) {
      this.shadowRoot.querySelector(`[data-stat="${key}"]`)?.replaceChildren(String(value));
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
    this.#editor = createMarkdownView(host, {
      document: this.#draft ?? SAMPLE_DOCUMENT,
      label: this.#t('parsinegar.editor.label'),
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
  }

  #unmountEditor() {
    if (this.#editor) {
      this.#draft = this.#editor.getValue();
      this.#editor.destroy();
      this.#editor = null;
    }
  }
}

customElements.define(TAG, ParsiPageHome);

export { ParsiPageHome, TAG };
