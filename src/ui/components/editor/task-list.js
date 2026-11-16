// Task-list rendering for the Persian Markdown editor: `- [ ]` / `- [x]`
// boxes become clickable checkboxes drawn in CSS (a bordered square; the
// border ink is scheme-specific, see editor-theme.js, and a checked box
// carries a CSS-drawn check). The raw box stays in the document and
// reappears only where the cursor (or selection) overlaps it, so the source
// remains plain Markdown. A completed item's text is struck through. Pure
// presentation plus a view-local toggle; no services involved.
import { EditorView } from 'codemirror';
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { collectListParents, hasFoldEffects, isFoldedRange } from './list-fold.js';

/**
 * Matches a task-list item line (unordered or ordered).
 */
export const TASK_LINE_PATTERN = /^[ \t]*(?:[*+-]|\d+[.)])\s+\[[ xX]\]/;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Builds the check mark as an inline SVG: a symmetric glyph flex-centers in
 * the box on its own, where a text glyph proved zero-advance (RTL-shifting)
 * and a rotated border-L leaned off-center at every font size.
 * @returns {SVGElement} Check mark rooted at an `svg` element.
 */
function buildCheckMark() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 10 8');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M1.5 4.4 L4 6.9 L8.5 1.4');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.7');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

/**
 * Returns the toggled box content for a task marker character.
 * @param {string} state Current box content: ' ', 'x' or 'X'.
 * @returns {string} Toggled content: 'x' for open, ' ' for done.
 */
export function toggledBox(state) {
  return state === ' ' ? 'x' : ' ';
}

/**
 * Finds the `[ ]`/`[x]` box range inside a task line, if any.
 * @param {object} line CodeMirror line object.
 * @returns {object|null} `{ from, to, checked }` or null.
 */
function findTaskBox(line, lineStart) {
  const boxStart = line.text.indexOf('[');
  if (boxStart < 0 || boxStart + 3 > line.text.length) {
    return null;
  }
  const box = line.text.slice(boxStart, boxStart + 3);
  const match = /^\[([ xX])\]$/.exec(box);
  if (!match) {
    return null;
  }
  return { from: lineStart + boxStart, to: lineStart + boxStart + 3, checked: match[1] !== ' ' };
}

/**
 * Clickable checkbox replacing a raw task box. Carries its document position
 * so the toggle handler needs no DOM measurement (which has no layout to
 * read from in tests and is needlessly indirect in browsers).
 */
class TaskBoxWidget extends WidgetType {
  constructor(checked, from, fold = null) {
    super();
    this.checked = checked;
    this.from = from;
    this.fold = fold;
  }

  eq(other) {
    return other instanceof TaskBoxWidget
      && other.checked === this.checked
      && other.from === this.from
      && other.fold?.from === this.fold?.from
      && other.fold?.to === this.fold?.to
      && other.fold?.folded === this.fold?.folded;
  }

  ignoreEvent() {
    // Let mousedown reach the editor so the toggle handler runs; the default
    // swallows widget events before any domEventHandler sees them.
    return false;
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = this.fold?.folded === true ? 'parsi-task-marker parsi-list-collapsed' : 'parsi-task-marker';
    span.setAttribute('role', 'checkbox');
    span.setAttribute('aria-checked', String(this.checked));
    span.dataset.taskFrom = String(this.from);
    const box = document.createElement('span');
    box.className = this.checked ? 'parsi-task-box parsi-task-checked' : 'parsi-task-box';
    if (this.checked) {
      const check = document.createElement('span');
      check.className = 'parsi-task-check';
      check.append(buildCheckMark());
      box.append(check);
    }
    span.append(box);
    if (this.fold) {
      span.dataset.foldFrom = String(this.fold.from);
      span.dataset.foldTo = String(this.fold.to);
      // Leading chevron (before the box, mirroring bullet markers). It is
      // an absolute overlay (see list-fold.js), so it never takes flow
      // space and parent rows align with leaf rows in every state.
      const chevron = document.createElement('span');
      chevron.className = 'parsi-list-chevron';
      chevron.setAttribute('aria-hidden', 'true');
      span.prepend(chevron);
    }
    return span;
  }
}

/**
 * Builds checkbox widgets for task lines, leaving the raw box where the
 * cursor (or selection) overlaps it so that exact spot stays editable.
 * Parent task items (those owning a nested list) recolor while folded.
 * @param {object} view Active editor view.
 * @returns {object} Decoration set.
 */
