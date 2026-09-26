// Admonition blocks in the parsneshan style (`... kind` ... `...`).
//
// Collects fenced regions by scanning lines (no lezer grammar needed):
// an opener `... <kind>` (0-3 spaces indent, optional `>` quote prefix,
// exact kind word, nothing after), a closer `...`, unclosed runs to the
// document end, no nesting. Fence lines hide through zero-size marks and
// reopen wherever the cursor or a selection touches them, so the fences
// stay editable. Content lines keep the existing rendering untouched (all
// inner Markdown works for free) and only carry the kind wash, with a
// small kind-label chip at the content start.
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { FENCE_PATTERN } from './live-preview.js';

/**
 * Admonition kinds: label plus per-scheme accent and wash colors. Accents
 * mirror the code-token palette family so the boxes sit naturally in every
 * theme; washes are translucent fills of the same hue.
 */
export const ADMONITION_KINDS = {
  'هشدار': {
    label: 'هشدار',
    accent: { light: '#b45309', dark: '#fbbf24', sepia: '#b45309' },
    wash: { light: '#fef3c7', dark: '#453008', sepia: '#fbe8b8' },
  },
  'احتیاط': {
    label: 'احتیاط',
    accent: { light: '#c2410c', dark: '#fb923c', sepia: '#c2410c' },
    wash: { light: '#ffedd5', dark: '#432407', sepia: '#fbe3c8' },
  },
  'مهم': {
    label: 'مهم',
    accent: { light: '#b91c1c', dark: '#f87171', sepia: '#b91c1c' },
    wash: { light: '#fee2e2', dark: '#450a0a', sepia: '#f9dcdc' },
  },
  'راهنما': {
    label: 'راهنما',
    accent: { light: '#0e7490', dark: '#5eead4', sepia: '#0e7490' },
    wash: { light: '#cffafe', dark: '#083f4d', sepia: '#c9eef2' },
  },
  'نکته': {
    label: 'نکته',
    accent: { light: '#1d4ed8', dark: '#6ea8ff', sepia: '#1d4ed8' },
    wash: { light: '#dbeafe', dark: '#16295e', sepia: '#d7e6f9' },
  },
};

const OPENER_PATTERN = /^[ \t]{0,3}(?:>[ \t]?)?\.\.\.[ \t]+(\S+)[ \t]*$/;
const CLOSER_PATTERN = /^[ \t]{0,3}(?:>[ \t]?)?\.\.\.[ \t]*$/;

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
 * Scans document lines for admonition fences, skipping fenced code (fence
 * parity from the document start, mirroring `live-preview.js`).
 * @param {object} doc Document text accessor (`line`, `lines`).
 * @returns {Array} `{ kind, openLine, closeLine }` blocks with 1-based
 *   line numbers (closeLine is null when unclosed).
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
      const match = OPENER_PATTERN.exec(text);
      if (match && Object.hasOwn(ADMONITION_KINDS, match[1])) {
        open = { kind: match[1], openLine: number };
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
 * Collects admonition blocks with document ranges.
 * @param {object} state Editor state.
 * @returns {Array} `{ kind, from, to, openFrom, openTo, contentFrom }`
 *   blocks, ascending (from/to span the whole fence region).
 */
export function collectAdmonitions(state) {
  const blocks = [];
  for (const fence of scanFences(state.doc)) {
    const openLine = state.doc.line(fence.openLine);
    const lastNumber = fence.closeLine ?? state.doc.lines;
    const lastLine = state.doc.line(lastNumber);
    blocks.push({
      kind: fence.kind,
      from: openLine.from,
      to: lastLine.to,
      openFrom: openLine.from,
      openTo: openLine.to,
      contentFrom: fence.openLine + 1 <= lastNumber ? state.doc.line(fence.openLine + 1).from : lastLine.to,
    });
  }
  return blocks;
}

/**
 * Kind-label chip shown at the content start.
 */
class AdmonitionLabelWidget extends WidgetType {
  constructor(kind) {
    super();
    this.kind = kind;
  }

  eq(other) {
    return other instanceof AdmonitionLabelWidget && other.kind === this.kind;
  }

  toDOM() {
    const chip = document.createElement('span');
    chip.className = `parsi-admonition-label parsi-admonition-label-${kindClass(this.kind)}`;
    chip.textContent = ADMONITION_KINDS[this.kind].label;
    return chip;
  }
}

/**
 * Maps a kind word to a CSS-safe class suffix.
 * @param {string} kind Kind word.
 * @returns {string} Class suffix.
 */
function kindClass(kind) {
  return Object.keys(ADMONITION_KINDS).indexOf(kind);
}

/**
 * Builds admonition decorations: hidden fence lines (reopened on touch),
 * washed content lines and the kind chip. Ranges sort by position; on ties
 * lines precede the widget (RangeSet side ordering), because the builder
 * rejects out-of-order input.
 * @param {object} view Active editor view.
 * @returns {object} Decoration set.
 */
function buildAdmonitionDecorations(view) {
  const pending = [];
  const { selection } = view.state;
  for (const block of collectAdmonitions(view.state)) {
    const touched = (from, to) => selectionTouches(selection, from, to);
    const openLine = view.state.doc.lineAt(block.openFrom);
    pending.push({
      from: block.contentFrom,
      order: 2,
      range: Decoration.widget({ widget: new AdmonitionLabelWidget(block.kind), side: -1 }).range(block.contentFrom),
    });
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
        range: Decoration.line({ class: `parsi-admonition-line parsi-admonition-line-${kindClass(block.kind)}` }).range(line.from),
      });
    }
  }
  pending.sort((a, b) => a.from - b.from || a.order - b.order);
  return Decoration.set(pending.map((entry) => entry.range));
}

const admonitionDecorationPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildAdmonitionDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildAdmonitionDecorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

const KIND_NAMES = Object.keys(ADMONITION_KINDS);

/**
 * Builds per-kind, per-scheme theme rules from the kind table.
 * @returns {object} EditorView theme spec.
 */
function admonitionThemeSpec() {
  const spec = {
    '& .parsi-fence-hidden': { fontSize: '0' },
    '& .parsi-admonition-label': {
      fontSize: '11px',
      fontWeight: '700',
      borderRadius: '999px',
      padding: '0 0.5rem',
      marginInlineEnd: '0.4rem',
    },
  };
  for (const [index, kind] of KIND_NAMES.entries()) {
    const { accent, wash } = ADMONITION_KINDS[kind];
    spec[`& .cm-line.parsi-admonition-line-${index}`] = {
      backgroundColor: wash.light,
      borderInlineStart: `3px solid ${accent.light}`,
      borderRadius: '4px',
    };
    spec[`& .parsi-admonition-label-${index}`] = {
      backgroundColor: accent.light,
      color: '#ffffff',
    };
  }
  return spec;
}

const admonitionTheme = EditorView.theme(admonitionThemeSpec());

/**
 * Returns the admonition extensions for the editor. Dark/sepia washes ride
 * the color-scheme overrides (see `editor-theme.js`); the base theme above
 * carries the light values.
 * @returns {Array} View plugin plus theme.
 */
export function admonitionViewExtensions() {
  return [admonitionDecorationPlugin, admonitionTheme];
}

/**
 * Returns the dark/sepia scheme overrides for admonition washes. Loads
 * after the base theme (see `markdown-view.js` ordering), so it wins there.
 * @param {boolean} dark True for the dark scheme, false for sepia.
 * @returns {object} Plain `{ selector, declarations }` rules for the
 *   scheme theme builder.
 */
export function admonitionSchemeRules(dark) {
  const scheme = dark ? 'dark' : 'sepia';
  return KIND_NAMES.flatMap((kind, index) => [
    {
      selector: `& .cm-line.parsi-admonition-line-${index}`,
      declarations: {
        backgroundColor: ADMONITION_KINDS[kind].wash[scheme],
        borderInlineStart: `3px solid ${ADMONITION_KINDS[kind].accent[scheme]}`,
      },
    },
    {
      selector: `& .parsi-admonition-label-${index}`,
      // Dark accents are light, so the chip ink flips to dark there.
      declarations: {
        backgroundColor: ADMONITION_KINDS[kind].accent[scheme],
        color: dark ? '#1a1a1a' : '#ffffff',
      },
    },
  ]);
}
