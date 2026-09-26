// Renders Markdown tables as real tables (live preview).
//
// Collects `Table` syntax nodes and replaces each whole span with a <table>
// widget — except where the cursor or a selection touches the span, which
// keeps the editable source visible (the same reveal contract images and
// links already have). Column alignment comes from the delimiter row as
// logical values, so it sits correctly in both directions; cell content
// stays plain text in v1.
//
// Provisioning note: multi-line replacements and block widgets throw
// `RangeError` from ViewPlugin decorations, but StateField values travel
// the direct `EditorView.decorations` facet, where they are allowed —
// which is why this module is a StateField and not a ViewPlugin like the
// other live-preview extensions.
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { StateField } from '@codemirror/state';

/**
 * Resolves one delimiter cell (`:---`, `:--:`, `---:`, `---`) to a
 * logical alignment.
 * @param {string} cell Delimiter cell text.
 * @returns {string} 'start', 'center' or 'end'.
 */
function alignFor(cell) {
  const text = cell.trim();
  const left = text.startsWith(':');
  const right = text.endsWith(':');
  if (left && right) {
    return 'center';
  }
  if (right) {
    return 'end';
  }
  return 'start';
}

/**
 * Reads the plain-text cells of a header or row node.
 * @param {object} doc Document text accessor (`sliceString`).
 * @param {object} node TableHeader or TableRow syntax node.
 * @returns {Array<string>} Cell texts in order.
 */
function readCells(doc, node) {
  const cells = [];
  let child = node.firstChild;
  while (child) {
    if (child.name === 'TableCell') {
      cells.push(doc.sliceString(child.from, child.to));
    }
    child = child.nextSibling;
  }
  return cells;
}

/**
 * Reads one table: header cells, body rows and per-column alignments. The
 * standalone delimiter row lands as a direct TableDelimiter child (pipe
 * separators inside the header nest under TableHeader instead); only a
 * dashes-carrying one counts, and its outer-pipe empties are dropped so
 * index 0 is column 0.
 * @param {object} doc Document text accessor (`sliceString`).
 * @param {object} entered Entered cursor positioned on the Table node.
 * @returns {object|null} `{ from, to, header, rows, aligns }`, or null when
 *   the table has no header cells.
 */
function readTable(doc, entered) {
  const node = entered.node;
  let header = null;
  let aligns = null;
  const rows = [];
  let child = node.firstChild;
  while (child) {
    if (child.name === 'TableHeader' && !header) {
      header = readCells(doc, child);
    } else if (child.name === 'TableDelimiter' && !aligns) {
      const text = doc.sliceString(child.from, child.to);
      if (text.includes('-')) {
        aligns = text.split('|').map((cell) => cell.trim()).filter((cell) => cell.length > 0).map((cell) => alignFor(cell));
      }
    } else if (child.name === 'TableRow') {
      rows.push(readCells(doc, child));
    }
    child = child.nextSibling;
  }
  if (!header || header.length === 0) {
    return null;
  }
  const resolved = header.map((_, index) => aligns?.[index] ?? 'start');
  return { from: node.from, to: node.to, header, rows, aligns: resolved };
}

/**
 * Checks whether any selection range touches `from`..`to` (boundaries
 * inclusive). A touched table keeps its editable source instead of the
 * widget, mirroring the link reveal behavior.
 * @param {object} selection Editor selection state.
 * @param {number} from Span start.
 * @param {number} to Span end.
 * @returns {boolean} True when a range touches the span.
 */
function selectionTouches(selection, from, to) {
  return selection.ranges.some((range) => range.from <= to && range.to >= from);
}

/**
 * Collects renderable tables in one range, ascending. Fenced code owns no
 * Table nodes, so code fences stay out on their own.
 * @param {object} state Editor state.
 * @param {number} from Range start.
 * @param {number} to Range end.
 * @returns {Array} `{ from, to, header, rows, aligns }` tables.
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
      const table = readTable(state.doc, node);
      if (table) {
        tables.push(table);
      }
    },
  });
  tables.sort((a, b) => a.from - b.from || a.to - b.to);
  return tables;
}

/**
 * Builds one table cell (`th` for headers, `td` for body) with its
 * logical alignment. Text travels through `textContent`, never HTML.
 * @param {object} document Owner document.
 * @param {string} tag 'th' or 'td'.
 * @param {string} text Plain cell text.
 * @param {string} align Logical alignment.
 * @returns {HTMLElement} Cell element.
 */
