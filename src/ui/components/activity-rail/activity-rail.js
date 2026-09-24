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
   * @returns {void}
   */
  configure({ views, activeView } = {}) {
    this.#storeViews(views);
    if (typeof activeView === 'string') {
      this.#activeView = activeView;
    }
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
      <button type="button" part="rail-button" data-about aria-label="${label}" title="${label}">${logoMarkup()}</button>`;
  }

  /**
   * Renders one rail button for a view entry.
   * @param {object} view Registry entry with `{ id, icon, labelKey }`.
   * @returns {string} Button markup.
   */
  #renderButton(view) {
    return `
      <button type="button" part="rail-button" data-view="${view.id}" aria-pressed="${view.id === this.#activeView}" aria-label="${escapeHtml(this.#t(view.labelKey))}" title="${escapeHtml(this.#t(view.labelKey))}">${iconMarkup(this.#assetBaseUrl, view.icon)}<span part="rail-fallback">${escapeHtml(this.#t(view.labelKey))}</span></button>`;
  }

  #storeViews(views) {
    if (Array.isArray(views)) {
      this.#views = views;
    }
  }
}

customElements.define(TAG, ParsiActivityRail);

export { ParsiActivityRail, TAG };
