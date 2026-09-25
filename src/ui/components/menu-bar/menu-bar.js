// Menu bar element: dropdown menus (file, edit, insert, view).
//
// Owns its open-menu state and renders itself, so menu interaction never
// re-renders the parent page (which would drop editor focus and undo
// history). Menu actions leave the element as `menu-action` CustomEvents
// for the parent to map to behavior.
import { PeyElement } from 'pey.webui/base/pey-element';
import { escapeHtml, iconMarkup } from '../workbench/html.js';
import { buildMenuModel } from '../workbench/menu-model.js';
import { renderSearchForm } from '../workbench/search-form.js';

const TAG = 'parsi-menu-bar';
const STYLE_URL = new URL('./menu-bar.css', import.meta.url).href;
const SEARCH_DEFAULTS = {
  query: '',
  replace: '',
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
  inSelection: false,
  count: null,
  invalidRegexp: false,
  replaced: null,
};
const SEARCH_ACTIONS = new Set(['next', 'previous', 'replace-one', 'replace-all']);
const SEARCH_FLAGS = new Set(['caseSensitive', 'wholeWord', 'regexp', 'inSelection']);

class ParsiMenuBar extends PeyElement {
  #t = (key) => key;
  #hasDocument = false;
  #readOnly = false;
  #builtInOpen = false;
  #openMenu = null;
  #searchOpen = false;
  #search = { ...SEARCH_DEFAULTS };
  #formatNumber = String;
  #assetBaseUrl = null;
  #onDocumentClick = (event) => {
    if (this.#openMenu === null && !this.#searchOpen) {
      return;
    }
    if (event.composedPath().includes(this)) {
      return;
    }
    // Outside click only hides the dropdowns; the search highlight stays
    // until an explicit close (toggle or Escape) emits `search-close`.
    this.#openMenu = null;
    this.#searchOpen = false;
    this.requestRender();
  };
  #onDocumentKeydown = (event) => {
    if (event.key === 'Escape' && this.#openMenu !== null) {
      this.#openMenu = null;
      this.requestRender();
    }
    if (event.key === 'Escape' && this.#searchOpen) {
      this.#closeSearch(true);
    }
  };

  onConnect(refs = {}) {
    if (typeof refs.t === 'function') {
      this.#t = refs.t;
    }
    if (typeof refs.hasDocument === 'boolean') {
      this.#hasDocument = refs.hasDocument;
    }
    if (typeof refs.formatNumber === 'function') {
      this.#formatNumber = refs.formatNumber;
    }
    if (typeof refs.assetBaseUrl === 'string') {
      this.#assetBaseUrl = refs.assetBaseUrl;
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
   * Updates menu capabilities (e.g. after a document opens or closes) and
   * the search form state (open flag plus the last result echoed back by
   * the parent after each search event). Passing `search: null` resets the
   * form to its defaults.
   * @param {object} data New data.
   * @param {boolean} [data.hasDocument] Whether a document is open.
   * @param {boolean} [data.searchOpen] Whether the search dropdown is open.
   * @param {object|null} [data.search] Search form state to display, or null to reset.
   * @param {string} [data.searchFocus] When opening, 'replace' focuses the
   *   replacement input instead of the query input.
   * @param {Function} [data.formatNumber] Number formatter.
   * @returns {void}
   */
  configure({ hasDocument, searchOpen, search, searchFocus, formatNumber, readOnly, builtInOpen } = {}) {
    if (typeof hasDocument === 'boolean') {
      this.#hasDocument = hasDocument;
    }
    if (typeof readOnly === 'boolean') {
      this.#readOnly = readOnly;
    }
    if (typeof builtInOpen === 'boolean') {
      this.#builtInOpen = builtInOpen;
    }
    if (typeof searchOpen === 'boolean') {
      this.#searchOpen = searchOpen;
    }
    if (search === null) {
      this.#search = { ...SEARCH_DEFAULTS };
    } else if (search !== undefined && typeof search === 'object') {
      this.#search = {
        ...SEARCH_DEFAULTS,
        query: typeof search.query === 'string' ? search.query : '',
        replace: typeof search.replace === 'string' ? search.replace : '',
        caseSensitive: search.caseSensitive === true,
        wholeWord: search.wholeWord === true,
        regexp: search.regexp === true,
        inSelection: search.inSelection === true,
        count: search.count ?? null,
        invalidRegexp: search.invalidRegexp === true,
        replaced: Number.isInteger(search.replaced) ? search.replaced : null,
      };
    }
    if (typeof formatNumber === 'function') {
      this.#formatNumber = formatNumber;
    }
    this.requestRender();
    if (searchOpen === true) {
      const selector = searchFocus === 'replace' ? '[data-search-replace]' : '[data-search-query]';
      queueMicrotask(() => this.shadowRoot?.querySelector(selector)?.focus());
    }
  }

  /**
   * Emits a search event with the current form spec for the parent to run
   * against the editor; the result comes back through configure().
   * @param {string} name Event name (`search-query`, `search-next`,
   *   `search-previous`, `search-replace-one`, `search-replace-all`).
   * @returns {void}
   */
  #emitSearch(name) {
    const { query, replace, caseSensitive, wholeWord, regexp, inSelection } = this.#search;
    this.dispatchEvent(
      new CustomEvent(name, {
        bubbles: true,
        composed: true,
        detail: { query, replace, caseSensitive, wholeWord, regexp, inSelection },
      }),
    );
  }

  /**
   * Closes the search dropdown, optionally telling the parent to clear the
   * editor highlight.
   * @param {boolean} notify Whether to emit `search-close`.
   * @returns {void}
   */
  #closeSearch(notify) {
    if (!this.#searchOpen) {
      return;
    }
    this.#searchOpen = false;
    this.requestRender();
    if (notify) {
      this.dispatchEvent(new CustomEvent('search-close', { bubbles: true, composed: true }));
    }
  }

  eventTypes() {
    return ['click', 'input', 'change', 'keydown'];
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
    if (event.type === 'input') {
      const field = event.target?.closest?.('[data-search-query], [data-search-replace]');
      if (!field) {
        return;
      }
      if (field.hasAttribute('data-search-query')) {
        this.#search.query = field.value;
      } else {
        this.#search.replace = field.value;
      }
      this.#search.replaced = null;
      this.#emitSearch('search-query');
      this.requestRender();
      return;
    }
    if (event.type === 'change') {
      const flag = event.target?.closest?.('[data-search-flag]');
      if (!flag) {
        return;
      }
      if (SEARCH_FLAGS.has(flag.getAttribute('data-search-flag'))) {
        this.#search[flag.getAttribute('data-search-flag')] = flag.checked;
        this.#search.replaced = null;
        this.#emitSearch('search-query');
        this.requestRender();
      }
      return;
    }
    if (event.type === 'keydown') {
      const form = event.target?.closest?.('[data-search-form]');
      if (!form) {
        return;
      }
      if (event.key === 'Escape') {
        // Stop here so the document-level handler does not emit twice.
        event.stopPropagation();
        this.#closeSearch(true);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        this.#emitSearch('search-next');
      }
      return;
    }
    const toggle = event.target?.closest?.('[data-search-toggle]');
    if (toggle) {
      this.#searchOpen = !this.#searchOpen;
      if (this.#searchOpen) {
        this.requestRender();
        // The render lands on a microtask; focus the query input after it.
        queueMicrotask(() => this.shadowRoot?.querySelector('[data-search-query]')?.focus());
      } else {
        this.#closeSearch(true);
      }
      return;
    }
    const searchAction = event.target?.closest?.('[data-search-action]');
    if (searchAction) {
      const action = searchAction.getAttribute('data-search-action');
      if (SEARCH_ACTIONS.has(action)) {
        // The dropdown stays open for repeated steps; the fresh result
        // arrives through configure() and re-renders the counter.
        this.#emitSearch(`search-${action}`);
      }
      return;
    }
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
    const menus = buildMenuModel({
      t: this.#t,
      hasDocument: this.#hasDocument,
      readOnly: this.#readOnly,
      builtInOpen: this.#builtInOpen,
    });
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
      <div part="menubar" role="menubar">${markup}
        <div part="search">
          <button type="button" part="search-toggle" data-search-toggle data-pey-preserve="search-toggle" data-pey-preserve-state="focus" aria-expanded="${this.#searchOpen}" aria-label="${escapeHtml(this.#t('parsinegar.search.button'))}" title="${escapeHtml(this.#t('parsinegar.search.button'))}" ${this.#hasDocument ? '' : 'disabled'}>${iconMarkup(this.#assetBaseUrl, 'search')}</button>
          <div part="search-dropdown" ${this.#searchOpen ? '' : 'hidden'}>${renderSearchForm({ t: this.#t, state: this.#search, formatNumber: this.#formatNumber })}</div>
        </div>
      </div>`;
  }
}

customElements.define(TAG, ParsiMenuBar);

export { ParsiMenuBar, TAG };
