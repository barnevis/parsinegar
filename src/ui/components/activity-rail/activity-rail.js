// Activity rail element: icon buttons switching the side-panel view.
//
// Stateless display driven entirely by configure(); selection changes leave
// as `view-select` CustomEvents for the parent, which owns the active view.
import { PeyElement } from 'pey.webui/base/pey-element';
import { escapeHtml, iconMarkup } from '../workbench/html.js';

const TAG = 'parsi-activity-rail';

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
    return `
      <style>
        [part="rail"] {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          block-size: 100%;
        }
        [part="rail-end"] {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          margin-block-start: auto;
        }
        [part="rail-button"] {
          font: inherit;
          display: flex;
          align-items: center;
          justify-content: center;
          inline-size: 2.75rem;
          block-size: 2.75rem;
          border: 0;
          background: none;
          cursor: pointer;
          color: inherit;
        }
        [part="rail-button"] svg {
          inline-size: 20px;
          block-size: 20px;
        }
        [part="rail-fallback"] {
          display: none;
        }
        [part="rail-button"][aria-pressed="true"] {
          color: var(--pey-color-accent, #5eead4);
        }
        [part="rail-button"]:focus-visible {
          outline: 2px solid var(--pey-color-focus-ring, #5eead4);
          outline-offset: 2px;
        }
      </style>
      <nav part="rail" aria-label="${escapeHtml(this.#t('parsinegar.app.title'))}">${start.map((view) => this.#renderButton(view)).join('')}${end.length > 0 ? `<div part="rail-end">${end.map((view) => this.#renderButton(view)).join('')}</div>` : ''}</nav>`;
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
