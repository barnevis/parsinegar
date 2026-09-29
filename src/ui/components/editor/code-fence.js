// Hides fenced-code delimiter lines (live preview).
//
// The fence backticks own `CodeMark` syntax nodes but no highlight tag, so
// the theme cannot hide them like other marks. Instead each delimiter line
// of a non-empty block hides through a zero-size mark over the whole line
// — except where the cursor or a selection touches that line, which
// reopens it for editing (line-level reveal: clicking a fence line shows
// it). Empty blocks keep visible fences, or they would vanish entirely
// with the cursor elsewhere. Unclosed fences run to the document end. The
// copy button is unaffected: it stays always visible, anchored at the
// opening line start.
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import { FENCE_PATTERN } from './live-preview.js';

/**
 * Checks whether any selection range touches `from`..`to` (boundaries
 * inclusive). Touched fence lines reopen for editing.
 * @param {object} selection Editor selection state.
 * @param {number} from Range start.
 * @param {number} to Range end.
 * @returns {boolean} True when a range touches.
 */
function selectionTouches(selection, from, to) {
  return selection.ranges.some((range) => range.from <= to && range.to >= from);
}

/**
 * Scans document lines for fenced code blocks with content. Fence parity
 * resolves from the document start, mirroring `live-preview.js` and
 * `code-copy.js`. Empty blocks (opener immediately followed by its closer)
 * are skipped.
 * @param {object} doc Document text accessor (`line`, `lines`).
 * @returns {Array} `{ openFrom, openTo, closeFrom, closeTo }` blocks with
 *   document ranges (close* is null when unclosed).
 */
function scanFences(doc) {
  const blocks = [];
  let open = null;
  for (let number = 1; number <= doc.lines; number += 1) {
    const line = doc.line(number);
    if (!FENCE_PATTERN.test(line.text)) {
      continue;
    }
    if (!open) {
      open = { openFrom: line.from, openTo: line.to, openNumber: number };
    } else {
      // Empty when nothing sits between the delimiters.
      if (line.number > open.openNumber + 1 || line.from > open.openTo + 1) {
        blocks.push({ openFrom: open.openFrom, openTo: open.openTo, closeFrom: line.from, closeTo: line.to });
      }
      open = null;
    }
  }
  if (open) {
    const lastLine = doc.line(doc.lines);
    if (lastLine.number > open.openNumber + 1 || lastLine.to > open.openTo + 1) {
      blocks.push({ openFrom: open.openFrom, openTo: open.openTo, closeFrom: null, closeTo: null });
    }
  }
  return blocks;
}

/**
 * Collects fence-line ranges hiding them unless touched.
 * @param {object} state Editor state.
 * @returns {Array} `{ from, to }` hidden line ranges, ascending.
 */
export function collectFenceHides(state) {
  const hidden = [];
  for (const block of scanFences(state.doc)) {
    if (!selectionTouches(state.selection, block.openFrom, block.openTo)) {
      hidden.push({ from: block.openFrom, to: block.openTo });
    }
    if (block.closeFrom !== null && !selectionTouches(state.selection, block.closeFrom, block.closeTo)) {
      hidden.push({ from: block.closeFrom, to: block.closeTo });
    }
  }
  return hidden;
}

/**
 * Builds fence-hiding decorations.
 * @param {object} view Active editor view.
 * @returns {object} Decoration set.
 */
function buildFenceDecorations(view) {
  const ranges = collectFenceHides(view.state).map(({ from, to }) => Decoration.mark({ class: 'parsi-fence-hidden' }).range(from, to));
  ranges.sort((a, b) => a.from - b.from);
  return Decoration.set(ranges);
}

const fenceDecorationPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildFenceDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildFenceDecorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

const fenceTheme = EditorView.theme({
  '& .parsi-fence-hidden': { fontSize: '0' },
});

/**
 * Returns the fence-hiding extensions for the editor.
 * @returns {Array} View plugin plus theme.
 */
export function codeFenceExtensions() {
  return [fenceDecorationPlugin, fenceTheme];
}
