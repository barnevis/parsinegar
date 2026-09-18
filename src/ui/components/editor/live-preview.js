// Live-preview extensions for the Persian Markdown editor.
//
// Single-pane rendering: formatting marks stay in the document (the source is
// still Markdown) but are visually hidden, while content tokens receive
// rendered styles. This module owns stable `parsi-*` classes via its own
// HighlightStyle plus line and marker decorations; it never relies on
// CodeMirror's generated hashed classes, which renumber with the extension
// set. No services, no events, no business logic — pure presentation.
import { EditorView } from 'codemirror';
import { HighlightStyle, ensureSyntaxTree, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { highlightTree } from '@lezer/highlight';
import { tags } from '@lezer/highlight';
import { TASK_LINE_PATTERN } from './task-list.js';

const PERSIAN_FONT = "'Vazirmatn', Tahoma, sans-serif";
const MONO_FONT = "'Vazirmatn', ui-monospace, monospace";

/**
 * Stable highlight classes for Markdown tokens. Applied alongside the default
 * highlight style; only `parsi-*` classes are targeted by the theme below.
 */
const persianHighlight = HighlightStyle.define([
  { tag: tags.heading1, class: 'parsi-h1' },
  { tag: tags.heading2, class: 'parsi-h2' },
  { tag: tags.heading3, class: 'parsi-h3' },
  { tag: tags.heading4, class: 'parsi-h4' },
  { tag: tags.heading5, class: 'parsi-h5' },
  { tag: tags.heading6, class: 'parsi-h6' },
  { tag: tags.heading, class: 'parsi-heading' },
  { tag: tags.processingInstruction, class: 'parsi-mark' },
  { tag: tags.quote, class: 'parsi-quote' },
  { tag: tags.list, class: 'parsi-list' },
  { tag: tags.emphasis, class: 'parsi-em' },
  { tag: tags.strong, class: 'parsi-strong' },
  { tag: tags.strikethrough, class: 'parsi-strike' },
  { tag: tags.link, class: 'parsi-link' },
  { tag: tags.url, class: 'parsi-url' },
  { tag: tags.monospace, class: 'parsi-code' },
  { tag: tags.labelName, class: 'parsi-label' },
  { tag: tags.string, class: 'parsi-string' },
]);

/**
 * Hides every formatting mark (`#`, `>`, list and emphasis marks, brackets,
 * fences) and styles content as rendered Markdown. A mark reappears only
 * where the cursor (or selection) overlaps it, so the text under edit stays
 * readable in the open while the rest of the line keeps its rendered form.
 */
const livePreviewTheme = EditorView.theme({
  // The base theme draws a dotted outline around the focused editor; on the
  // paper card it looks like a glitch, and the blinking caret already signals
  // focus — so it is explicitly removed.
  '&.cm-focused': { outline: 'none' },
  // Marks hide with zero font size instead of display:none: the boxes stay in
  // layout, so cursor, selection and bidi ordering keep working at mark
  // positions while nothing is painted. The extra .cm-line scope beats
  // content classes (a heading mark carries both parsi-h1 and parsi-mark)
  // regardless of rule order.
  '& .cm-line .parsi-mark': { fontSize: '0' },
  '& .cm-line .parsi-url': { fontSize: '0' },
  '& .cm-line .parsi-label': { fontSize: '0' },
  // Reveal decorations nest around (or inside) the syntax spans, so both
  // the merged and the nested shape must reset the hidden font size.
  '& .cm-line .parsi-mark.parsi-mark-open': { fontSize: '1rem' },
  '& .cm-line .parsi-url.parsi-mark-open': { fontSize: '1rem' },
  '& .cm-line .parsi-label.parsi-mark-open': { fontSize: '1rem' },
  '& .cm-line .parsi-mark-open .parsi-mark': { fontSize: '1rem' },
  '& .cm-line .parsi-mark-open .parsi-url': { fontSize: '1rem' },
  '& .cm-line .parsi-mark-open .parsi-label': { fontSize: '1rem' },
  '& .parsi-heading': { fontWeight: '700', textDecoration: 'none' },
  '& .parsi-h1': { fontSize: '1.7em', fontWeight: '700' },
  '& .parsi-h2': { fontSize: '1.5em', fontWeight: '700' },
  '& .parsi-h3': { fontSize: '1.3em', fontWeight: '700' },
  '& .parsi-h4': { fontSize: '1.18em', fontWeight: '700' },
  '& .parsi-h5': { fontSize: '1.08em', fontWeight: '700' },
  '& .parsi-h6': { fontSize: '1em', fontWeight: '700' },
  '& .parsi-quote-line': {
    borderInlineStart: '3px solid var(--pey-color-border, #b9b9c4)',
    paddingInlineStart: '0.75em',
    color: 'var(--pey-color-text-muted, #55555f)',
  },
  '& .parsi-list-line': { paddingInlineStart: '1em' },
  '& .parsi-list-marker': { color: 'var(--pey-color-text-muted, #6b6b78)', fontWeight: '700' },
  '& .parsi-code-line': { backgroundColor: 'var(--pey-color-surface, #f1f1f4)', fontFamily: MONO_FONT },
  '& .parsi-em': { fontStyle: 'italic' },
  '& .parsi-strong': { fontWeight: '700' },
  '& .parsi-strike': { textDecoration: 'line-through' },
  '& .parsi-link': { color: 'var(--pey-color-accent, #5eead4)', textDecoration: 'underline' },
  '& .parsi-code': {
    fontFamily: MONO_FONT,
    backgroundColor: 'var(--pey-color-surface, #f1f1f4)',
    borderRadius: '4px',
    paddingInline: '0.25em',
  },
  // Opaque code backgrounds (chips and fence lines) paint over CodeMirror's
  // own selection layer, so selected code would keep its background and look
  // unselected. The `parsi-selected` decoration below swaps the span's own
  // background for the selection color instead (an element background always
  // wins, which is exactly what caused the bug). Mark decorations nest as
  // their own element inside (or around) the syntax span, so both nesting
  // directions are covered. `Highlight` tracks the platform selection color,
  // which is what plain text shows in the light scheme; dark and sepia
  // override it with their literals in `editor-theme.js` (which loads after
  // this theme, so it wins there).
  // NOTE: one selector per key — comma selectors with `&` never make it
  // into the injected stylesheet.
  '& .cm-line .parsi-code .parsi-selected': {
    backgroundColor: 'Highlight',
  },
  '& .cm-line .parsi-selected .parsi-code': {
    backgroundColor: 'Highlight',
  },
  '& .cm-line.parsi-code-line.parsi-selected': {
    backgroundColor: 'Highlight',
  },
});

const LIST_PATTERN = /^[ \t]*(?:([*+-])|([0-9\u06F0-\u06F9]+)[.)])\s+/;
const QUOTE_PATTERN = /^[ \t]*>/;
const FENCE_PATTERN = /^[ \t]*```/;

/**
 * Replaces a raw list marker with a rendered bullet or the original number.
 */
class ListMarkerWidget extends WidgetType {
  constructor(label) {
    super();
    this.label = label;
  }

  eq(other) {
    return other instanceof ListMarkerWidget && other.label === this.label;
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = 'parsi-list-marker';
    span.textContent = this.label;
    return span;
  }
}

/**
 * Checks whether any non-collapsed selection range touches `from`..`to`
 * (boundaries inclusive, mirroring `rangesOverlap`). Collapsed cursors never
 * touch: standing in code keeps the chip, only a real selection paints it.
 * @param {object} selection Editor selection state (`ranges` of `{from, to, empty}`).
 * @param {number} from Range start.
 * @param {number} to Range end.
 * @returns {boolean} True on any non-empty overlap.
 */
export function selectionTouches(selection, from, to) {
  return selection.ranges.some((range) => !range.empty && range.from <= to && range.to >= from);
}

/**
 * Builds line decorations (quote/list/code-fence lines) for visible ranges.
 * Fence parity is resolved by scanning from the document start. Fence lines
 * touched by a selection also carry `parsi-selected`, so their opaque
 * background swaps for the selection color (see the theme rule).
 * @param {object} view Active editor view.
 * @returns {object} Decoration set.
 */
function buildLineDecorations(view) {
  const builder = [];
  const { selection } = view.state;
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
      } else if (inFence) {
        const touched = selectionTouches(selection, line.from, line.to);
        builder.push(Decoration.line({
          class: touched ? 'parsi-code-line parsi-selected' : 'parsi-code-line',
        }).range(line.from));
      } else if (QUOTE_PATTERN.test(line.text)) {
        builder.push(Decoration.line({ class: 'parsi-quote-line' }).range(line.from));
      } else if (LIST_PATTERN.test(line.text)) {
        builder.push(Decoration.line({ class: 'parsi-list-line' }).range(line.from));
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(builder);
}

/**
 * Builds marker widgets for list lines, leaving the raw marker where the
 * cursor (or selection) is on the mark glyphs themselves. The skip range
 * ends before the trailing space on purpose: a cursor just past the mark
 * still gets the rendered bullet instead of an invisible gap.
 * @param {object} view Active editor view.
 * @returns {object} Decoration set.
 */
function buildMarkerDecorations(view) {
  const selection = view.state.selection.main;
  const builder = [];
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      if (!TASK_LINE_PATTERN.test(line.text)) {
        const match = LIST_PATTERN.exec(line.text);
        if (match) {
          const markerStart = line.from + match[0].indexOf(match[1] ?? match[2]);
          const markerEnd = line.from + match[0].length;
          if (selection.from >= markerEnd || selection.to < markerStart) {
            const label = match[1] ? '• ' : `${match[2]}. `;
            builder.push(
              Decoration.replace({ widget: new ListMarkerWidget(label) }).range(markerStart, markerEnd),
            );
          }
        }
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(builder);
}

const lineDecorationPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildLineDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildLineDecorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

const CODE_SPAN_PATTERN = /\bparsi-code\b/;

/**
 * Paints selected inline code chips with the selection color. The chip's
 * opaque background covers CodeMirror's own selection layer, so without
 * this the chip would keep its background under a selection and look
 * unselected (while still copying). Only non-collapsed selections paint;
 * a cursor merely standing in code keeps the chip.
 * @param {object} view Active editor view.
 * @returns {object} Decoration set.
 */
function buildSelectionMarks(view) {
  const { selection } = view.state;
  const builder = [];
  if (selection.ranges.every((range) => range.empty)) {
    return Decoration.set(builder);
  }
  // Same forced parse as mark-reveal: the first paint must already cover.
  ensureSyntaxTree(view.state, view.state.doc.length);
  const tree = syntaxTree(view.state);
  if (!tree) {
    return Decoration.set(builder);
  }
  for (const { from, to } of view.visibleRanges) {
    highlightTree(tree, persianHighlight, (rangeFrom, rangeTo, classes) => {
      if (!CODE_SPAN_PATTERN.test(classes)) {
        return;
      }
      if (selectionTouches(selection, rangeFrom, rangeTo)) {
        builder.push(Decoration.mark({ class: 'parsi-selected' }).range(rangeFrom, rangeTo));
      }
    }, from, to);
  }
  return Decoration.set(builder);
}

const selectionPaintPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildSelectionMarks(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildSelectionMarks(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

const markerDecorationPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildMarkerDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildMarkerDecorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

const MARK_REVEAL_PATTERN = /\bparsi-(mark|url|label)\b/;

// Inline spans and headings whose marks open together: when the cursor sits
// anywhere inside such a span (delimiters or content), every mark of that
// span is revealed. Headings count as one span, so standing anywhere on a
// `# Title` (or either line of a setext heading) reveals its marks, just
// like standing on bold text reveals its `**`. Other block marks (quotes,
// list markers) intentionally stay out: they reveal only on exact overlap.
const REVEAL_CONTAINER_NAMES = new Set([
  'Emphasis',
  'StrongEmphasis',
  'InlineCode',
  'Link',
  'Image',
  'Strikethrough',
  'ATXHeading1',
  'ATXHeading2',
  'ATXHeading3',
  'ATXHeading4',
  'ATXHeading5',
  'ATXHeading6',
  'SetextHeading1',
  'SetextHeading2',
]);

