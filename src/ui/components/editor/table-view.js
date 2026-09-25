// Table readability through line decorations (no structural widget).
//
// CodeMirror forbids multi-line replacements and block decorations from
// plugins (`RangeError` in both cases, verified empirically), so a table can
// never become a <table> widget through the decoration path. Instead each
// table line gets a role wash — bold header, muted delimiter, zebra body —
// which keeps the source editable in place with zero layout risk. Tables
// touched by the cursor or a selection are left completely alone.
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';

/**
 * Checks whether any selection range touches `from`..`to` (boundaries
 * inclusive). A touched table keeps its plain rendering.
 * @param {object} selection Editor selection state.
 * @param {number} from Span start.
 * @param {number} to Span end.
 * @returns {boolean} True when a range touches the span.
 */
function selectionTouches(selection, from, to) {
  return selection.ranges.some((range) => range.from <= to && range.to >= from);
}

/**
 * Collects table spans in one range, ascending. Fenced code owns no Table
 * nodes, so code fences stay out on their own.
 * @param {object} state Editor state.
 * @param {number} from Range start.
 * @param {number} to Range end.
 * @returns {Array} `{ from, to }` table spans.
 */
export function collectTablesFrom(state, from, to) {
  const tree = syntaxTree(state);
  const tables = [];
  tree.iterate({
    from,
    to,
    enter(node) {
      if (node.name !== 'Table') {
        return;
      }
      if (selectionTouches(state.selection, node.from, node.to)) {
        return;
      }
      tables.push({ from: node.from, to: node.to });
    },
  });
  tables.sort((a, b) => a.from - b.from || a.to - b.to);
  return tables;
}

/**
 * Collects table spans in the visible ranges.
 * @param {object} view Active editor view.
 * @returns {Array} `{ from, to }` table spans, ascending.
 */
export function collectTables(view) {
  const tables = [];
  for (const { from, to } of view.visibleRanges) {
    tables.push(...collectTablesFrom(view.state, from, to));
  }
  tables.sort((a, b) => a.from - b.from || a.to - b.to);
  return tables;
}

/**
 * Builds role decorations for the visible ranges: the first line of each
 * table is the header, the second the delimiter, the rest zebra body rows.
 * @param {object} view Active editor view.
 * @returns {object} Decoration set.
 */
function buildTableDecorations(view) {
  const builder = [];
  for (const table of collectTables(view)) {
    const firstLine = view.state.doc.lineAt(table.from).number;
    const lastLine = view.state.doc.lineAt(table.to).number;
    for (let number = firstLine; number <= lastLine; number += 1) {
      const line = view.state.doc.line(number);
      const role = number === firstLine
        ? 'parsi-table-header'
        : number === firstLine + 1
          ? 'parsi-table-delimiter'
          : (number - firstLine) % 2 === 1 ? 'parsi-table-row-alt' : 'parsi-table-row';
      builder.push(Decoration.line({ class: role }).range(line.from));
    }
  }
  return Decoration.set(builder);
}

const tableDecorationPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildTableDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildTableDecorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

const tableTheme = EditorView.theme({
  '& .cm-line.parsi-table-header': {
    fontWeight: '700',
    backgroundColor: 'var(--pey-color-surface, #f1f1f5)',
  },
  '& .cm-line.parsi-table-delimiter': {
    color: 'var(--pey-color-text-muted, #6b6b78)',
  },
  '& .cm-line.parsi-table-row-alt': {
    backgroundColor: 'rgb(127 127 127 / 0.08)',
  },
});

/**
 * Returns the table readability extensions for the editor.
 * @returns {Array} View plugin plus theme.
 */
export function tableViewExtensions() {
  return [tableDecorationPlugin, tableTheme];
}