function buildCell(document, tag, text, align) {
  const cell = document.createElement(tag);
  cell.style.textAlign = align;
  cell.textContent = text.trim();
  return cell;
}

/**
 * Table widget for one collected table, wrapped for horizontal scrolling
 * so wide tables never break the paper layout.
 */
class TableWidget extends WidgetType {
  constructor(table) {
    super();
    this.table = table;
  }

  eq(other) {
    return other instanceof TableWidget
      && other.table.from === this.table.from
      && other.table.to === this.table.to
      && JSON.stringify(other.table.header) === JSON.stringify(this.table.header)
      && JSON.stringify(other.table.rows) === JSON.stringify(this.table.rows)
      && JSON.stringify(other.table.aligns) === JSON.stringify(this.table.aligns);
  }

  /**
   * Builds the table node for the collected header, rows and alignments.
   * @returns {HTMLElement} Wrapper holding the table.
   */
  toDOM() {
    const { header, rows, aligns } = this.table;
    const wrapper = document.createElement('div');
    wrapper.className = 'parsi-table-wrapper';
    const table = document.createElement('table');
    table.className = 'parsi-table';
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    header.forEach((text, index) => {
      headRow.append(buildCell(document, 'th', text, aligns[index] ?? 'start'));
    });
    head.append(headRow);
    table.append(head);
    const body = document.createElement('tbody');
    for (const row of rows) {
      const bodyRow = document.createElement('tr');
      // Cells beyond the header ride the last alignment; missing cells
      // simply leave the row shorter, like the source does.
      row.forEach((text, index) => {
        bodyRow.append(buildCell(document, 'td', text, aligns[Math.min(index, aligns.length - 1)] ?? 'start'));
      });
      body.append(bodyRow);
    }
    table.append(body);
    wrapper.append(table);
    return wrapper;
  }
}

/**
 * Builds table decorations over the whole document: the field sees state
 * only (no viewport), and tables are rare enough that a full tree walk per
 * rebuild stays cheap.
 * @param {object} state Editor state.
 * @returns {object} Decoration set.
 */
function buildTableDecorations(state) {
  const builder = [];
  for (const table of collectTablesFrom(state, 0, state.doc.length)) {
    builder.push(Decoration.replace({ widget: new TableWidget(table), block: true }).range(table.from, table.to));
  }
  return Decoration.set(builder);
}

/**
 * Table decorations as a StateField: block replacements cross lines, which
 * the direct `EditorView.decorations` facet allows but ViewPlugin sets do
 * not — hence a field here instead of a plugin like the sibling modules.
 */
export const tableField = StateField.define({
  create(state) {
    return buildTableDecorations(state);
  },
  update(deco, transaction) {
    if (transaction.docChanged || transaction.selection || transaction.reconfigured) {
      return buildTableDecorations(transaction.state);
    }
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const tableTheme = EditorView.theme({
  '& .parsi-table-wrapper': {
    display: 'block',
    overflowX: 'auto',
    marginBlock: '0.5rem',
  },
  '& .parsi-table': {
    borderCollapse: 'collapse',
    minWidth: '60%',
  },
  '& .parsi-table thead th': {
    fontWeight: '700',
    backgroundColor: 'var(--pey-color-surface, #f1f1f5)',
    border: '1px solid var(--pey-color-border, #e2e2e8)',
    padding: '0.3rem 0.6rem',
  },
  '& .parsi-table tbody td': {
    border: '1px solid var(--pey-color-border, #e2e2e8)',
    padding: '0.3rem 0.6rem',
  },
});

/**
 * Returns the live-table extensions for the editor.
 * @returns {Array} Table field plus theme.
 */
export function tableViewExtensions() {
  return [tableField, tableTheme];
}
