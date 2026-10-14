// Pure mindmap extraction for the mindmap view.
//
// Parses list-only Markdown into a flat item tree (no DOM, no editor
// dependency): standalone lezer parse is the nesting authority, so fenced
// code never contributes and quotes stay out. Line numbers are 1-based for
// editor navigation.
import { markdownLanguage } from '@codemirror/lang-markdown';

const TASK_BOX_PATTERN = /^\[[ xX]\](?=\s|$)/;
const GAP_PATTERN = /^[ \t]+/;
const EMPTY_ITEM_PATTERN = /^[ \t]*(?:[*+-]|\d+[.)])\s*$/;

/**
 * Checks whether a node name opens a list level.
 * @param {string} name Lezer node name.
 * @returns {boolean} True for bullet and ordered lists.
 */
function isListNode(name) {
  return name === 'BulletList' || name === 'OrderedList';
}

/**
 * Checks whether a node name scopes lines out of the map (quotes, fences).
 * @param {string} name Lezer node name.
 * @returns {boolean} True for excluded scopes.
 */
function isExcludedScope(name) {
  return name === 'Blockquote' || name === 'FencedCode';
}

/**
 * Returns the 1-based line number of an offset using line starts.
 * @param {Array<number>} starts Line start offsets, ascending.
 * @param {number} offset Document offset.
 * @returns {number} 1-based line number.
 */
function lineOf(starts, offset) {
  let line = 1;
  for (let index = 1; index < starts.length; index += 1) {
    if (starts[index] > offset) {
      break;
    }
    line = index + 1;
  }
  return line;
}

/**
 * Reads one item's text: past the marker and its gap, past a task box, to
 * the end of the marker's own line (continuation lines stay out).
 * @param {string} text Raw document text.
 * @param {object} mark ListMark syntax node.
 * @returns {string} Item text, possibly empty.
 */
function readItemText(text, mark) {
  let start = mark.to;
  const gap = GAP_PATTERN.exec(text.slice(start));
  if (gap) {
    start += gap[0].length;
  }
  const box = TASK_BOX_PATTERN.exec(text.slice(start, start + 4));
  if (box) {
    start += box[0].length;
    const after = GAP_PATTERN.exec(text.slice(start));
    if (after) {
      start += after[0].length;
    }
  }
  const lineEnd = text.indexOf('\n', start);
  return text.slice(start, lineEnd < 0 ? text.length : lineEnd).trimEnd();
}

/**
 * Analyzes a document in one tree pass: flat list items, the lines opening
 * an item (the list-only gate), and marker-only lines the tree owns (empty
 * items, skipped like blanks — but only when the tree really owns them, so
 * a 4-space indented `- ` code line never sneaks through).
 * @param {string} text Raw document text.
 * @returns {object} `{ items: [{ depth, text, line }], opens: Set<number>, marks: Set<number> }`.
 */
function analyze(text) {
  const items = [];
  const opens = new Set();
  const marks = new Set();
  if (typeof text !== 'string' || text === '') {
    return { items, opens, marks };
  }
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      starts.push(index + 1);
    }
  }
  const tree = markdownLanguage.parser.parse(text);
  let listDepth = 0;
  let excluded = 0;
  tree.iterate({
    enter(node) {
      if (isExcludedScope(node.name)) {
        excluded += 1;
        return undefined;
      }
      if (excluded > 0) {
        return undefined;
      }
      if (isListNode(node.name)) {
        listDepth += 1;
        return undefined;
      }
      if (node.name !== 'ListItem') {
        return undefined;
      }
      const depth = listDepth - 1;
      if (depth < 0) {
        return undefined;
      }
      let mark = node.node.firstChild;
      while (mark && mark.name !== 'ListMark') {
        mark = mark.nextSibling;
      }
      if (!mark) {
        return undefined;
      }
      const content = readItemText(text, mark);
      const markerLine = lineOf(starts, mark.from);
      if (content === '') {
        marks.add(markerLine);
        return undefined;
      }
      items.push({ depth, text: content, line: markerLine });
      opens.add(markerLine);
      return undefined;
    },
    leave(node) {
      if (isExcludedScope(node.name)) {
        excluded -= 1;
      } else if (isListNode(node.name) && excluded === 0) {
        listDepth -= 1;
      }
    },
  });
  return { items, opens, marks };
}

/**
 * Extracts the flat list-item tree of a Markdown document.
 * @param {string} text Raw document text.
 * @returns {Array<object>} `[{ depth, text, line }]` in document order.
 */
export function parseMindmap(text) {
  return analyze(text).items;
}

/**
 * Reports whether a document renders as a mindmap: at least one item, and
 * every non-blank line opens one or is an empty (marker-only) item —
 * headings, quotes, fences, tables and wrapped continuation lines all
 * disqualify.
 * @param {string} text Raw document text.
 * @returns {boolean} True for list-only documents with content.
 */
export function isListOnlyDocument(text) {
  if (typeof text !== 'string' || text === '') {
    return false;
  }
  const { items, opens, marks } = analyze(text);
  if (items.length === 0) {
    return false;
  }
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '') {
      continue;
    }
    if (EMPTY_ITEM_PATTERN.test(line) && marks.has(index + 1)) {
      continue;
    }
    if (!opens.has(index + 1)) {
      return false;
    }
  }
  return true;
}

/**
 * Builds the nested map with the first top-level item as the root: further
 * top-level items attach to it in order, so every list-only document maps.
 * @param {Array<object>} items Flat items from `parseMindmap`.
 * @returns {object|null} `{ text, line, children }` root, or null when empty.
 */
export function buildMindmapTree(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }
  const root = { text: items[0].text, line: items[0].line, children: [] };
  const stack = [{ depth: items[0].depth, node: root }];
  for (let index = 1; index < items.length; index += 1) {
    const entry = { text: items[index].text, line: items[index].line, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].depth >= items[index].depth) {
      stack.pop();
    }
    const parent = stack.length > 0 ? stack[stack.length - 1].node : root;
    parent.children.push(entry);
    stack.push({ depth: items[index].depth, node: entry });
  }
  return root;
}

/**
 * Derives a cheap change signature for a mindmap: depth, text and line all
 * matter because structure and navigation targets shift together.
 * @param {string} value Raw document text.
 * @returns {string} Signature string.
 */
export function mindmapSignature(value) {
  return JSON.stringify(parseMindmap(value ?? ''));
}
