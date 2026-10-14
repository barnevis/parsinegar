// Hanging indent for wrapped list lines in the Persian Markdown editor.
//
// CodeMirror wraps every visual row at the line-box edge, so a wrapped
// item's continuation rows start bare at the edge instead of under the
// item text. Each list-item first line gets `--hang` and the theme pushes
// continuation rows under the text while the negative indent pulls the
// first row back. Pure presentation: cursor, selection and folding never
// notice it.
//
// The gap is a widget width plus raw-text widths, never line coordinates:
// once `--hang` margins land, the line box and its first-row text shift in
// different frames, so coordinate math feeds back into itself on every
// remeasure. A marker widget reports its own border-box width (immune to
// line margins) and raw runs are canvas-measured in the editor font; tabs
// expand to the tab size. Without layout everything stays a graceful zero.
//
// Layout reads are forbidden inside view updates, so measuring happens in
// `requestMeasure` (outside the update cycle) and flows back through an
// annotated transaction; the dispatch is deferred past the update cycle
// because writes may run mid-update, where dispatch is illegal.
import { EditorView } from 'codemirror';
import { Decoration, ViewPlugin } from '@codemirror/view';
import { Annotation } from '@codemirror/state';
import { classifyListLine } from './toggle-mark.js';
import { FENCE_PATTERN } from './live-preview.js';

const MEASURE_KEY = 'parsi-hang';

let canvasCache = null;

/**
 * Returns a 2d context set in the editor font for raw-text measurement.
 * @param {object} view Active editor view.
 * @returns {object|null} Canvas context or null without canvas support.
 */
function measureContext(view) {
  try {
    const font = getComputedStyle(view.contentDOM).font;
    if (!canvasCache || canvasCache.font !== font) {
      const context = document.createElement('canvas').getContext('2d');
      if (!context) {
        return null;
      }
      context.font = font;
      canvasCache = { font, context };
    }
    return canvasCache.context;
  } catch {
    return null;
  }
}

/**
 * Measures raw text with tabs expanded to the tab size.
 * @param {object} context Canvas context in the editor font.
 * @param {object} view Active editor view.
 * @param {string} text Raw text to measure.
 * @returns {number} Width in pixels.
 */
function rawWidth(context, view, text) {
  if (!context || text.length === 0) {
    return 0;
  }
  try {
    return context.measureText(text.replaceAll('\t', ' '.repeat(view.state.tabSize))).width;
  } catch {
    return 0;
  }
}

/**
 * Finds the rendered line element for a document position. Boundary
 * positions of replaced ranges resolve to the container, which suits a
 * descendant query for the widgets.
 * @param {object} view Active editor view.
 * @param {number} pos Document position on the line.
 * @returns {object|null} Line element or null.
 */
function lineElement(view, pos) {
  try {
    const { node } = view.domAtPos(pos);
    const element = node instanceof Element ? node : node?.parentElement;
    return element?.closest?.('.cm-line') ?? null;
  } catch {
    return null;
  }
}

/**
 * Reads the border-box width of a direct-child widget of the line.
 * @param {object|null} lineEl Rendered line element.
 * @param {string} selector Child widget selector.
 * @returns {number|null} Width in pixels, or null without a laid-out widget.
 */
function childWidth(lineEl, selector) {
  const child = lineEl?.querySelector?.(`:scope > ${selector}`);
  if (!child) {
    return null;
  }
  const width = child.getBoundingClientRect().width;
  return width > 0 ? width : null;
}

/**
 * Measures the hanging gap of a list line: indentation plus the marker run.
 * Marker widgets report their own width; raw runs are canvas-measured.
 * Only ever called outside view updates.
 * @param {object} view Active editor view.
 * @param {object} line CodeMirror line object.
 * @param {object} info Classification of the line.
 * @param {object|null} context Canvas context for raw text.
 * @returns {number} Gap in pixels, never negative.
 */
function hangGap(view, line, info, context) {
  const lineEl = lineElement(view, line.from);
  const indentWidth = info.indent.length === 0
    ? 0
    : ((lineEl && childWidth(lineEl, '.parsi-indent')) ?? rawWidth(context, view, info.indent));
  if (info.boxStart >= 0) {
    const boxWidth = (lineEl && childWidth(lineEl, '.parsi-task-marker'))
      ?? rawWidth(context, view, line.text.slice(info.boxStart, info.boxStart + 3));
    return Math.max(0, indentWidth
      + rawWidth(context, view, line.text.slice(info.indent.length, info.boxStart))
      + boxWidth
      + rawWidth(context, view, line.text.slice(info.boxStart + 3, info.headEnd)));
  }
  const markerWidth = (lineEl && childWidth(lineEl, '.parsi-list-marker'))
    ?? rawWidth(context, view, line.text.slice(info.indent.length, info.headEnd));
  return Math.max(0, indentWidth + markerWidth);
}

/**
 * Measures hanging gaps for visible list-item first lines. Fence parity is
 * resolved by scanning from the document start, mirroring the line
 * decorations.
 * @param {object} view Active editor view.
 * @returns {Map<number, number>} Line numbers to gap pixels.
 */
