// Home page: document list plus the Persian Markdown editor.
//
// The page (connected by the kit page host) renders the document chrome and
// the editor host node in its template and mounts the CodeMirror view into
// it; CodeMirror needs a live DOM node, so mounting happens after render and
// release in disconnectedCallback. Document titles are user content and are
// always escaped before entering the template. All DOM event handling stays
// declarative on PeyElement.
import { PeyElement } from 'pey.webui/base/pey-element';
import { createMarkdownView } from '../../components/editor/markdown-view.js';
import SAMPLE_DOCUMENT from '../../sample-document.js';

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
  #documents = null;
  #editor = null;
  #items = [];
  #currentId = null;
  #docTitle = '';
  #draft = null;
  #saveTimer = null;

  onConnect(refs = {}) {
    if (typeof refs.t === 'function') {
      this.#t = refs.t;
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

  render() {
    const items = this.#items.map((item) => `
      <li part="docs-item">
        <button type="button" part="docs-open" data-doc-id="${escapeHtml(item.id)}" ${item.id === this.#currentId ? 'aria-current="true"' : ''}>${escapeHtml(item.title)}</button>
      </li>`).join('');
    return `
      <style>
        :host {
          display: block;
          max-inline-size: 60rem;
          margin-inline: auto;
          padding: 1.5rem 1rem 3rem;
        }
        [part="title"] {
          font-size: 1.75rem;
          margin: 0 0 0.25rem;
        }
        [part="subtitle"] {
          margin: 0 0 1.5rem;
          opacity: 0.75;
        }
        [part="docs"] {
          margin: 0 0 1rem;
        }
        [part="docs-heading"] {
          font-size: 1rem;
          margin: 0 0 0.5rem;
        }
        [part="docs-bar"] {
          display: flex;
          gap: 0.5rem;
          margin-block-end: 0.5rem;
        }
        [part="doc-title"] {
          flex: 1;
          font: inherit;
          padding: 0.4rem 0.6rem;
          border: 1px solid #d8d8de;
          border-radius: 8px;
          background-color: #ffffff;
        }
        [part="docs-list"] {
          list-style: none;
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
          margin: 0;
          padding: 0;
        }
        [part="docs-open"][aria-current="true"] {
          font-weight: 700;
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
      <section part="docs">
        <h2 part="docs-heading">${this.#t('parsinegar.documents.title')}</h2>
        <div part="docs-bar">
          <input part="doc-title" value="${escapeHtml(this.#docTitle)}" aria-label="${escapeHtml(this.#t('parsinegar.documents.title-label'))}" />
          <button type="button" part="docs-new">${this.#t('parsinegar.documents.new')}</button>
          <button type="button" part="docs-delete">${this.#t('parsinegar.documents.delete')}</button>
        </div>
        <ul part="docs-list">${items}</ul>
      </section>
      <div part="editor-host"></div>
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
