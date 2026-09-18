// Menu bar element: brand plus dropdown menus (file, edit, view).
//
// Owns its open-menu state and renders itself, so menu interaction never
// re-renders the parent page (which would drop editor focus and undo
// history). Menu actions leave the element as `menu-action` CustomEvents
// for the parent to map to behavior.
import { PeyElement } from 'pey.webui/base/pey-element';
import { escapeHtml } from '../workbench/html.js';
import { buildMenuModel } from '../workbench/menu-model.js';

const TAG = 'parsi-menu-bar';
const STYLE_URL = new URL('./menu-bar.css', import.meta.url).href;

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
   * Declares the external stylesheet attached by the base class before the
   * first contentful render (preload-and-cache contract of the kit).
   * @returns {string} Absolute stylesheet URL.
   */
  stylesheetHref() {
    return STYLE_URL;
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
            <button type="button" part="menu-item" role="menuitem" data-action="${entry.id}" ${entry.disabled ? 'disabled' : ''}><span part="menu-item-label">${escapeHtml(entry.label)}</span>${typeof entry.shortcut === 'string' && entry.shortcut.length > 0 ? `<span part="menu-shortcut">${escapeHtml(entry.shortcut)}</span>` : ''}</button>`).join('')}
          </div>
        </div>`;
    }).join('');
    return `
      <div part="menubar" role="menubar"><span part="brand">${escapeHtml(this.#t('parsinegar.app.title'))}</span>${markup}</div>`;
  }
}

customElements.define(TAG, ParsiMenuBar);

export { ParsiMenuBar, TAG };
