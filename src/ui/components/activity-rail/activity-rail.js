// Activity rail element: icon buttons switching the side-panel view.
//
// Stateless display driven entirely by configure(); selection changes leave
// as `view-select` CustomEvents for the parent, which owns the active view.
import { PeyElement } from 'pey.webui/base/pey-element';
import { escapeHtml, iconMarkup } from '../workbench/html.js';
import { logoMarkup } from '../workbench/logo.js';

const TAG = 'parsi-activity-rail';
const STYLE_URL = new URL('./activity-rail.css', import.meta.url).href;

class ParsiActivityRail extends PeyElement {
  #t = (key) => key;
  #assetBaseUrl = null;
  #views = [];
  #activeView = null;
  // Sync status dot: 'ok' (synced), 'stale' (not yet synced), 'busy'
  // (operation running), 'bad' (error or conflict), null (no sync view).
  // The hint names the unsent changes as the button tooltip while dirty.
  #syncDot = null;
  #syncHint = null;

  onConnect(refs = {}) {
    if (typeof refs.t === 'function') {
      this.#t = refs.t;
    }
    if (typeof refs.assetBaseUrl === 'string' && refs.assetBaseUrl.length > 0) {
      this.#assetBaseUrl = refs.assetBaseUrl;
    }
    this.#storeViews(refs.views);
    if (typeof refs.activeView === 'string') {
      this.#activeView = refs.activeView;
    }
    this.#storeSyncDot(refs.syncDot);
    this.#storeSyncHint(refs.syncHint);
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
   * Updates the rail content. Views are `{ id, icon, labelKey }` entries.
   * @param {object} data New data.
   * @param {Array<object>} [data.views] View entries.
   * @param {string} [data.activeView] Active view id.
   * @param {string|null} [data.syncDot] Sync dot state for the sync button.
   * @param {string|null} [data.syncHint] Tooltip suffix while dirty.
   * @returns {void}
   */
  configure({ views, activeView, syncDot, syncHint } = {}) {
    this.#storeViews(views);
    if (typeof activeView === 'string') {
      this.#activeView = activeView;
    }
    this.#storeSyncDot(syncDot);
    this.#storeSyncHint(syncHint);
    this.requestRender();
  }

  eventTypes() {
    return ['click'];
  }

  handleEvent(event) {
    const about = event.target?.closest?.('[data-about]');
    if (about) {
      this.dispatchEvent(new CustomEvent('about-open', { bubbles: true, composed: true }));
      return;
    }
    const button = event.target?.closest?.('[data-view]');
    if (!button) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent('view-select', {
        bubbles: true,
        composed: true,
        detail: { id: button.getAttribute('data-view') },
      }),
    );
  }

  render() {
    const start = this.#views.filter((view) => view.align !== 'end');
    const end = this.#views.filter((view) => view.align === 'end');
    const logo = this.#renderLogoButton();
    return `
      <nav part="rail" aria-label="${escapeHtml(this.#t('parsinegar.app.title'))}">${start.map((view) => this.#renderButton(view)).join('')}${end.length > 0 ? `<div part="rail-end">${end.map((view) => this.#renderButton(view)).join('')}${logo}</div>` : logo}</nav>`;
  }

  /**
   * Renders the logotype action button pinned after the end views. It opens
   * the about pane (an action, not a view, so no `aria-pressed` and no
   * registry entry). The mark is inline SVG so it follows the theme text
   * color, which an `<img>` could not inherit.
   * @returns {string} Button markup.
   */
  #renderLogoButton() {
    const label = escapeHtml(this.#t('parsinegar.about.title'));
    return `
      <button type="button" part="rail-button" data-about aria-label="${label}" data-tooltip="${label}">${logoMarkup()}</button>`;
  }

  /**
   * Renders one rail button for a view entry.
   * @param {object} view Registry entry with `{ id, icon, labelKey }`.
   * @returns {string} Button markup.
   */
  #renderButton(view) {
    const dot = view.id === 'sync' ? this.#renderSyncDot() : '';
    const label = this.#t(view.labelKey);
    // Custom tooltip instead of `title`: native tooltips render in the OS
    // font and can never take Vazirmatn; this one inherits the page font.
    const tooltip = view.id === 'sync' && this.#syncHint ? `${label} — ${this.#syncHint}` : label;
    return `
      <button type="button" part="rail-button" data-view="${view.id}" aria-pressed="${view.id === this.#activeView}" aria-label="${escapeHtml(label)}" data-tooltip="${escapeHtml(tooltip)}">${iconMarkup(this.#assetBaseUrl, view.icon)}${dot}<span part="rail-fallback">${escapeHtml(label)}</span></button>`;
  }

  /**
   * Renders the sync status dot, if the page reported a state.
   * @returns {string} Dot markup or empty.
   */
  #renderSyncDot() {
    if (this.#syncDot !== 'ok' && this.#syncDot !== 'stale' && this.#syncDot !== 'busy' && this.#syncDot !== 'bad') {
      return '';
    }
    const label = escapeHtml(this.#t(`parsinegar.sync.dot-${this.#syncDot}`));
    return `<span part="rail-dot" data-sync-dot="${this.#syncDot}" role="img" aria-label="${label}"></span>`;
  }

  #storeSyncDot(syncDot) {
    if (syncDot === undefined) {
      return;
    }
    this.#syncDot = typeof syncDot === 'string' ? syncDot : null;
  }

  #storeSyncHint(syncHint) {
    if (syncHint === undefined) {
      return;
    }
    this.#syncHint = typeof syncHint === 'string' && syncHint.length > 0 ? syncHint : null;
  }

  #storeViews(views) {
    if (Array.isArray(views)) {
      this.#views = views;
    }
  }
}

customElements.define(TAG, ParsiActivityRail);

export { ParsiActivityRail, TAG };