function measureHangWidths(view) {
  const widths = new Map();
  const context = measureContext(view);
  let inFence = false;
  let fenceCheckedUntil = 1;
  for (const { from, to } of view.visibleRanges) {
    const firstLine = view.state.doc.lineAt(from).number;
    for (let number = fenceCheckedUntil; number < firstLine; number += 1) {
      if (FENCE_PATTERN.test(view.state.doc.line(number).text)) {
        inFence = !inFence;
      }
    }
    fenceCheckedUntil = Math.max(fenceCheckedUntil, firstLine);
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      if (FENCE_PATTERN.test(line.text)) {
        inFence = !inFence;
      } else if (!inFence) {
        const info = classifyListLine(line.text);
        if (info.family) {
          widths.set(line.number, Math.round(hangGap(view, line, info, context)));
        }
      }
      pos = line.to + 1;
    }
  }
  return widths;
}

/**
 * Builds hanging-indent decorations for visible list-item first lines,
 * reading measured widths (zero until the first measure resolves).
 * Fence parity is resolved by scanning from the document start, mirroring
 * the line decorations.
 * @param {object} view Active editor view.
 * @param {Map<number, number>} widths Line numbers to gap pixels.
 * @returns {object} Decoration set.
 */
function buildHangDecorations(view, widths) {
  const builder = [];
  let inFence = false;
  let fenceCheckedUntil = 1;
  for (const { from, to } of view.visibleRanges) {
    const firstLine = view.state.doc.lineAt(from).number;
    for (let number = fenceCheckedUntil; number < firstLine; number += 1) {
      if (FENCE_PATTERN.test(view.state.doc.line(number).text)) {
        inFence = !inFence;
      }
    }
    fenceCheckedUntil = Math.max(fenceCheckedUntil, firstLine);
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      if (FENCE_PATTERN.test(line.text)) {
        inFence = !inFence;
      } else if (!inFence) {
        const info = classifyListLine(line.text);
        if (info.family) {
          builder.push(Decoration.line({
            class: 'parsi-hang',
            attributes: { style: `--hang: ${widths.get(line.number) ?? 0}px` },
          }).range(line.from));
        }
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(builder);
}

/**
 * Compares two width maps for the write-back gate.
 * @param {Map<number, number>} left First map.
 * @param {Map<number, number>} right Second map.
 * @returns {boolean} True when identical.
 */
function sameWidths(left, right) {
  if (left.size !== right.size) {
    return false;
  }
  for (const [line, width] of left) {
    if (right.get(line) !== width) {
      return false;
    }
  }
  return true;
}

const forceHang = Annotation.define();

const hangDecorationsPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.widths = new Map();
      this.dead = false;
      this.decorations = buildHangDecorations(view, this.widths);
      this.scheduleMeasure(view);
      queueMicrotask(() => {
        if (!this.dead) {
          try {
            document.fonts?.ready?.then(() => {
              if (!this.dead) {
                this.scheduleMeasure(view);
              }
            });
          } catch {
            // No font API here.
          }
        }
      });
    }

    scheduleMeasure(view) {
      try {
        view.requestMeasure({
          key: MEASURE_KEY,
          read: measureHangWidths,
          write: (widths, measuredView) => this.applyWidths(measuredView, widths),
        });
      } catch {
        // Tearing down or headless without measurement.
      }
    }

    /**
     * Applies fresh widths after the current update cycle settles;
     * requestMeasure writes can run mid-update, where dispatch is illegal.
     */
    applyWidths(view, widths) {
      if (this.dead || sameWidths(widths, this.widths)) {
        return;
      }
      this.widths = widths;
      queueMicrotask(() => {
        if (this.dead) {
          return;
        }
        try {
          view.dispatch({ annotations: forceHang.of(widths) });
        } catch {
          // Late dispatch after teardown.
        }
      });
    }

    update(update) {
      let forced = null;
      for (const transaction of update.transactions) {
        const value = transaction.annotation(forceHang);
        if (value instanceof Map) {
          forced = value;
        }
      }
      if (forced) {
        this.widths = forced;
        this.decorations = buildHangDecorations(update.view, forced);
      } else if (update.docChanged || update.viewportChanged || update.selectionSet) {
        // Selection flips markers between widget and raw text, which have
        // different widths; remeasure outside this update cycle.
        this.scheduleMeasure(update.view);
      }
    }

    destroy() {
      this.dead = true;
    }
  },
  { decorations: (value) => value.decorations },
);

const hangTheme = EditorView.theme({
  // The margin pushes every visual row toward the line end; the negative
  // first-line indent pulls only the first row back. A separate margin
  // (not padding) keeps clear of the list-line padding rule.
  '& .cm-line.parsi-hang': {
    marginInlineStart: 'var(--hang, 0px)',
    textIndent: 'calc(-1 * var(--hang, 0px))',
  },
});

/**
 * Returns the list hanging-indent extensions.
 * @returns {Array} CodeMirror extensions.
 */
export function listHangExtensions() {
  return [hangDecorationsPlugin, hangTheme];
}
