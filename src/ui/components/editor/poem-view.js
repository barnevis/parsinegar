// Persian poem blocks in the parsneshan style (`...شعر` ... `...`).
//
// Collects fenced regions by scanning lines (no lezer grammar needed):
// an opener exactly `...شعر` (0-3 spaces indent, optional `>` quote
// prefix), a closer `...`, unclosed runs to the document end, no nesting.
// Fence lines hide through zero-size marks and reopen wherever the cursor
// or a selection touches them, so the fences stay editable. Content lines
// center; a single-line verse holding two hemistichs (split on a run of
// five or more spaces) renders them as facing halves, while two-line
// verses center whole. Lenient by design: anything unexpected centers as
// plain verse instead of falling back, because the source stays one click
// away either way.
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import { FENCE_PATTERN } from './live-preview.js';

const OPENER_PATTERN = /^[ \t]{0,3}(?:>[ \t]?)?\.\.\.شعر[ \t]*$/;
const CLOSER_PATTERN = /^[ \t]{0,3}(?:>[ \t]?)?\.\.\.[ \t]*$/;
const HEMISTICH_SPLIT_PATTERN = / {5,}/;

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
 * Splits a verse line into hemistich ranges. A run of five or more spaces
 * separates two facing halves; anything else centers whole.
 * @param {string} text Line text.
 * @returns {Array} One or two `{ from, to }` offset ranges (line-relative).
 */
export function splitHemistichs(text) {
  const match = HEMISTICH_SPLIT_PATTERN.exec(text);
  if (!match) {
    return [{ from: 0, to: text.length }];
  }
  return [
    { from: 0, to: match.index },
    { from: match.index + match[0].length, to: text.length },
  ];
}

/**
 * Scans document lines for poem fences, skipping fenced code (fence
 * parity from the document start, mirroring `live-preview.js`).
 * @param {object} doc Document text accessor (`line`, `lines`).
 * @returns {Array} `{ openLine, closeLine }` blocks with 1-based line
 *   numbers (closeLine is null when unclosed).
 */
function scanFences(doc) {
  const blocks = [];
  let open = null;
  let inFence = false;
  for (let number = 1; number <= doc.lines; number += 1) {
    const text = doc.line(number).text;
    if (FENCE_PATTERN.test(text)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    if (!open) {
      if (OPENER_PATTERN.test(text)) {
        open = { openLine: number };
      }
    } else if (CLOSER_PATTERN.test(text)) {
      blocks.push({ ...open, closeLine: number });
      open = null;
    }
  }
  if (open) {
    blocks.push({ ...open, closeLine: null });
  }
  return blocks;
}

/**
 * Collects poem blocks with document ranges.
 * @param {object} state Editor state.
 * @returns {Array} `{ from, to, openFrom, openTo }` blocks, ascending.
 */
export function collectPoems(state) {
  const blocks = [];
  for (const fence of scanFences(state.doc)) {
    const openLine = state.doc.line(fence.openLine);
    const lastNumber = fence.closeLine ?? state.doc.lines;
    const lastLine = state.doc.line(lastNumber);
    blocks.push({
      from: openLine.from,
      to: lastLine.to,
      openFrom: openLine.from,
      openTo: openLine.to,
    });
  }
  return blocks;
}

/**
 * Builds poem decorations: hidden fence lines (reopened on touch),
 * centered verse lines and facing hemistich halves.
 * @param {object} view Active editor view.
 * @returns {object} Decoration set.
 */
function buildPoemDecorations(view) {
  const pending = [];
  const { selection } = view.state;
  for (const block of collectPoems(view.state)) {
    const touched = (from, to) => selectionTouches(selection, from, to);
    const openLine = view.state.doc.lineAt(block.openFrom);
    if (!touched(block.openFrom, block.openTo)) {
      pending.push({
        from: block.openFrom,
        order: 1,
        range: Decoration.mark({ class: 'parsi-fence-hidden' }).range(block.openFrom, block.openTo),
      });
    }
    const lastNumber = view.state.doc.lineAt(block.to).number;
    for (let number = openLine.number + 1; number <= lastNumber; number += 1) {
      const line = view.state.doc.line(number);
      const fence = number === lastNumber && block.to === line.to && CLOSER_PATTERN.test(line.text);
      if (fence) {
        if (!touched(line.from, line.to)) {
          pending.push({
            from: line.from,
            order: 1,
            range: Decoration.mark({ class: 'parsi-fence-hidden' }).range(line.from, line.to),
          });
        }
        continue;
      }
      pending.push({
        from: line.from,
        order: 1,
        range: Decoration.line({ class: 'parsi-poem-line' }).range(line.from),
      });
      const halves = splitHemistichs(line.text);
      const paired = halves.length > 1;
      halves.forEach((half, index) => {
        if (half.to - half.from <= 0) {
          return;
        }
        const side = paired ? (index === 0 ? ' parsi-hemistich-first' : ' parsi-hemistich-last') : '';
        pending.push({
          from: line.from + half.from,
          order: 1,
          range: Decoration.mark({ class: `parsi-hemistich${side}` }).range(line.from + half.from, line.from + half.to),
        });
      });
    }
  }
  pending.sort((a, b) => a.from - b.from || a.order - b.order);
  return Decoration.set(pending.map((entry) => entry.range));
}

const poemDecorationPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildPoemDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildPoemDecorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

const poemTheme = EditorView.theme({
  // Shared with admonitions (same value, self-contained module).
  '& .parsi-fence-hidden': { fontSize: '0' },
  '& .cm-line.parsi-poem-line': { textAlign: 'center' },
  '& .parsi-hemistich-first': {
    display: 'inline-block',
    inlineSize: '50%',
    textAlign: 'right',
  },
  '& .parsi-hemistich-last': {
    display: 'inline-block',
    inlineSize: '50%',
    textAlign: 'left',
  },
});

/**
 * Returns the poem extensions for the editor.
 * @returns {Array} View plugin plus theme.
 */
export function poemViewExtensions() {
  return [poemDecorationPlugin, poemTheme];
}
