// Live-preview extensions for the Persian Markdown editor.
//
// Single-pane rendering: formatting marks stay in the document (the source is
// still Markdown) but are visually hidden, while content tokens receive
// rendered styles. This module owns stable `parsi-*` classes via its own
// HighlightStyle plus line and marker decorations; it never relies on
// CodeMirror's generated hashed classes, which renumber with the extension
// set. No services, no events, no business logic — pure presentation.
import { EditorView } from 'codemirror';
import { EditorSelection, EditorState } from '@codemirror/state';
import { HighlightStyle, ensureSyntaxTree, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { highlightTree } from '@lezer/highlight';
import { tags } from '@lezer/highlight';
import { TASK_LINE_PATTERN } from './task-list.js';
import { collectListParents, hasFoldEffects, isFoldedRange } from './list-fold.js';

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
  '& .cm-line.parsi-code-line.parsi-code-first': { borderTopLeftRadius: '8px', borderTopRightRadius: '8px', textAlign: 'left' },
  '& .cm-line.parsi-code-line.parsi-code-last': { borderBottomLeftRadius: '8px', borderBottomRightRadius: '8px' },
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

export const LIST_PATTERN = /^[ \t]*(?:([*+-])|([0-9\u06F0-\u06F9]+)[.)])\s+/;
export const QUOTE_PATTERN = /^[ \t]*>/;
// Shared with `line-direction.js`, which needs the same fence parity to keep
// fenced code left-to-right under a forced direction.
export const FENCE_PATTERN = /^[ \t]*```/;

/**
 * Replaces a raw list marker with a rendered bullet or the original number.
 * Parent items (those owning a nested list) also carry their fold range so
 * the marker click toggles the fold, and a collapsed class that recolors
 * the marker while folded.
 */
class ListMarkerWidget extends WidgetType {
  constructor({ label, bullet = false, parent = false, foldFrom = null, foldTo = null, folded = false }) {
    super();
    this.label = label;
    this.bullet = bullet;
    this.parent = parent;
    this.foldFrom = foldFrom;
    this.foldTo = foldTo;
    this.folded = folded;
  }

  eq(other) {
    return other instanceof ListMarkerWidget
      && other.label === this.label
      && other.bullet === this.bullet
      && other.parent === this.parent
      && other.foldFrom === this.foldFrom
      && other.foldTo === this.foldTo
      && other.folded === this.folded;
  }

  toDOM() {
    const span = document.createElement('span');
    const bullet = this.bullet ? ' parsi-list-bullet' : '';
    const parent = this.parent ? ' parsi-list-parent' : '';
    const collapsed = this.folded ? ' parsi-list-collapsed' : '';
    span.className = `parsi-list-marker${bullet}${parent}${collapsed}`;
    span.textContent = this.label;
    if (Number.isInteger(this.foldFrom) && Number.isInteger(this.foldTo)) {
      span.dataset.foldFrom = String(this.foldFrom);
      span.dataset.foldTo = String(this.foldTo);
      // Overlay chevron (absolute, zero layout impact): the marker glyph
      // never moves whatever the chevron does.
      const chevron = document.createElement('span');
      chevron.className = 'parsi-list-chevron';
      chevron.setAttribute('aria-hidden', 'true');
      span.prepend(chevron);
    }
    return span;
  }

  ignoreEvent() {
    // Let mousedown reach the editor so the fold handler runs; the default
    // swallows widget events before any domEventHandler sees them.
    return false;
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
        // Fence lines open/close the unified block wash: the opener rounds
        // the top, the closer the bottom. Content lines stay square so the
        // strip reads continuous.
        const opener = !inFence;
        const touched = selectionTouches(selection, line.from, line.to);
        const edge = opener ? ' parsi-code-first' : ' parsi-code-last';
        builder.push(Decoration.line({
          class: touched ? `parsi-code-line parsi-selected${edge}` : `parsi-code-line${edge}`,
        }).range(line.from));
        inFence = !inFence;
      } else if (inFence) {
        const touched = selectionTouches(selection, line.from, line.to);
        // Unclosed tails have no closer: the last document line rounds the
        // bottom instead.
        const tail = line.number === view.state.doc.lines ? ' parsi-code-last' : '';
        builder.push(Decoration.line({
          class: touched ? `parsi-code-line parsi-selected${tail}` : `parsi-code-line${tail}`,
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
 * Checks whether the cursor sits exactly at the end of an empty list item
 * (`- ` or `1. ` with nothing after it). The marker widget would hide the
 * cursor behind the number there (no text after it to attach to), so the
 * raw marker stays instead.
 * @param {string} lineText Full line text.
 * @param {number} lineFrom Document offset of the line start.
 * @param {number} markerEnd Document offset just past the marker and its gap.
 * @param {object} selection Main selection (`empty` and `from`).
 * @returns {boolean} True when the raw marker must stay visible.
 */
export function isParkedOnEmptyMarker(lineText, lineFrom, markerEnd, selection) {
  if (!selection || selection.empty !== true || selection.from !== markerEnd) {
    return false;
  }
  return lineText.slice(markerEnd - lineFrom).trim().length === 0;
}

/**
 * Builds marker widgets for list lines, leaving the raw marker where the
 * cursor (or selection) is on the mark glyphs themselves. The skip range
 * ends before the trailing space on purpose: a cursor just past the mark
 * still gets the rendered bullet instead of an invisible gap. One exception:
 * a cursor parked exactly at the end of an *empty* item keeps the raw marker —
 * with no text after it the cursor would paint inside the widget (behind the
 * number) instead of after it. The hidden mark underneath is forced open so
 * `- ` keeps its bullet; the widget pops back with the first character.
 * @param {object} view Active editor view.
 * @returns {object} Decoration set.
 */
function buildMarkerDecorations(view) {
  const selection = view.state.selection.main;
  const builder = [];
  for (const { from, to } of view.visibleRanges) {
    const found = collectListParents(view, from, to);
    const parents = new Map(found.map((parent) => [parent.markerFrom, parent]));
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      if (!TASK_LINE_PATTERN.test(line.text)) {
        const match = LIST_PATTERN.exec(line.text);
        if (match) {
          const markerStart = line.from + match[0].indexOf(match[1] ?? match[2]);
          const markerEnd = line.from + match[0].length;
          const parkedOnEmpty = isParkedOnEmptyMarker(line.text, line.from, markerEnd, selection);
          if ((selection.from >= markerEnd || selection.to < markerStart) && !parkedOnEmpty) {
            const label = match[1] ? '• ' : `${match[2]}. `;
            const parent = parents.get(markerStart) ?? null;
            const folded = parent !== null && isFoldedRange(view.state, parent.foldFrom, parent.foldTo);
            builder.push(
              Decoration.replace({
                widget: new ListMarkerWidget({
                  label,
                  bullet: match[1] !== undefined,
                  parent: parent !== null,
                  foldFrom: parent?.foldFrom ?? null,
                  foldTo: parent?.foldTo ?? null,
                  folded,
                }),
              }).range(markerStart, markerEnd),
            );
          } else if (parkedOnEmpty) {
            builder.push(
              Decoration.mark({ class: 'parsi-mark parsi-mark-open' }).range(markerStart, markerEnd),
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
      if (update.docChanged || update.viewportChanged || update.selectionSet || hasFoldEffects(update)) {
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

// Block marks whose delimiter space hides with them: `# Title` and `> quote`
// keep one real space (sometimes a run, sometimes a tab) after the marks,
// which would otherwise render at the content size and push the line off the
// edge while plain lines hug it. Task boxes stay out: their `[ ]` is replaced
// by a widget, and a mark decoration must never overlap that replacement.
const EXTENDABLE_MARK_NAMES = new Set(['HeaderMark', 'QuoteMark']);

