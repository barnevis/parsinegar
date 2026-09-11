// Home page: workbench with activity rail, switchable side panel and editor.
// The page (connected by the kit page host) renders all regions in its single
// template and mounts the CodeMirror view into the editor host; CodeMirror
// needs a live DOM node, so mounting happens after render and release in
// disconnectedCallback. Views render through the side-panel registry, which
// holds only metadata and references — each view owns its markup. Document
// titles are user content and are always escaped before entering the template.
// All DOM event handling stays declarative on PeyElement.
import { createIconMarkup } from 'pey.webui/base/icon-sprite';
import { PeyElement } from 'pey.webui/base/pey-element';
import { createMarkdownView } from '../../components/editor/markdown-view.js';
import SAMPLE_DOCUMENT from '../../sample-document.js';
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
    return ['click', 'input'];
  }

  handleEvent(event) {
    if (event.type === 'input' && event.target?.matches?.('[part="doc-title"]')) {
      this.#docTitle = event.target.value;
      this.#scheduleSave();
      return;
    }
    if (event.type !== 'click') {
      return;
    }
    const target = event.target;
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
          gap: 0.75rem;
          align-items: start;
        }
        [part="rail"] {
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
      </style>
      <h1 part="title">${this.#t('parsinegar.app.title')}</h1>
      <p part="subtitle">${this.#t('parsinegar.app.subtitle')}</p>
      <div part="workbench">
        ${this.#renderRail()}
        ${this.#renderSide()}
        <div part="center">
          <input part="doc-title" value="${escapeHtml(this.#docTitle)}" aria-label="${escapeHtml(this.#t('parsinegar.documents.title-label'))}" />
          <div part="editor-host"></div>
        </div>
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
