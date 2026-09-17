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
  #activeView = FILES_VIEW;
  #items = [];
  #currentId = null;
  #documentText = '';
  #applied = null;

  onConnect(refs = {}) {
    if (typeof refs.t === 'function') {
      this.#t = refs.t;
    }
    if (typeof refs.assetBaseUrl === 'string' && refs.assetBaseUrl.length > 0) {
      this.#assetBaseUrl = refs.assetBaseUrl;
    }
    // The imminent first render paints exactly these refs.
    this.#applied = this.#store(refs);
  }

  /**
   * Stores panel data fields, returning the full snapshot.
   * @param {object} data Partial data.
   * @returns {object} Snapshot with signature.
   */
  #store({ activeView, items, currentId, documentText } = {}) {
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
    return {
      activeView: this.#activeView,
      items: this.#items,
      currentId: this.#currentId,
      documentText: this.#documentText,
      signature: outlineSignature(this.#documentText),
    };
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
   * @returns {void}
   */
  configure({ activeView, items, currentId, documentText } = {}) {
    const next = this.#store({ activeView, items, currentId, documentText });
    const prev = this.#applied;
    const same = prev !== null
      && prev.activeView === next.activeView
      && prev.items === next.items
      && prev.currentId === next.currentId
      && prev.signature === next.signature;
    if (!same) {
      this.#applied = next;
      this.requestRender();
    }
  }

  eventTypes() {
    return ['click'];
  }

  handleEvent(event) {
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
    if (event.target?.closest?.('[part="docs-delete"]')) {
      this.dispatchEvent(new CustomEvent('document-delete', { bubbles: true, composed: true }));
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
        }
        [part="docs-open"],
        [part="outline-jump"] {
          font: inherit;
          inline-size: 100%;
          text-align: start;
          border: 1px solid transparent;
          border-radius: 8px;
          background-color: transparent;
          padding: 0.35rem 0.6rem;
          cursor: pointer;
          color: inherit;
        }
        [part="docs-open"]:hover,
        [part="outline-jump"]:hover {
          background-color: var(--pey-color-canvas, #ffffff);
        }
        [part="docs-open"][aria-current="true"] {
          border-color: transparent;
          background-color: var(--pey-color-accent, #5eead4);
          color: #0f172a;
          font-weight: 700;
        }
        [part="files-bar"] {
          display: flex;
          gap: 0.4rem;
          margin-block-end: 0.6rem;
        }
        [part="docs-new"],
        [part="docs-delete"] {
          font: inherit;
          flex: 1;
          border: 1px solid var(--pey-color-border, #d8d8de);
          border-radius: 8px;
          background-color: var(--pey-color-canvas, #ffffff);
          padding: 0.35rem 0.5rem;
          cursor: pointer;
          color: inherit;
        }
        [part="docs-new"] svg,
        [part="docs-delete"] svg {
          inline-size: 18px;
          block-size: 18px;
          vertical-align: middle;
        }
        [part="docs-new"]:hover,
        [part="docs-delete"]:hover {
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
        [part="docs-open"]:focus-visible,
        [part="outline-jump"]:focus-visible,
        [part="docs-new"]:focus-visible,
        [part="docs-delete"]:focus-visible,
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
        <div part="side-body" data-pey-preserve="side-body" data-pey-preserve-state="scroll">${view.render({ t: this.#t, items: this.#items, currentId: this.#currentId, documentText: this.#documentText, assetBaseUrl: this.#assetBaseUrl })}</div>
      </aside>`;
  }
}

customElements.define(TAG, ParsiSidePanel);

export { ParsiSidePanel, TAG };
