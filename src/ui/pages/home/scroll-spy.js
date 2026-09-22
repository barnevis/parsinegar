// Scrollspy for the workbench outline.
//
// Watches the scrolling center column (not the editor scroller), maps the
// first visible editor line to its heading and reports changes. Scroll bursts
// collapse through requestAnimationFrame and never steal focus; pure push,
// the page forwards reports to the side panel. No DOM ownership beyond the
// watched column element, no services.
import { parseOutline } from '../../components/workbench/outline.js';

/**
 * Creates the outline scrollspy bound to explicit callbacks.
 * @param {object} [options] Callbacks (all replaceable for tests).
 * @param {Function} [options.getVisibleLine] Maps a viewport top to the first visible 1-based editor line (null when unavailable).
 * @param {Function} [options.getText] Returns the current Markdown text for outline parsing.
 * @param {Function} [options.onActiveLine] Receives the new active heading line (or null).
 * @param {Function} [options.isLive] Returns false once the owner disconnects; reports stop then.
 * @returns {object} Scrollspy controls.
 */
export function createScrollSpy({
  getVisibleLine = () => null,
  getText = () => '',
  onActiveLine = () => {},
  isLive = () => true,
} = {}) {
  let centerEl = null;
  let scrollFrame = 0;
  let activeLine = null;

  function handleLine(line) {
    if (!Number.isInteger(line) || line < 1) {
      return;
    }
    let active = null;
    for (const heading of parseOutline(getText())) {
      if (heading.line <= line) {
        active = heading.line;
      } else {
        break;
      }
    }
    if (active !== activeLine) {
      activeLine = active;
      onActiveLine(active);
    }
  }

  function report() {
    if (!isLive()) {
      return;
    }
    const box = centerEl?.getBoundingClientRect();
    const top = box && typeof box.top === 'number' ? box.top : 0;
    let line = null;
    try {
      line = getVisibleLine(top);
    } catch {
      line = null;
    }
    handleLine(line);
  }

  function onScroll() {
    if (scrollFrame !== 0) {
      return;
    }
    if (typeof globalThis.requestAnimationFrame === 'function') {
      scrollFrame = globalThis.requestAnimationFrame(() => {
        scrollFrame = 0;
        report();
      });
    } else {
      report();
    }
  }

  return {
    /**
     * Attaches to a center column element, replacing any previous one.
     * @param {Element|null} center Scrolling column element.
     * @returns {void}
     */
    watch(center) {
      if (!center || center === centerEl) {
        return;
      }
      this.unwatch();
      centerEl = center;
      center.addEventListener('scroll', onScroll, { passive: true });
    },

    /**
     * Detaches the scroll listener and drops a pending frame.
     * @returns {void}
     */
    unwatch() {
      centerEl?.removeEventListener('scroll', onScroll);
      if (scrollFrame !== 0 && typeof globalThis.cancelAnimationFrame === 'function') {
        globalThis.cancelAnimationFrame(scrollFrame);
      }
      centerEl = null;
      scrollFrame = 0;
    },

    /**
     * Forgets the active heading (document switches start unhighlighted).
     * @returns {void}
     */
    reset() {
      activeLine = null;
    },

    /**
     * Returns the last reported heading line (or null) so re-renders can
     * configure children without waiting for the next scroll.
     * @returns {number|null} Active heading line.
     */
    getActiveLine() {
      return activeLine;
    },

    /**
     * Maps the current viewport immediately (after editor mounts).
     * @returns {void}
     */
    report() {
      report();
    },
  };
}
