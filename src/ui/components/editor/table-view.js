// Renders Markdown tables as real tables (live preview), editable in place.
//
// Collects `Table` syntax nodes and replaces each whole span with a <table>
// widget — except where the cursor or a selection touches the span, which
// keeps the editable source visible (the same reveal contract images and
// links already have). Clicking a rendered cell edits it right there
// (contentEditable with raw-text swap on focus); Enter and blur commit one
// surgical source edit, Escape cancels, Tab steps between cells. A corner
// source toggle parks the cursor in the first cell, revealing the source
// through the ordinary selection-touch contract — no extra mode state.
// Column alignment comes from the delimiter row as logical values, so it
// sits correctly in both directions; cell content keeps its inline marks
// (strong, emphasis, code, links, images) rendered from the syntax tree,
// never from reparsed HTML.
//
// Provisioning note: multi-line replacements and block widgets throw
// `RangeError` from ViewPlugin decorations, but StateField values travel
// the direct `EditorView.decorations` facet, where they are allowed —
// which is why this module is a StateField and not a ViewPlugin like the
// other live-preview extensions.
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, WidgetType, keymap } from '@codemirror/view';
import { EditorSelection, Facet, Prec, StateField } from '@codemirror/state';
import { escapeHtml, iconMarkup } from '../workbench/html.js';

const REMOTE_PATTERN = /^https?:\/\//i;
// Marks own no content: gaps between children carry the plain text, and
// these names are skipped while walking.
const MARK_NAMES = new Set(['EmphasisMark', 'CodeMark', 'StrikethroughMark', 'LinkMark', 'URL']);

/**
 * Reads the alt text of an Image node (raw slice between `![` and `]`).
 * @param {object} doc Document text accessor (`sliceString`).
 * @param {object} node Image syntax node.
 * @returns {string} Alt text.
 */
function readImageAlt(doc, node) {
  let child = node.firstChild;
  while (child) {
    if (child.name === 'LinkMark' && doc.sliceString(child.from, child.to) === ']') {
      return doc.sliceString(node.from + 2, child.from);
    }
    child = child.nextSibling;
  }
  return '';
}

/**
 * Reads one Image node as a segment.
 * @param {object} doc Document text accessor (`sliceString`).
 * @param {object} node Image syntax node.
 * @returns {object} `{ t: 'image', alt, src }` segment.
 */
function readImageSegment(doc, node) {
  let src = '';
  let child = node.firstChild;
  while (child) {
    if (child.name === 'URL' && src === '') {
      src = doc.sliceString(child.from, child.to);
    }
    child = child.nextSibling;
  }
  return { t: 'image', alt: readImageAlt(doc, node), src };
}

/**
 * Reads the href of a Link node (its URL child).
 * @param {object} doc Document text accessor (`sliceString`).
 * @param {object} node Link syntax node.
 * @returns {string} URL text, or '' when absent.
 */
function readLinkHref(doc, node) {
  let child = node.firstChild;
  while (child) {
    if (child.name === 'URL') {
      return doc.sliceString(child.from, child.to);
    }
    child = child.nextSibling;
  }
  return '';
}

/**
 * Reads inline content as segments: plain-text gaps plus formatted spans
 * (strong, emphasis, strikethrough, code, links, images). Unknown
 * containers flatten into their children; marks never surface.
 * @param {object} doc Document text accessor (`sliceString`).
 * @param {object} node Syntax node whose children to read.
 * @returns {Array} Segments (`text`, `strong`, `em`, `strike`, `code`,
 *   `link` with href, `image` with alt/src).
 */
