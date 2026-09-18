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
import { outlineSignature } from '../workbench/outline.js';

const TAG = 'parsi-side-panel';
const STYLE_URL = new URL('./side-panel.css', import.meta.url).href;

class ParsiSidePanel extends PeyElement {
  #t = (key) => key;
  #assetBaseUrl = null;
  #formatNumber = null;
  #onDocumentClick = (event) => {
    if (this.#openFileMenu === null) {
      return;
    }
    if (event.composedPath().includes(this)) {
      return;
    }
    this.#openFileMenu = null;
    this.requestRender();
  };
  #onDocumentKeydown = (event) => {
    if (event.key === 'Escape' && this.#openFileMenu !== null) {
      this.#openFileMenu = null;
      this.requestRender();
    }
  };
  #activeView = FILES_VIEW;
  #items = [];
  #currentId = null;
  #documentText = '';
  #settings = null;
  #activeLine = null;
  #openFileMenu = null;
  #editingId = null;
  #renameError = null;
  #collapsedLines = new Set();
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
   * Stores panel data fields, returning the full snapshot.
   * @param {object} data Partial data.
   * @returns {object} Snapshot with signature.
   */
  #store({ activeView, items, currentId, documentText, settings, activeLine, renameError } = {}) {
    if (typeof activeView === 'string') {
      this.#activeView = activeView;
    }
    if (Array.isArray(items)) {
      this.#items = items;
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
    return {
      activeView: this.#activeView,
      items: this.#items,
      currentId: this.#currentId,
      documentText: this.#documentText,
      settings: this.#settings,
      activeLine: this.#activeLine,
      openFileMenu: this.#openFileMenu,
      editingId: this.#editingId,
      renameError: this.#renameError,
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
   * Updates panel data, re-rendering only when the visible output would
   * change. Snapshots are compared by identity except the outline signature,
   * so per-keystroke updates from the parent stay cheap and never steal
   * scroll or focus.
   * @param {object} data New data (absent fields keep current values).
   * @param {string} [data.activeView] Active view id.
   * @param {Array<object>} [data.items] Documents for the files view.
   * @param {string|null} [data.currentId] Open document id.
   * @param {string} [data.documentText] Current document text for text views.
   * @param {object|null} [data.settings] Preferences for the settings view.
   * @param {number|null} [data.activeLine] Highlighted outline heading line.
   * @param {string|null} [data.renameError] Translation key for a rename failure.
   * @returns {void}
   */
  configure({ activeView, items, currentId, documentText, settings, activeLine, renameError } = {}) {
    const next = this.#store({ activeView, items, currentId, documentText, settings, activeLine, renameError });
    const prev = this.#applied;
    // Collapsed lines refer to line numbers, so a changed document (new
    // signature) invalidates them.
    if (prev !== null && prev.signature !== next.signature && this.#collapsedLines.size > 0) {
      this.#collapsedLines.clear();
      next.collapsed = '';
    }
    const same = prev !== null
      && prev.activeView === next.activeView
      && prev.items === next.items
      && prev.currentId === next.currentId
      && prev.settings === next.settings
      && prev.activeLine === next.activeLine
      && prev.openFileMenu === next.openFileMenu
      && prev.editingId === next.editingId
      && prev.renameError === next.renameError
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
    if (event.target?.closest?.('[part="docs-new"]')) {
      this.dispatchEvent(new CustomEvent('document-create', { bubbles: true, composed: true }));
      return;
    }
    const menuButton = event.target?.closest?.('[data-doc-menu]');
    if (menuButton) {
      const id = menuButton.getAttribute('data-doc-menu');
      this.#openFileMenu = this.#openFileMenu === id ? null : id;
      this.requestRender();
      return;
    }
    const menuAction = event.target?.closest?.('[data-file-rename],[data-file-download],[data-file-properties],[data-file-delete]');
    if (menuAction) {
      const renameId = menuAction.getAttribute('data-file-rename');
      if (renameId !== null) {
        this.#editingId = renameId;
        this.#renameError = null;
        this.#openFileMenu = null;
        this.requestRender();
        return;
      }
      if (menuAction.hasAttribute('data-file-download')) {
        this.#emitFileAction('document-download', menuAction);
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
    return `
      <aside part="side">
        <div part="side-header">
          <h2 part="side-title">${escapeHtml(this.#t(view.labelKey))}</h2>
          <button type="button" part="side-close" aria-label="${escapeHtml(this.#t('parsinegar.views.close'))}">×</button>
        </div>
        <div part="side-body" data-pey-preserve="side-body" data-pey-preserve-state="scroll">${view.render({ t: this.#t, items: this.#items, currentId: this.#currentId, documentText: this.#documentText, settings: this.#settings, activeLine: this.#activeLine, collapsed: [...this.#collapsedLines], openMenuId: this.#openFileMenu, editing: this.#editingId === null ? null : { id: this.#editingId, error: this.#renameError }, formatNumber: this.#formatNumber ?? String, assetBaseUrl: this.#assetBaseUrl })}</div>
      </aside>`;
  }
}

customElements.define(TAG, ParsiSidePanel);

export { ParsiSidePanel, TAG };