function buildTaskDecorations(view) {
  const selection = view.state.selection.main;
  const builder = [];
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      if (TASK_LINE_PATTERN.test(line.text)) {
        const box = findTaskBox(line, line.from);
        if (box) {
          if (selection.from > box.to || selection.to < box.from) {
            builder.push(
              Decoration.replace({ widget: new TaskBoxWidget(box.checked, box.from, foldOf(view, box.from)) }).range(box.from, box.to),
            );
          }
          // A completed item reads as done wherever the caret sits: the
          // strike covers the item's own text (nested lines keep theirs) but
          // skips the separator space, so struck text never touches the box.
          let strikeFrom = box.to;
          while (strikeFrom < line.to && /[ \t]/.test(line.text[strikeFrom - line.from])) {
            strikeFrom += 1;
          }
          if (box.checked && line.to > strikeFrom) {
            builder.push(Decoration.mark({ class: 'parsi-task-done' }).range(strikeFrom, line.to));
          }
        }
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(builder);
}

/**
 * Reports the fold of the parent list item starting on a position's own
 * line, if any. Descendant lines inside an ancestor's range read null: only
 * the item owning the nested list carries the toggle (mirroring how bullet
 * markers match their own line exactly).
 * @param {object} view Active editor view.
 * @param {number} position Document position.
 * @returns {object|null} `{ from, to, folded }` or null outside own-line parents.
 */
function foldOf(view, position) {
  const line = view.state.doc.lineAt(position);
  for (const parent of collectListParents(view, line.from, line.to)) {
    if (view.state.doc.lineAt(parent.itemFrom).number !== line.number) {
      continue;
    }
    if (position >= parent.itemFrom && position <= parent.itemTo) {
      return {
        from: parent.foldFrom,
        to: parent.foldTo,
        folded: isFoldedRange(view.state, parent.foldFrom, parent.foldTo),
      };
    }
  }
  return null;
}

const taskMarkerPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildTaskDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet || hasFoldEffects(update)) {
        this.decorations = buildTaskDecorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

const taskTheme = EditorView.theme({
  '& .parsi-task-marker': { cursor: 'pointer', color: 'var(--pey-color-accent, #5eead4)', fontWeight: '700' },
  // Structure only — the border ink is the scheme's (editor-theme.js), so
  // every theme step reads softer than pure text yet keeps the scheme hue.
  // vertical-align must be content-independent: an inline-flex baseline is
  // taken from its content when filled and from its bottom edge when empty,
  // which made the box jump on toggle — `middle` pins the margin-box
  // midpoint for both states.
  '& .parsi-task-box': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
    width: '0.95em',
    height: '0.95em',
    borderStyle: 'solid',
    borderWidth: '0.125em',
    borderRadius: '0.2em',
    verticalAlign: 'middle',
  },
  // A completed box fills with the accent token (which resolves at the
  // element, unlike the scheme literals) — border and interior one color —
  // and the drawn check takes the contrasting ink from editor-theme.js.
  '& .parsi-task-box.parsi-task-checked': {
    borderColor: 'var(--pey-color-accent, #5eead4)',
    backgroundColor: 'var(--pey-color-accent, #5eead4)',
  },
  '& .parsi-task-check': { display: 'flex' },
  '& .parsi-task-check svg': { display: 'block', width: '0.62em', height: '0.5em' },
  '& .parsi-task-done': { textDecoration: 'line-through' },
});

/**
 * Returns the task-list extensions: checkbox widgets, click toggle, styles.
 * @returns {Array} CodeMirror extensions.
 */
export function taskListExtensions() {
  return [
    taskMarkerPlugin,
    taskTheme,
    EditorView.domEventHandlers({
      mousedown(event, view) {
        const marker = event.target?.closest?.('.parsi-task-marker');
        if (!marker) {
          return false;
        }
        // Frozen while locked for reading: toggling edits the document.
        if (!view.state.facet(EditorView.editable)) {
          return false;
        }
        const position = Number(marker.dataset?.taskFrom);
        if (!Number.isInteger(position)) {
          return false;
        }
        const box = view.state.doc.sliceString(position, position + 3);
        const match = /^\[([ xX])\]$/.exec(box);
        if (!match) {
          return false;
        }
        event.preventDefault();
        view.dispatch({
          changes: { from: position + 1, to: position + 2, insert: toggledBox(match[1]) },
        });
        return true;
      },
    }),
  ];
}