function readInline(doc, node) {
  const segments = [];
  let pos = node.from;
  const flush = (to) => {
    if (to > pos) {
      segments.push({ t: 'text', text: doc.sliceString(pos, to) });
    }
    pos = to;
  };
  let child = node.firstChild;
  while (child) {
    flush(child.from);
    if (child.name === 'StrongEmphasis') {
      segments.push({ t: 'strong', kids: readInline(doc, child) });
    } else if (child.name === 'Emphasis') {
      segments.push({ t: 'em', kids: readInline(doc, child) });
    } else if (child.name === 'Strikethrough') {
      segments.push({ t: 'strike', kids: readInline(doc, child) });
    } else if (child.name === 'InlineCode') {
      segments.push({ t: 'code', kids: readInline(doc, child) });
    } else if (child.name === 'Link') {
      segments.push({ t: 'link', href: readLinkHref(doc, child), kids: readInline(doc, child) });
    } else if (child.name === 'Image') {
      segments.push(readImageSegment(doc, child));
    } else if (!MARK_NAMES.has(child.name)) {
      // Unknown containers flatten into their children; marks vanish.
      segments.push(...readInline(doc, child));
    }
    pos = child.to;
    child = child.nextSibling;
  }
  flush(node.to);
  return segments;
}

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
 * Reads the inline segments of the cells of a header or row node.
 * @param {object} doc Document text accessor (`sliceString`).
 * @param {object} node TableHeader or TableRow syntax node.
 * @returns {Array} One segment array per cell, in order.
 */