/**
 * Collects reveal spans enclosing `from`..`to`: inline formatting spans and
 * whole headings.
 * @param {object} tree Lezer syntax tree.
 * @param {number} from Range start.
 * @param {number} to Range end.
 * @returns {Array<object>} `{ from, to }` container ranges.
 */
export function collectInlineContainers(tree, from, to) {
  const containers = [];
  tree.iterate({
    from,
    to,
    enter(node) {
      if (REVEAL_CONTAINER_NAMES.has(node.name)) {
        containers.push({ from: node.from, to: node.to });
      }
    },
  });
  return containers;
}

/**
 * Checks whether two ranges overlap (boundaries inclusive).
 * @param {number} fromA First range start.
 * @param {number} toA First range end.
 * @param {number} fromB Second range start.
 * @param {number} toB Second range end.
 * @returns {boolean} True on any overlap.
 */
function rangesOverlap(fromA, toA, fromB, toB) {
  return fromA <= toB && toA >= fromB;
}

/**
 * Reveals hidden formatting marks only where the cursor (or selection)
 * overlaps them, so the exact spot under edit opens up while every other
 * mark on the line keeps its rendered form. For inline spans and headings
 * the whole formatted part counts: standing on the text reveals its
 * delimiters too.
 * Mark ranges come from our own highlight definition, so they always match
 * what the theme hides.
 * @param {object} view Active editor view.
 * @returns {object} Decoration set.
 */
