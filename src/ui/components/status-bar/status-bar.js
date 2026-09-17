// Status bar element: live document statistics display.
//
// Pure display driven entirely by configure(); emits nothing.
import { PeyElement } from 'pey.webui/base/pey-element';
import { escapeHtml } from '../workbench/html.js';
import { formatFileSize } from '../workbench/stats.js';

const TAG = 'parsi-status-bar';

class ParsiStatusBar extends PeyElement {
  #t = (key) => key;
  #stats = { chars: 0, letters: 0, words: 0, lines: 0, bytes: 0 };
  #formatNumber = null;

  onConnect(refs = {}) {
    if (typeof refs.t === 'function') {
      this.#t = refs.t;
    }
  }

  /**
   * Updates the displayed statistics.
   * @param {object} data New data.
   * @param {object} [data.stats] `{ chars, letters, words, lines, bytes }`.
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
    const safe = this.#stats ?? { chars: 0, letters: 0, words: 0, lines: 0, bytes: 0 };
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
        <span part="stat">${escapeHtml(this.#t('parsinegar.stats.chars'))} <b part="stat-value" data-stat="chars">${format(safe.chars ?? 0)}</b></span>
        <span part="stat">${escapeHtml(this.#t('parsinegar.stats.letters'))} <b part="stat-value" data-stat="letters">${format(safe.letters ?? 0)}</b></span>
        <span part="stat">${escapeHtml(this.#t('parsinegar.stats.words'))} <b part="stat-value" data-stat="words">${format(safe.words ?? 0)}</b></span>
        <span part="stat">${escapeHtml(this.#t('parsinegar.stats.lines'))} <b part="stat-value" data-stat="lines">${format(safe.lines ?? 0)}</b></span>
        <span part="stat">${escapeHtml(this.#t('parsinegar.stats.size'))} <b part="stat-value" data-stat="size">${escapeHtml(formatFileSize(safe.bytes ?? 0, format, this.#t))}</b></span>
      </footer>`;
  }
}

customElements.define(TAG, ParsiStatusBar);

export { ParsiStatusBar, TAG };