function readCells(doc, node) {
  const cells = [];
  let child = node.firstChild;
  while (child) {
    if (child.name === 'TableCell') {
      cells.push(readInline(doc, child));
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
 * Renders inline segments into a parent node. Text travels through
 * `textContent` and links/images accept remote http(s) targets only, so no
 * markup from the document ever reaches the DOM as HTML.
 * @param {object} document Owner document.
 * @param {HTMLElement} parent Parent node.
 * @param {Array} segments Inline segments.
 * @returns {void}
 */
function renderInline(document, parent, segments) {
  for (const segment of segments) {
    if (segment.t === 'strong' || segment.t === 'em' || segment.t === 'strike' || segment.t === 'code') {
      const tag = segment.t === 'strong' ? 'strong' : segment.t === 'em' ? 'em' : segment.t === 'strike' ? 'del' : 'code';
      const element = document.createElement(tag);
      if (tag === 'code') {
        element.className = 'parsi-table-code';
      }
      renderInline(document, element, segment.kids ?? []);
      parent.append(element);
    } else if (segment.t === 'link') {
      const kids = segment.kids ?? [];
      if (REMOTE_PATTERN.test(segment.href ?? '')) {
        const anchor = document.createElement('a');
        anchor.className = 'parsi-table-link';
        anchor.href = segment.href;
        anchor.target = '_blank';
        anchor.rel = 'noopener';
        renderInline(document, anchor, kids);
        parent.append(anchor);
      } else {
        const span = document.createElement('span');
        renderInline(document, span, kids);
        parent.append(span);
      }
    } else if (segment.t === 'image') {
      if (REMOTE_PATTERN.test(segment.src ?? '')) {
        const picture = document.createElement('img');
        picture.className = 'parsi-table-image';
        picture.src = segment.src;
        picture.alt = segment.alt ?? '';
        const fallback = document.createElement('span');
        fallback.textContent = segment.alt ?? '';
        picture.addEventListener('error', () => {
          picture.replaceWith(fallback);
        }, { once: true });
        parent.append(picture);
      } else {
        parent.append(document.createTextNode(segment.alt ?? ''));
      }
    } else {
      parent.append(document.createTextNode(segment.text ?? ''));
    }
  }
}

/**
 * Finds one table cell by position: header is row -1, body rows count from
 * zero, columns count from zero. Pure over the syntax tree (no DOM), so a
 * click on a rendered cell maps back to exact source offsets.
 * @param {object} state Editor state.
 * @param {number} tableFrom Document offset of the Table node.
 * @param {number} row Row index (-1 for the header).
 * @param {number} col Column index.
 * @returns {object|null} `{ from, to }` source range, or null when absent.
 */
export function findTableCell(state, tableFrom, row, col) {
  const tree = syntaxTree(state);
  if (!tree) {
    return null;
  }
  // The iterator reuses one cursor: resolve `.node` inside `enter`, never
  // store the cursor itself (it keeps walking after the callback returns).
  let table = null;
  tree.iterate({
    enter(cursor) {
      if (cursor.name === 'Table' && cursor.from === tableFrom) {
        table = cursor.node;
      }
    },
  });
  if (!table) {
    return null;
  }
  let bodyIndex = -1;
  let child = table.firstChild;
  while (child) {
    if (child.name === 'TableHeader' || child.name === 'TableRow') {
      bodyIndex += child.name === 'TableRow' ? 1 : 0;
      if ((child.name === 'TableHeader' && row === -1) || bodyIndex === row) {
        let cellIndex = -1;
        let cell = child.firstChild;
        while (cell) {
          if (cell.name === 'TableCell') {
            cellIndex += 1;
            if (cellIndex === col) {
              return { from: cell.from, to: cell.to };
            }
          }
          cell = cell.nextSibling;
        }
        return null;
      }
    }
    child = child.nextSibling;
  }
  return null;
}

/**
 * Finds the editable start of a cell: first character that is not a space,
 * tab or pipe. Works whether the cell range includes its pipes or not.
 * @param {string} text Document text slice covering at least the range.
 * @param {number} from Range start (offset into text).
 * @param {number} to Range end (offset into text).
 * @returns {number} Content offset.
 */
export function cellContentStart(text, from, to) {
  let pos = from;
  while (pos < to && (text[pos] === ' ' || text[pos] === '\t' || text[pos] === '|')) {
    pos += 1;
  }
  return pos;
}

/**
 * Finds the editable end of a cell: last character that is not a space,
 * tab or pipe. Mirror of cellContentStart for the commit range.
 * @param {string} text Document text slice covering at least the range.
 * @param {number} from Range start (offset into text).
 * @param {number} to Range end (offset into text).
 * @returns {number} Content end offset (exclusive).
 */
export function cellContentEnd(text, from, to) {
  let pos = to;
  while (pos > from && (text[pos - 1] === ' ' || text[pos - 1] === '\t' || text[pos - 1] === '|')) {
    pos -= 1;
  }
  return pos;
}

/**
 * Sanitizes edited cell text back into a single table cell: pipes are
 * escaped so the grid survives, line breaks fold to spaces (cells are
 * single-line; Enter commits instead of inserting).
 * @param {string} text Raw edited text.
 * @returns {string} Source-safe cell content.
 */
export function escapeCellText(text) {
  return text.replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
}

/**
 * Resolves the source range an in-place cell edit must replace: the cell
 * content without surrounding padding and pipes. Cells without a source
 * range (padded cells, and empty cells the parser drops) resolve to null
 * and stay read-only.
 * @param {object} state Editor state.
 * @param {number} tableFrom Document offset of the Table node.
 * @param {number} row Row index (-1 for the header).
 * @param {number} col Column index.
 * @returns {object|null} `{ from, to }` content range, or null.
 */
export function cellEditRange(state, tableFrom, row, col) {
  const range = findTableCell(state, tableFrom, row, col);
  if (!range) {
    return null;
  }
  const text = state.doc.sliceString(range.from, range.to);
  const start = range.from + cellContentStart(text, 0, text.length);
  const end = range.from + cellContentEnd(text, 0, text.length);
  if (end <= start) {
    return null;
  }
  return { from: start, to: end };
}

/**
 * Builds one table cell (`th` for headers, `td` for body) with its
 * logical alignment and formatted inline content. Cells with an edit
 * context become in-place editable unless locked; padded (sourceless)
 * cells are marked and stay read-only.
 * @param {object} document Owner document.
 * @param {string} tag 'th' or 'td'.
 * @param {Array} segments Inline cell segments.
 * @param {string} align Logical alignment.
 * @param {number} row Row index (-1 for the header).
 * @param {number} col Column index.
 * @param {number} tableFrom Document offset of the Table node.
 * @param {object|null} edit `{ view, padded }`, or null without editing.
 * @returns {HTMLElement} Cell element.
 */
function buildCell(document, tag, segments, align, row, col, tableFrom, edit) {
  const cell = document.createElement(tag);
  cell.style.textAlign = align;
  cell.dataset.tableRow = String(row);
  cell.dataset.tableCol = String(col);
  cell.dataset.tableFrom = String(tableFrom);
  renderInline(document, cell, segments);
  if (edit?.padded === true) {
    cell.dataset.padded = 'true';
    return cell;
  }
  if (edit && edit.view.state.readOnly !== true) {
    wireEditableCell(document, edit.view, cell, segments, row, col, tableFrom);
  }
  return cell;
}

/**
 * Makes a rendered cell editable in place: focus swaps the rendered marks
 * for the raw source text, blur or Enter commits a surgical source edit,
 * Escape cancels, Tab steps between editable cells. Commits dispatch one
 * transaction (one undo step); unchanged blurs dispatch nothing. Listeners
 * are native DOM (the widget ignores CodeMirror events), so typing never
 * disturbs the outer selection until a commit lands.
 * @param {object} document Owner document.
 * @param {object} view Active editor view.
 * @param {object} cell Rendered cell element.
 * @param {Array} segments Inline segments for restoring the rendered view.
 * @param {number} row Row index (-1 for the header).
 * @param {number} col Column index.
 * @param {number} tableFrom Document offset of the Table node.
 * @returns {void}
 */
function wireEditableCell(document, view, cell, segments, row, col, tableFrom) {
  const range = cellEditRange(view.state, tableFrom, row, col);
  if (!range) {
    return;
  }
  cell.setAttribute('contenteditable', 'true');
  cell.spellcheck = false;
  cell.dataset.raw = view.state.doc.sliceString(range.from, range.to);
  let busy = false;
  let cancelled = false;
  const restore = () => {
    cell.replaceChildren();
    renderInline(document, cell, segments);
  };
  const commit = () => {
    if (busy || view.state.readOnly === true) {
      return false;
    }
    const current = cell.textContent ?? '';
    if (current === (cell.dataset.raw ?? '')) {
      return false;
    }
    // Re-entrancy guard: the dispatch below rebuilds the widget and can
    // blur this node synchronously; the dataset write makes a late blur a
    // no-op before the stale range is ever touched.
    busy = true;
    cell.dataset.raw = current;
    try {
      view.dispatch({ changes: { from: range.from, to: range.to, insert: escapeCellText(current) } });
    } finally {
      busy = false;
    }
    return true;
  };
  cell.addEventListener('focus', () => {
    cell.textContent = cell.dataset.raw ?? '';
  });
  cell.addEventListener('blur', (event) => {
    if (cancelled) {
      cancelled = false;
      return;
    }
    // `relatedTarget` duck-typing (not `instanceof Element`): the test DOM
    // does not expose the Element global, and only the closest lookup matters.
    const related = event.relatedTarget;
    const pending = related && typeof related.closest === 'function'
      ? related.closest('.parsi-table-source, [data-table-row]')
      : null;
    if (!commit()) {
      restore();
      return;
    }
    if (!pending || pending.isConnected) {
      return;
    }
    queueMicrotask(() => {
      if (pending.classList.contains('parsi-table-source')) {
        const table = pending.dataset.tableFrom;
        const fresh = table === undefined
          ? null
          : view.dom.querySelector(`.parsi-table-source[data-table-from="${table}"]`);
        fresh?.click();
      } else {
        const fresh = editableCellsOf(view, pending.dataset.tableFrom)
          .find((candidate) => candidate.dataset.tableRow === pending.dataset.tableRow
            && candidate.dataset.tableCol === pending.dataset.tableCol);
        fresh?.focus({ preventScroll: true });
      }
    });
  });
  cell.addEventListener('keydown', (event) => {
    if (event.isComposing) {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      cell.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelled = true;
      restore();
      cell.blur();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      commit();
      focusNeighborCell(view, tableFrom, row, col, event.shiftKey ? -1 : 1);
    }
  });
}

/**
 * Lists the editable cells of one table in logical order (header first,
 * then rows), from the live DOM.
 * @param {object} view Active editor view.
 * @param {string} tableFrom Document offset of the Table node, as stored
 *   in the dataset.
 * @returns {Array} Cell elements, sorted by row then column.
 */
function editableCellsOf(view, tableFrom) {
  const cells = [...view.dom.querySelectorAll('[data-table-from]')].filter(
    (cell) => cell.dataset.tableFrom === String(tableFrom)
      && cell.isConnected
      && cell.getAttribute('contenteditable') === 'true',
  );
  cells.sort((a, b) => Number(a.dataset.tableRow) - Number(b.dataset.tableRow)
    || Number(a.dataset.tableCol) - Number(b.dataset.tableCol));
  return cells;
}

/**
 * Moves focus between the editable cells of one table in logical order
 * (header first, then rows). Eddies out with a blur past either end.
 * Queries the live DOM, since a commit just rebuilt it.
 * @param {object} view Active editor view.
 * @param {number} tableFrom Document offset of the Table node.
 * @param {number} row Row index of the current cell.
 * @param {number} col Column index of the current cell.
 * @param {number} direction +1 forward, -1 backward.
 * @returns {void}
 */
function focusNeighborCell(view, tableFrom, row, col, direction) {
  const cells = editableCellsOf(view, tableFrom);
  const index = cells.findIndex(
    (cell) => Number(cell.dataset.tableRow) === row && Number(cell.dataset.tableCol) === col,
  );
  const next = cells[index + direction];
  if (next) {
    next.focus();
  } else {
    cells[index]?.blur();
  }
}

/**
 * Builds the per-table source toggle: a compact toolbar button that parks
 * the cursor in the first header cell, which reveals the source through
 * the ordinary selection-touch contract. No extra state: leaving the
 * source (clicking elsewhere) returns the rendered table.
 * @param {object} document Owner document.
 * @param {object} view Active editor view.
 * @param {number} tableFrom Document offset of the Table node.
 * @returns {HTMLElement} Toggle button.
 */
function buildSourceButton(document, view, tableFrom) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'parsi-table-source';
  button.dataset.tableFrom = String(tableFrom);
  const label = 'نمایش سورس جدول';
  const icon = iconMarkup(view.state.facet(tableIconBase), 'code');
  if (icon) {
    button.innerHTML = icon;
  } else {
    button.textContent = 'سورس';
  }
  button.setAttribute('aria-label', escapeHtml(label));
  button.setAttribute('title', escapeHtml(label));
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const target = tableCellCursor(view.state, tableFrom, -1, 0) ?? tableFrom;
    view.dispatch({ selection: EditorSelection.cursor(target), scrollIntoView: true });
    view.focus();
  });
  return button;
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

  ignoreEvent() {
    // The widget owns its DOM: cell editing, the source toggle and Tab
    // travel through native listeners, so CodeMirror must not manage
    // focus, selection or keys inside the table.
    return true;
  }

  /**
   * Builds the table node for the collected header, rows and alignments.
   * @param {object} view Active editor view.
   * @returns {HTMLElement} Wrapper holding the source toggle and the table.
   */
  toDOM(view) {
    const { header, rows, aligns } = this.table;
    const wrapper = document.createElement('div');
    wrapper.className = 'parsi-table-wrapper';
    const bar = document.createElement('div');
    bar.className = 'parsi-table-bar';
    bar.append(buildSourceButton(document, view, this.table.from));
    wrapper.append(bar);
    const table = document.createElement('table');
    table.className = 'parsi-table';
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    header.forEach((segments, index) => {
      headRow.append(buildCell(document, 'th', segments, aligns[index] ?? 'start', -1, index, this.table.from, { view, padded: false }));
    });
    head.append(headRow);
    table.append(head);
    const body = document.createElement('tbody');
    rows.forEach((cells, rowIndex) => {
      const bodyRow = document.createElement('tr');
      // Cells beyond the header ride the last alignment; rows shorter than
      // the header are padded with empty cells (like GFM renderers), so
      // every row carries the full border frame instead of leaving the row
      // shorter. Padded cells carry no source range: click mapping already
      // returns null for them and Tab stops come from the tree, so both
      // safely skip padded cells.
      cells.forEach((segments, index) => {
        bodyRow.append(buildCell(document, 'td', segments, aligns[Math.min(index, aligns.length - 1)] ?? 'start', rowIndex, index, this.table.from, { view, padded: false }));
      });
      for (let index = cells.length; index < header.length; index += 1) {
        bodyRow.append(buildCell(document, 'td', [], aligns[Math.min(index, aligns.length - 1)] ?? 'start', rowIndex, index, this.table.from, { view, padded: true }));
      }
      body.append(bodyRow);
    });
    table.append(body);
    wrapper.append(table);
    return wrapper;
  }
}

