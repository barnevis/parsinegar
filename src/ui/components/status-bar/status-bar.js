// Status bar element: live document statistics display.
//
// Pure display driven entirely by configure(); emits nothing.
import { PeyElement } from 'pey.webui/base/pey-element';
import { escapeHtml } from '../workbench/html.js';
import { formatFileSize } from '../workbench/stats.js';

const TAG = 'parsi-status-bar';
const STYLE_URL = new URL('./status-bar.css', import.meta.url).href;

class ParsiStatusBar extends PeyElement {
  #t = (key) => key;
  #stats = { chars: 0, letters: 0, words: 0, lines: 0, bytes: 0 };
  #formatNumber = null;
  #readOnly = false;

  onConnect(refs = {}) {
    if (typeof refs.t === 'function') {
      this.#t = refs.t;
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
   * Updates the displayed statistics.
   * @param {object} data New data.
   * @param {object} [data.stats] `{ chars, letters, words, lines, bytes }`.
   * @param {Function} [data.formatNumber] Number formatter.
   * @param {boolean} [data.readOnly] Whether the open view is locked for reading.
   * @returns {void}
   */
  configure({ stats, formatNumber, readOnly } = {}) {
    if (stats && typeof stats === 'object') {
      this.#stats = stats;
    }
    if (typeof formatNumber === 'function') {
      this.#formatNumber = formatNumber;
    }
    if (typeof readOnly === 'boolean') {
      this.#readOnly = readOnly;
    }
    this.requestRender();
  }

  render() {
    const format = typeof this.#formatNumber === 'function' ? this.#formatNumber : String;
    const safe = this.#stats ?? { chars: 0, letters: 0, words: 0, lines: 0, bytes: 0 };
    return `
      <footer part="statusbar">
        ${this.#readOnly ? `<span part="lock-chip">${escapeHtml(this.#t('parsinegar.status.locked'))}</span>` : ''}
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
