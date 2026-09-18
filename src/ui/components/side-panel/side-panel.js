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
      <style>
        [part="side"] {
          display: flex;
          flex-direction: column;
          min-block-size: 0;
          border-inline-end: 1px solid var(--pey-color-border, #e2e2e8);
          background-color: var(--pey-color-surface, #f1f1f5);
          overflow: hidden;
          block-size: 100%;
        }
        [part="side-header"] {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.6rem 0.8rem;
          border-block-end: 1px solid var(--pey-color-border, #e2e2e8);
        }
        [part="side-title"] {
          font-size: 14px;
          margin: 0;
        }
        [part="side-body"] {
          flex: 1;
          min-block-size: 0;
          padding: 0.6rem 0.8rem;
          overflow: auto;
        }
        [part="docs-list"],
        [part="outline-list"] {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
          margin: 0;
          padding: 0;
        }
        [part="outline-list"] [part="outline-list"] {
          padding-inline-start: 1rem;
          flex-basis: 100%;
        }
        [part="outline-item"] {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.2rem;
        }
        [part="outline-toggle"] {
          font: inherit;
          flex: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid transparent;
          border-radius: 8px;
          background-color: transparent;
          inline-size: 1rem;
          block-size: 1rem;
          cursor: pointer;
          color: var(--pey-color-text-muted, #55555f);
        }
        [part="outline-spacer"] {
          flex: none;
          inline-size: 1rem;
        }
        [part="outline-chevron"] {
          display: inline-block;
          inline-size: 0.24rem;
          block-size: 0.24rem;
          /* Physical borders on purpose: the chevron angle must stay fixed
             instead of flipping with the text direction. */
          border-right: 2px solid currentColor;
          border-bottom: 2px solid currentColor;
          transform: rotate(45deg);
        }
        [part="outline-toggle"][aria-expanded="false"] [part="outline-chevron"] {
          /* Collapsed points left in RTL (right in LTR would be -45deg). */
          transform: rotate(135deg);
        }
        [part="docs-open"],
        [part="outline-jump"] {
          font: inherit;
          text-align: start;
          border: 1px solid transparent;
          border-radius: 8px;
          background-color: transparent;
          padding: 0.35rem 0.6rem;
          cursor: pointer;
          color: inherit;
        }
        [part="docs-open"] {
          flex: 1;
          min-inline-size: 0;
        }
        [part="outline-jump"] {
          flex: 1;
          min-inline-size: 0;
          font-size: 13px;
        }
        [part="outline-jump"]:hover {
          background-color: var(--pey-color-canvas, #ffffff);
        }
        [part="docs-open"][aria-current="true"] {
          font-weight: 700;
        }
        [part="outline-jump"][aria-current="true"] {
          font-weight: 700;
          background-color: rgb(94 234 212 / 0.14);
          background-color: color-mix(in srgb, var(--pey-color-accent, #5eead4) 18%, transparent);
        }
        [part="docs-item"] {
          position: relative;
          display: flex;
          gap: 0.2rem;
          align-items: center;
        }
        [part="docs-item"][data-current="true"] {
          background-color: rgb(94 234 212 / 0.14);
          background-color: color-mix(in srgb, var(--pey-color-accent, #5eead4) 18%, transparent);
          border-radius: 8px;
        }
        [part="docs-menu"] {
          font: inherit;
          flex: none;
          border: 1px solid transparent;
          border-radius: 8px;
          background-color: transparent;
          inline-size: 2rem;
          block-size: 2rem;
          cursor: pointer;
          color: inherit;
        }
        [part="file-menu"] {
          position: absolute;
          inset-block-start: calc(100% + 0.25rem);
          inset-inline-end: 0;
          min-inline-size: 10rem;
          z-index: 10;
          display: flex;
          flex-direction: column;
          padding: 0.3rem;
          border: 1px solid var(--pey-color-border, #e2e2e8);
          border-radius: 10px;
          background-color: var(--pey-color-canvas, #ffffff);
          box-shadow: 0 8px 24px rgb(0 0 0 / 0.1);
        }
        [part="file-menu-item"] {
          font: inherit;
          text-align: start;
          border: 0;
          border-radius: 6px;
          background-color: transparent;
          padding: 0.4rem 0.6rem;
          cursor: pointer;
          color: inherit;
        }
        [part="file-menu-item"]:hover {
          background-color: var(--pey-color-surface, #f1f1f5);
        }
        [part="file-menu-item"]:focus-visible,
        [part="docs-menu"]:focus-visible,
        [part="docs-rename"]:focus-visible {
          outline: 2px solid var(--pey-color-focus-ring, #5eead4);
          outline-offset: 2px;
        }
        [part="docs-rename"] {
          font: inherit;
          flex: 1;
          min-inline-size: 0;
          border: 1px solid var(--pey-color-border, #d8d8de);
          border-radius: 8px;
          background-color: var(--pey-color-canvas, #ffffff);
          padding: 0.35rem 0.6rem;
          color: inherit;
        }
        [part="docs-error"] {
          margin: 0.3rem 0 0;
          font-size: 0.85rem;
          color: var(--pey-color-status-error, #d24545);
        }
        [part="files-bar"] {
          display: flex;
          gap: 0.4rem;
          margin-block-end: 0.6rem;
        }
        [part="docs-new"] {
          font: inherit;
          flex: 1;
          border: 1px solid var(--pey-color-border, #d8d8de);
          border-radius: 8px;
          background-color: var(--pey-color-canvas, #ffffff);
          padding: 0.35rem 0.5rem;
          cursor: pointer;
          color: inherit;
        }
        [part="docs-new"] svg {
          inline-size: 18px;
          block-size: 18px;
          vertical-align: middle;
        }
        [part="docs-new"]:hover {
          background-color: var(--pey-color-canvas, #ffffff);
          border-color: var(--pey-color-border, #c8c8d2);
        }
        [part="side-close"] {
          font: inherit;
          border: 1px solid transparent;
          border-radius: 8px;
          background-color: transparent;
          inline-size: 2rem;
          block-size: 2rem;
          cursor: pointer;
          color: inherit;
        }
        [part="side-close"]:hover {
          background-color: var(--pey-color-canvas, #ffffff);
        }
        [part="settings-view"] {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        [part="settings-group"] {
          margin: 0;
          padding: 0.6rem 0.7rem 0.75rem;
          border: 1px solid var(--pey-color-border, #e2e2e8);
          border-radius: 10px;
        }
        [part="settings-legend"] {
          font-size: 0.85rem;
          font-weight: 700;
          padding-inline: 0.35rem;
        }
        [part="settings-option"] {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.3rem 0.2rem;
          cursor: pointer;
        }
        [part="settings-option"] input {
          accent-color: var(--pey-color-accent, #0f6fff);
        }
        [part="settings-stepper"] {
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }
        [part="settings-less"],
        [part="settings-more"] {
          font: inherit;
          flex: 1;
          border: 1px solid var(--pey-color-border, #d8d8de);
          border-radius: 8px;
          background-color: var(--pey-color-canvas, #ffffff);
          padding: 0.35rem 0.5rem;
          cursor: pointer;
          color: inherit;
        }
        [part="settings-less"]:hover,
        [part="settings-more"]:hover {
          border-color: var(--pey-color-border, #c8c8d2);
        }
        [part="settings-value"] {
          min-inline-size: 2.5rem;
          text-align: center;
          font-weight: 700;
        }
        [part="docs-open"]:focus-visible,
        [part="outline-jump"]:focus-visible,
        [part="outline-toggle"]:focus-visible,
        [part="docs-new"]:focus-visible,
        [part="side-close"]:focus-visible {
          outline: 2px solid var(--pey-color-focus-ring, #5eead4);
          outline-offset: 2px;
        }
      </style>
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