/**
 * Asset base for table chrome icons, provided by tableViewExtensions.
 * Null (tests, bare mounts) falls back to a text label.
 */
const tableIconBase = Facet.define({
  combine: (values) => (typeof values[0] === 'string' ? values[0] : null),
});

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
  '& .parsi-table-bar': {
    display: 'flex',
    justifyContent: 'flex-end',
    marginBlockEnd: '0.25rem',
  },
  '& .parsi-table-source': {
    font: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    inlineSize: '1.75rem',
    blockSize: '1.75rem',
    border: '1px solid transparent',
    borderRadius: '8px',
    backgroundColor: 'transparent',
    padding: '0.2rem',
    cursor: 'pointer',
    color: 'inherit',
  },
  '& .parsi-table-source:hover': {
    backgroundColor: 'var(--pey-color-surface, #f1f1f5)',
  },
  '& .parsi-table-source svg': {
    inlineSize: '1rem',
    blockSize: '1rem',
  },
  '& .parsi-table': {
    borderCollapse: 'collapse',
    minWidth: '60%',
    // Whole-word breaking only: cells inherit `overflow-wrap: anywhere`
    // and `word-break: break-word` from the wrapping editor, which collapse
    // min-content toward zero and let auto layout squeeze columns narrower
    // than a word (mid-word breaks like «تصمیم»). Both back to `normal`
    // restores word floors, so columns share the wrapper fairly and wrap at
    // spaces; unbreakable runs overflow the cell and ride the wrapper
    // scroll instead.
    overflowWrap: 'normal',
    wordBreak: 'normal',
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
  '& .parsi-table-link': {
    color: 'var(--pey-color-accent, #0e7490)',
  },
  '& .parsi-table-code': {
    fontFamily: 'ui-monospace, monospace',
    backgroundColor: 'var(--pey-color-surface, #f1f1f5)',
    borderRadius: '4px',
    padding: '0 0.25rem',
  },
  '& .parsi-table-image': {
    maxWidth: '100%',
    borderRadius: '4px',
    verticalAlign: 'middle',
  },
  '& .parsi-table th[contenteditable="true"]': {
    cursor: 'text',
  },
  '& .parsi-table td[contenteditable="true"]': {
    cursor: 'text',
  },
  '& .parsi-table th:focus': {
    outline: '2px solid var(--pey-color-accent, #0e7490)',
    outlineOffset: '-2px',
  },
  '& .parsi-table td:focus': {
    outline: '2px solid var(--pey-color-accent, #0e7490)',
    outlineOffset: '-2px',
  },
  '& .parsi-table [data-padded]': {
    cursor: 'default',
  },
});

