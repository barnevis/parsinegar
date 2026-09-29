// Admonition blocks in the parsneshan style (`...kind` ... `...`).
//
// Collects fenced regions by scanning lines (no lezer grammar needed):
// an opener `...` glued to the kind word (`...هشدار`, spaces allowed too),
// 0-3 spaces indent, optional `>` quote prefix, exact kind word, nothing
// after; a closer `...`; unclosed runs to the document end; no nesting.
// Shaped like a unified block: every fence-region line — fences included —
// carries the kind wash, the opener rounds the top and the closer the
// bottom, and the kind label sits on the opener line. Fence lines hide
// through zero-size marks and reopen wherever the cursor or a selection
// touches them (marks hide unless stood upon); the label persists either
// way. Content lines keep the existing rendering untouched (all inner
// Markdown works for free).
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { FENCE_PATTERN } from './live-preview.js';

/**
 * Admonition kinds: GitHub accents plus a subtle wash per scheme for the
 * unified block background. Text inherits the editor ink, so contrast
 * holds in every theme.
 */
export const ADMONITION_KINDS = {
  'هشدار': {
    label: 'هشدار',
    accent: { light: '#9a6700', dark: '#d29922', sepia: '#9a6700' },
    wash: { light: '#fff8c5', dark: 'rgba(210, 153, 34, 0.15)', sepia: '#faf0c8' },
  },
  'احتیاط': {
    label: 'احتیاط',
    accent: { light: '#cf222e', dark: '#f85149', sepia: '#b91c1c' },
    wash: { light: '#ffebe9', dark: 'rgba(248, 81, 73, 0.15)', sepia: '#f9dcdc' },
  },
  'مهم': {
    label: 'مهم',
    accent: { light: '#8250df', dark: '#ab7df8', sepia: '#7c3aed' },
    wash: { light: '#fbefff', dark: 'rgba(171, 125, 248, 0.15)', sepia: '#ece4fa' },
  },
  'راهنما': {
    label: 'راهنما',
    accent: { light: '#1a7f37', dark: '#3fb950', sepia: '#1a7f37' },
    wash: { light: '#dafbe1', dark: 'rgba(63, 185, 80, 0.15)', sepia: '#ddebd9' },
  },
  'نکته': {
    label: 'نکته',
    accent: { light: '#0969da', dark: '#4493f8', sepia: '#1d4ed8' },
    wash: { light: '#ddf4ff', dark: 'rgba(31, 111, 235, 0.15)', sepia: '#d7e6f9' },
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
 * wash (fences included, so the box reads whole); the opener rounds the
 * top and the closer the bottom (unclosed tails round their last document
 * line instead). Fence lines hide but reopen on touch, per the marks-hide
 * rule, while the kind label on the opener line persists either way.
 * Ranges sort by position; on ties lines precede marks precede the widget
 * (RangeSet side ordering), because the builder rejects out-of-order input.
 * @param {object} view Active editor view.
 * @returns {object} Decoration set.
 */
function buildAdmonitionDecorations(view) {
  const pending = [];
  const { selection } = view.state;
  for (const block of collectAdmonitions(view.state)) {
    const touched = (from, to) => selectionTouches(selection, from, to);
    const openLine = view.state.doc.lineAt(block.openFrom);
    const lastNumber = view.state.doc.lineAt(block.to).number;
    const single = openLine.number === lastNumber;
    // The label shows only while the opener fence stays hidden: standing
    // on the opener line reveals the `...kind` source instead.
    if (!touched(block.openFrom, block.openTo)) {
      pending.push({
        from: block.openFrom,
        order: 2,
        range: Decoration.widget({ widget: new AdmonitionLabelWidget(block.kind), side: -1 }).range(block.openFrom),
      });
    }
    pending.push({
      from: block.openFrom,
      order: 1,
      range: Decoration.line({ class: `parsi-admonition-line parsi-admonition-line-${kindClass(block.kind)} parsi-admonition-first${single ? ' parsi-admonition-last' : ''}` }).range(block.openFrom),
    });
    if (!touched(block.openFrom, block.openTo)) {
      pending.push({
        from: block.openFrom,
        order: 3,
        range: Decoration.mark({ class: 'parsi-fence-hidden' }).range(block.openFrom, block.openTo),
      });
    }
    for (let number = openLine.number + 1; number <= lastNumber; number += 1) {
      const line = view.state.doc.line(number);
      const fence = number === lastNumber && block.to === line.to && CLOSER_PATTERN.test(line.text);
      if (fence) {
        pending.push({
          from: line.from,
          order: 1,
          range: Decoration.line({ class: `parsi-admonition-line parsi-admonition-line-${kindClass(block.kind)} parsi-admonition-last` }).range(line.from),
        });
        if (!touched(line.from, line.to)) {
          pending.push({
            from: line.from,
            order: 3,
            range: Decoration.mark({ class: 'parsi-fence-hidden' }).range(line.from, line.to),
          });
        }
        continue;
      }
      const tail = number === view.state.doc.lines ? ' parsi-admonition-last' : '';
      pending.push({
        from: line.from,
        order: 1,
        range: Decoration.line({ class: `parsi-admonition-line parsi-admonition-line-${kindClass(block.kind)}${tail}` }).range(line.from),
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
 * Builds the structural theme rules (no colors: every wash, border and
 * label ink lives in the scheme theme, so no selector ever collides).
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
  for (const [index] of KIND_NAMES.entries()) {
    spec[`& .cm-line.parsi-admonition-line-${index}`] = {
      paddingInlineStart: '0.6rem',
    };
  }
  spec['& .cm-line.parsi-admonition-first'] = {
    borderTopLeftRadius: '8px',
    borderTopRightRadius: '8px',
  };
  spec['& .cm-line.parsi-admonition-last'] = {
    borderBottomLeftRadius: '8px',
    borderBottomRightRadius: '8px',
  };
  return spec;
}

const admonitionTheme = EditorView.theme(admonitionThemeSpec());

/**
 * Returns the admonition extensions for the editor. Colors ride the
 * color-scheme theme exclusively (see `editor-theme.js`); the base theme
 * above carries structure only.
 * @returns {Array} View plugin plus theme.
 */
export function admonitionViewExtensions() {
  return [admonitionDecorationPlugin, admonitionTheme];
}

/**
 * Returns the scheme colors for admonition washes, borders and labels.
 * Every color lives here (never in the base theme), so no selector
 * collides across schemes.
 * @param {string} colorScheme 'light', 'dark' or 'sepia' (anything else
 *   falls back to light).
 * @returns {object} Plain `{ selector, declarations }` rules for the
 *   scheme theme builder.
 */
export function admonitionSchemeRules(colorScheme) {
  const scheme = colorScheme === 'dark' ? 'dark' : colorScheme === 'sepia' ? 'sepia' : 'light';
  return KIND_NAMES.flatMap((kind, index) => {
    const { accent, wash } = ADMONITION_KINDS[kind];
    return [
      {
        selector: `& .cm-line.parsi-admonition-line-${index}`,
        declarations: {
          backgroundColor: wash[scheme],
          borderInlineStart: `0.25em solid ${accent[scheme]}`,
        },
      },
      {
        selector: `& .parsi-admonition-label-${index}`,
        declarations: { color: accent[scheme] },
      },
    ];
  });
}
