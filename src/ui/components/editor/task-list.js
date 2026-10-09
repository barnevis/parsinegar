// Task-list rendering for the Persian Markdown editor: `- [ ]` / `- [x]`
// boxes become clickable checkboxes (☐/☑). The raw box stays in the document
// and reappears only where the cursor (or selection) overlaps it, so the
// source remains plain Markdown. Pure presentation plus a view-local toggle;
// no services involved.
import { EditorView } from 'codemirror';
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { collectListParents, hasFoldEffects, isFoldedRange } from './list-fold.js';

/**
 * Matches a task-list item line (unordered or ordered).
 */
export const TASK_LINE_PATTERN = /^[ \t]*(?:[*+-]|\d+[.)])\s+\[[ xX]\]/;

const CHECKED_GLYPH = '☑';
const UNCHECKED_GLYPH = '☐';

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
    span.textContent = this.checked ? CHECKED_GLYPH : UNCHECKED_GLYPH;
    span.setAttribute('role', 'checkbox');
    span.setAttribute('aria-checked', String(this.checked));
    span.dataset.taskFrom = String(this.from);
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
        if (box && (selection.from > box.to || selection.to < box.from)) {
          builder.push(
            Decoration.replace({ widget: new TaskBoxWidget(box.checked, box.from, foldOf(view, box.from)) }).range(box.from, box.to),
          );
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
