// Menu bar element: brand plus dropdown menus (file, edit, view).
//
// Owns its open-menu state and renders itself, so menu interaction never
// re-renders the parent page (which would drop editor focus and undo
// history). Menu actions leave the element as `menu-action` CustomEvents
// for the parent to map to behavior.
import { PeyElement } from 'pey.webui/base/pey-element';
import { escapeHtml } from './html.js';
import { buildMenuModel } from './menu-model.js';

const TAG = 'parsi-menu-bar';

class ParsiMenuBar extends PeyElement {
  #t = (key) => key;
  #hasDocument = false;
  #openMenu = null;
  #onDocumentClick = (event) => {
    if (this.#openMenu === null) {
      return;
    }
    if (event.composedPath().includes(this)) {
      return;
    }
    this.#openMenu = null;
    this.requestRender();
  };
  #onDocumentKeydown = (event) => {
    if (event.key === 'Escape' && this.#openMenu !== null) {
      this.#openMenu = null;
      this.requestRender();
    }
  };

  onConnect(refs = {}) {
    if (typeof refs.t === 'function') {
      this.#t = refs.t;
    }
    if (typeof refs.hasDocument === 'boolean') {
      this.#hasDocument = refs.hasDocument;
    }
  }

  /**
   * Updates menu capabilities (e.g. after a document opens or closes).
   * @param {object} data New data.
   * @param {boolean} [data.hasDocument] Whether a document is open.
   * @returns {void}
   */
  configure({ hasDocument } = {}) {
    if (typeof hasDocument === 'boolean') {
      this.#hasDocument = hasDocument;
    }
    this.requestRender();
  }

  eventTypes() {
    return ['click'];
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

  handleEvent(event) {
    const button = event.target?.closest?.('[data-menu]');
    if (button) {
      const id = button.getAttribute('data-menu');
      this.#openMenu = this.#openMenu === id ? null : id;
      this.requestRender();
      return;
    }
    const item = event.target?.closest?.('[data-action]');
    if (item && !item.disabled) {
      const action = item.getAttribute('data-action');
      this.#openMenu = null;
      this.requestRender();
      this.dispatchEvent(
        new CustomEvent('menu-action', { bubbles: true, composed: true, detail: { action } }),
      );
    }
  }

  render() {
    const menus = buildMenuModel({ t: this.#t, hasDocument: this.#hasDocument });
    const markup = menus.map((menu) => {
      const open = this.#openMenu === menu.id;
      return `
        <div part="menu">
          <button type="button" part="menu-button" data-menu="${menu.id}" aria-haspopup="true" aria-expanded="${open}">${escapeHtml(menu.label)}</button>
          <div part="menu-dropdown" role="menu" ${open ? '' : 'hidden'}>${menu.items.map((entry) => `
            <button type="button" part="menu-item" role="menuitem" data-action="${entry.id}" ${entry.disabled ? 'disabled' : ''}>${escapeHtml(entry.label)}</button>`).join('')}
          </div>
        </div>`;
    }).join('');
    return `
      <style>
        [part="menubar"] {
          display: flex;
          align-items: center;
          gap: 0.25rem;
        }
        @media (max-width: 56rem) {
          [part="menubar"] {
            flex-wrap: wrap;
          }
        }
        [part="brand"] {
          font-weight: 700;
          font-size: 0.95rem;
          padding-inline-end: 0.75rem;
          margin-inline-end: 0.5rem;
          border-inline-end: 1px solid var(--pey-color-border, #e2e2e8);
          white-space: nowrap;
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
        [part="menu-button"]:hover {
          background-color: var(--pey-color-surface, #f1f1f5);
        }
        [part="menu-button"][aria-expanded="true"] {
          border-color: var(--pey-color-border, #c8c8d2);
          background-color: var(--pey-color-surface, #f1f1f5);
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
          border: 1px solid var(--pey-color-border, #e2e2e8);
          border-radius: 10px;
          background-color: var(--pey-color-canvas, #ffffff);
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
          background-color: var(--pey-color-surface, #f1f1f5);
        }
        [part="menu-item"][disabled] {
          opacity: 0.45;
          cursor: default;
        }
        [part="menu-button"]:focus-visible,
        [part="menu-item"]:focus-visible {
          outline: 2px solid var(--pey-color-focus-ring, #5eead4);
          outline-offset: 2px;
        }
      </style>
      <div part="menubar" role="menubar"><span part="brand">${escapeHtml(this.#t('parsinegar.app.title'))}</span>${markup}</div>`;
  }
}

customElements.define(TAG, ParsiMenuBar);

export { ParsiMenuBar, TAG };