function buildMarkRevealDecorations(view) {
  const selection = view.state.selection.main;
  const builder = [];
  // The parser runs incrementally in the background; force it through for
  // the visible document so the first paint already reveals correctly.
  ensureSyntaxTree(view.state, view.state.doc.length);
  const tree = syntaxTree(view.state);
  if (!tree) {
    return Decoration.set(builder);
  }
  for (const { from, to } of view.visibleRanges) {
    const containers = collectInlineContainers(tree, from, to);
    highlightTree(tree, persianHighlight, (rangeFrom, rangeTo, classes) => {
      if (!MARK_REVEAL_PATTERN.test(classes)) {
        return;
      }
      if (rangesOverlap(selection.from, selection.to, rangeFrom, rangeTo)) {
        builder.push(Decoration.mark({ class: 'parsi-mark-open' }).range(rangeFrom, rangeTo));
        return;
      }
      const revealed = containers.some(
        (container) => container.from <= rangeFrom
          && container.to >= rangeTo
          && rangesOverlap(selection.from, selection.to, container.from, container.to),
      );
      if (revealed) {
        builder.push(Decoration.mark({ class: 'parsi-mark-open' }).range(rangeFrom, rangeTo));
      }
    }, from, to);
  }
  return Decoration.set(builder);
}

const markRevealPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildMarkRevealDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildMarkRevealDecorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

/**
 * Returns the live-preview extensions for the Markdown view.
 * @returns {Array} CodeMirror extensions (highlight, theme, decorations).
 */
export function livePreviewExtensions() {
  return [
    syntaxHighlighting(persianHighlight),
    livePreviewTheme,
    lineDecorationPlugin,
    markerDecorationPlugin,
    markRevealPlugin,
    selectionPaintPlugin,
  ];
}
