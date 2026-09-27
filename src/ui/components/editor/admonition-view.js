// Admonition blocks in the parsneshan style (`...kind` ... `...`).
//
// Collects fenced regions by scanning lines (no lezer grammar needed):
// an opener `...` glued to the kind word (`...هشدار`, spaces allowed too),
// 0-3 spaces indent, optional `>` quote prefix, exact kind word, nothing
// after; a closer `...`; unclosed runs to the document end; no nesting.
// Shaped like GitHub alerts: a thick accent border on content lines plus a
// colored kind label, no background wash. Fence lines hide through
// zero-size marks and reopen wherever the cursor or a selection touches
// them (marks hide unless stood upon). Content lines keep the existing
// rendering untouched (all inner Markdown works for free).
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { FENCE_PATTERN } from './live-preview.js';

/**
 * Admonition kinds in the GitHub shape: a thick accent border plus a
 * colored kind label, no background wash (GitHub renders
 * `.markdown-alert` exactly so: padding, colored left border, accent
 * title). Light/dark accents follow the primer scale; sepia stays in the
 * warm family of the sepia theme.
 */
export const ADMONITION_KINDS = {
  'هشدار': {
    label: 'هشدار',
    accent: { light: '#9a6700', dark: '#d29922', sepia: '#9a6700' },
  },
  'احتیاط': {
    label: 'احتیاط',
    accent: { light: '#cf222e', dark: '#f85149', sepia: '#b91c1c' },
  },
  'مهم': {
    label: 'مهم',
    accent: { light: '#8250df', dark: '#ab7df8', sepia: '#7c3aed' },
  },
  'راهنما': {
    label: 'راهنما',
    accent: { light: '#1a7f37', dark: '#3fb950', sepia: '#1a7f37' },
  },
  'نکته': {
    label: 'نکته',
    accent: { light: '#0969da', dark: '#4493f8', sepia: '#1d4ed8' },
  },
};

// Opener takes the kind glued (`...هشدار`) or spaced (`... هشدار`);
// anything after the kind word voids the block.
const OPENER_PATTERN = /^[ \t]{0,3}(?:>[ \t]?)?\.\.\.[ \t]*(\S+)[ \t]*$/;
const CLOSER_PATTERN = /^[ \t]{0,3}(?:>[ \t]?)?\.\.\.[ \t]*$/;

/**
 * Checks whether any selection range touches `from`..`to` (boundaries
 * inclusive). Touched fence lines reopen for editing, per the project
 * rule that marks hide unless the cursor stands on them.
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
 * Builds admonition decorations: every fence-region line carries the kind
 * wash (fences included, so the box reads whole), fence text additionally
 * wears the kind accent, and the kind chip sits at the content start.
 * Nothing hides, so nothing needs touch reveal. Ranges sort by position;
 * on ties lines precede marks precede the widget (RangeSet side ordering),
 * because the builder rejects out-of-order input.
 * @param {object} view Active editor view.
 * @returns {object} Decoration set.
 */
/**
 * Builds admonition decorations: fence lines hide (reopened on touch, per
 * the marks-hide rule), content lines carry the accent border, and the
 * kind label sits at the content start in the accent color. Ranges sort by
 * position; on ties lines precede marks precede the widget (RangeSet side
 * ordering), because the builder rejects out-of-order input.
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
      order: 3,
      range: Decoration.widget({ widget: new AdmonitionLabelWidget(block.kind), side: -1 }).range(block.contentFrom),
    });
    if (!touched(block.openFrom, block.openTo)) {
      pending.push({
        from: block.openFrom,
        order: 2,
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
            order: 2,
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
      fontSize: '12px',
      fontWeight: '700',
      marginInlineEnd: '0.4rem',
    },
  };
  for (const [index, kind] of KIND_NAMES.entries()) {
    const { accent } = ADMONITION_KINDS[kind];
    spec[`& .cm-line.parsi-admonition-line-${index}`] = {
      borderInlineStart: `0.25em solid ${accent.light}`,
      paddingInlineStart: '0.6rem',
    };
    spec[`& .parsi-admonition-label-${index}`] = {
      color: accent.light,
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
  return KIND_NAMES.flatMap((kind, index) => {
    const { accent } = ADMONITION_KINDS[kind];
    return [
      {
        selector: `& .cm-line.parsi-admonition-line-${index}`,
        declarations: { borderInlineStart: `0.25em solid ${accent[scheme]}` },
      },
      {
        selector: `& .parsi-admonition-label-${index}`,
        declarations: { color: accent[scheme] },
      },
    ];
  });
}