/**
 * Collects heading and quote mark ranges extended over the spaces/tabs that
 * follow them on the same breath (stops at anything else, including the
 * line end). The reveal logic treats the extended range exactly like the
 * mark itself, so the delimiter space vanishes and returns together with it.
 * @param {object} doc Document text accessor (`sliceString`, `length`).
 * @param {object} tree Lezer syntax tree.
 * @param {number} from Range start.
 * @param {number} to Range end.
 * @returns {Array<object>} `{ from, to }` extended ranges.
 */
export function collectExtendedMarkRanges(doc, tree, from, to) {
  const ranges = [];
  tree.iterate({
    from,
    to,
    enter(node) {
      if (!EXTENDABLE_MARK_NAMES.has(node.name)) {
        return;
      }
      let end = node.to;
      while (end < doc.length) {
        const char = doc.sliceString(end, end + 1);
        if (char !== ' ' && char !== '\t') {
          break;
        }
        end += 1;
      }
      ranges.push({ from: node.from, to: end });
      return false;
    },
  });
  return ranges;
}

/**
 * Checks whether a URL range is the whole visible content of its link: a
 * bare autolink (`https://…`), an angle autolink (`<https://…>`) or a link
 * with empty text (`[](https://…)`). Those render nothing without the URL
 * itself, so the URL must stay visible instead of hiding with other marks.
 * @param {object} tree Syntax tree.
 * @param {number} from URL range start.
 * @param {number} to URL range end.
 * @returns {boolean} True when the URL is the link's only content.
 */
export function isBareLinkUrl(tree, from, to) {
  if (!tree) {
    return false;
  }
  // Resolve `.node` inside `enter`: the iterator reuses one cursor, so a
  // stored cursor would have walked on by the time it is read.
  let scope = null;
  tree.iterate({
    from,
    to,
    enter(cursor) {
      const name = cursor.name;
      if ((name === 'Link' || name === 'Autolink' || name === 'Image') && cursor.from <= from && cursor.to >= to) {
        scope = cursor.node ?? scope;
      }
    },
  });
  if (!scope) {
    return true;
  }
  if (scope.name === 'Image') {
    return false;
  }
  // Plain text leaves no node behind, so any gap between the mark and URL
  // children is visible content (e.g. the label of `[text](url)`).
  let pos = scope.from;
  let child = scope.firstChild;
  while (child) {
    if (child.name !== 'URL' && child.name !== 'LinkMark') {
      return false;
    }
    if (child.from > pos) {
      return false;
    }
    pos = Math.max(pos, child.to);
    child = child.nextSibling;
  }
  return pos >= scope.to;
}

