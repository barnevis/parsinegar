// Status bar element: live document statistics display.
//
// Pure display driven entirely by configure(); emits nothing.
import { PeyElement } from 'pey.webui/base/pey-element';
import { escapeHtml } from '../workbench/html.js';

const TAG = 'parsi-status-bar';

class ParsiStatusBar extends PeyElement {
  #t = (key) => key;
  #stats = { chars: 0, words: 0, lines: 0 };
  #formatNumber = null;

  onConnect(refs = {}) {
    if (typeof refs.t === 'function') {
      this.#t = refs.t;
    }
  }

  /**
   * Updates the displayed statistics.
   * @param {object} data New data.
   * @param {object} [data.stats] `{ chars, words, lines }`.
   * @param {Function} [data.formatNumber] Number formatter.
   * @returns {void}
   */
  configure({ stats, formatNumber } = {}) {
    if (stats && typeof stats === 'object') {
      this.#stats = stats;
    }
    if (typeof formatNumber === 'function') {
      this.#formatNumber = formatNumber;
    }
    this.requestRender();
  }

  render() {
    const format = typeof this.#formatNumber === 'function' ? this.#formatNumber : String;
    const safe = this.#stats ?? { chars: 0, words: 0, lines: 0 };
    return `
      <style>
        [part="statusbar"] {
          display: flex;
          gap: 1.25rem;
          padding: 0.45rem 0.9rem;
          border-block-start: 1px solid var(--pey-color-border, #e2e2e8);
          background-color: var(--pey-color-surface, #f1f1f5);
          font-size: 0.85rem;
        }
        [part="stat-value"] {
          font-weight: 700;
        }
      </style>
      <footer part="statusbar">
        <span part="stat"><b part="stat-value" data-stat="chars">${format(safe.chars)}</b> ${escapeHtml(this.#t('parsinegar.stats.chars'))}</span>
        <span part="stat"><b part="stat-value" data-stat="words">${format(safe.words)}</b> ${escapeHtml(this.#t('parsinegar.stats.words'))}</span>
        <span part="stat"><b part="stat-value" data-stat="lines">${format(safe.lines)}</b> ${escapeHtml(this.#t('parsinegar.stats.lines'))}</span>
      </footer>`;
  }
}

customElements.define(TAG, ParsiStatusBar);

export { ParsiStatusBar, TAG };