/**
 * Moves the cursor to one cell content start, for click-to-cell and
 * Tab navigation. Pure position math over the syntax tree.
 * @param {object} state Editor state.
 * @param {number} tableFrom Document offset of the Table node.
 * @param {number} row Row index (-1 for the header).
 * @param {number} col Column index.
 * @returns {number|null} Cursor offset, or null when the cell is absent.
 */
function tableCellCursor(state, tableFrom, row, col) {
  const range = findTableCell(state, tableFrom, row, col);
  if (!range) {
    return null;
  }
  const text = state.doc.sliceString(range.from, range.to);
  return range.from + cellContentStart(text, 0, text.length);
}

/**
 * Lists every cell content start of one table in visual order: header
 * first, then body rows top to bottom, left to right.
 * @param {object} state Editor state.
 * @param {number} tableFrom Document offset of the Table node.
 * @returns {Array<number>} Cursor offsets, ascending.
 */
function tableCellStops(state, tableFrom) {
  const tree = syntaxTree(state);
  if (!tree) {
    return [];
  }
  let table = null;
  tree.iterate({
    enter(cursor) {
      if (cursor.name === 'Table' && cursor.from === tableFrom) {
        table = cursor.node;
      }
    },
  });
  if (!table) {
    return [];
  }
  const stops = [];
  const collect = (parent) => {
    let cell = parent.firstChild;
    while (cell) {
      if (cell.name === 'TableCell') {
        const text = state.doc.sliceString(cell.from, cell.to);
        stops.push(cell.from + cellContentStart(text, 0, text.length));
      }
      cell = cell.nextSibling;
    }
  };
  let child = table.firstChild;
  while (child) {
    if (child.name === 'TableHeader' || child.name === 'TableRow') {
      collect(child);
    }
    child = child.nextSibling;
  }
  return stops;
}