/**
 * Reveals hidden formatting marks only where the cursor (or selection)
 * overlaps them, so the exact spot under edit opens up while every other
 * mark on the line keeps its rendered form. For inline spans and headings
 * the whole formatted part counts: standing on the text reveals its
 * delimiters too.
 * Mark ranges come from our own highlight definition, so they always match
 * what the theme hides. Heading and quote marks additionally hide the spaces
 * right after them (collected by `collectExtendedMarkRanges`), otherwise the
 * delimiter space would render at the content size and push the line off the
 * edge while plain lines hug it.
 * Decorations from both sources are collected first and added sorted by
 * position: `RangeSetBuilder` rejects out-of-order ranges, and the two
 * sources interleave arbitrarily (e.g. an opened bold pair later in the
 * document with a hidden heading mark before it).
 * @param {object} view Active editor view.
 * @returns {object} Decoration set.
 */
export function buildMarkRevealDecorations(view) {
  const selection = view.state.selection.main;
  const pending = [];
  // The parser runs incrementally in the background; force it through for
  // the visible document so the first paint already reveals correctly.
  ensureSyntaxTree(view.state, view.state.doc.length);
  const tree = syntaxTree(view.state);
  if (!tree) {
    return Decoration.set([]);
  }
  const containerRevealed = (rangeFrom, rangeTo, containers) => containers.some(
    (container) => container.from <= rangeFrom
      && container.to >= rangeTo
      && rangesOverlap(selection.from, selection.to, container.from, container.to),
  );
  for (const { from, to } of view.visibleRanges) {
    const containers = collectInlineContainers(tree, from, to);
    const extended = collectExtendedMarkRanges(view.state.doc, tree, from, to);
    highlightTree(tree, persianHighlight, (rangeFrom, rangeTo, classes) => {
      if (!MARK_REVEAL_PATTERN.test(classes)) {
        return;
      }
      if (/\bparsi-url\b/.test(classes) && isBareLinkUrl(tree, rangeFrom, rangeTo)) {
        // A URL that is its own link content stays visible and link-styled:
        // the triple class wins over the hiding rule in either nesting order
        // (same-element rule plus the open-descendant rule), with or without
        // the cursor on it.
        pending.push({ from: rangeFrom, to: rangeTo, cls: 'parsi-mark parsi-mark-open parsi-link' });
        return;
      }
      if (rangesOverlap(selection.from, selection.to, rangeFrom, rangeTo)) {
        pending.push({ from: rangeFrom, to: rangeTo, cls: 'parsi-mark-open' });
        return;
      }
      if (containerRevealed(rangeFrom, rangeTo, containers)) {
        pending.push({ from: rangeFrom, to: rangeTo, cls: 'parsi-mark-open' });
      }
    }, from, to);
    for (const range of extended) {
      if (rangesOverlap(selection.from, selection.to, range.from, range.to)) {
        pending.push({ from: range.from, to: range.to, cls: 'parsi-mark-open' });
        continue;
      }
      pending.push({
        from: range.from,
        to: range.to,
        cls: containerRevealed(range.from, range.to, containers) ? 'parsi-mark-open' : 'parsi-mark',
      });
    }
  }
  pending.sort((left, right) => left.from - right.from || left.to - right.to);
  const builder = [];
  let previous = null;
  for (const item of pending) {
    if (!previous || previous.from !== item.from || previous.to !== item.to || previous.cls !== item.cls) {
      builder.push(Decoration.mark({ class: item.cls }).range(item.from, item.to));
      previous = item;
    }
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
 * Pins forward affinity for a cursor parked at the end of an empty list
 * item. With backward affinity (End key, arrows, clicks) the cursor paints
 * inside the marker — behind the number — instead of after it, because no
 * text follows for it to attach to. Only pure selection moves are rewritten;
 * document changes ride through untouched, so typing, undo history and IME
 * composition are unaffected.
 */
const emptyMarkerAssocFilter = EditorState.transactionFilter.of((tr) => {
  if (tr.docChanged) {
    return tr;
  }
  const selection = tr.newSelection.main;
  if (!selection.empty || selection.assoc === 1) {
    return tr;
  }
  const line = tr.newDoc.lineAt(selection.head);
  if (TASK_LINE_PATTERN.test(line.text)) {
    return tr;
  }
  const match = LIST_PATTERN.exec(line.text);
  if (!match || selection.head !== line.from + match[0].length) {
    return tr;
  }
  if (!isParkedOnEmptyMarker(line.text, line.from, selection.head, selection)) {
    return tr;
  }
  return [tr, { selection: EditorSelection.cursor(selection.head, 1) }];
});

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
    emptyMarkerAssocFilter,
  ];
}