/**
 * Jumps across table cells with Tab and Shift-Tab while the cursor stands
 * inside a table; anywhere else the key falls through (to indent). Past the
 * last cell (or before the first) the cursor parks on the table edge instead
 * of wrapping: no rows are ever created implicitly.
 * @param {boolean} forward True for Tab, false for Shift-Tab.
 * @returns {Function} Keymap command.
 */
function jumpTableCell(forward) {
  return (view) => {
    const { state } = view;
    const head = state.selection.main.head;
    const tree = syntaxTree(state);
    if (!tree) {
      return false;
    }
    let tableFrom = -1;
    let tableTo = -1;
    tree.iterate({
      enter(cursor) {
        if (cursor.name === 'Table' && cursor.from <= head && head <= cursor.to) {
          tableFrom = cursor.from;
          tableTo = cursor.to;
        }
      },
    });
    if (tableFrom < 0) {
      return false;
    }
    const stops = tableCellStops(state, tableFrom).sort((a, b) => a - b);
    const target = forward
      ? stops.find((stop) => stop > head) ?? tableTo
      : [...stops].reverse().find((stop) => stop < head) ?? tableFrom;
    view.dispatch({ selection: EditorSelection.cursor(target), scrollIntoView: true });
    return true;
  };
}

/**
 * Returns the live-table extensions for the editor. No mouse handling:
 * clicks land natively in the editable cells (the widget ignores
 * CodeMirror events), and the source toggle moves the cursor itself.
 * @param {object} [options] Extension options.
 * @param {string|null} [options.assetBaseUrl] Asset directory for the
 *   source-toggle icon (falls back to a text label without one).
 * @returns {Array} Table field plus theme.
 */
export function tableViewExtensions({ assetBaseUrl = null } = {}) {
  return [
    tableField,
    tableTheme,
    tableIconBase.of(assetBaseUrl),
    Prec.high(keymap.of([
      { key: 'Tab', run: jumpTableCell(true), shift: jumpTableCell(false) },
    ])),
  ];
}
