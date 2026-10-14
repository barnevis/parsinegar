// Structural Markdown edits for mindmap operations (pure: no DOM,
// no editor view, no mindmap library). Every function takes explicit line
// numbers and returns new text (or null when the op cannot apply); id
// mapping (m-<line> versus library ids) lives with the caller, which also
// refreshes the map after count- or order-changing ops so ids stay fresh.
import { computeNumbers, formatDigits, parseOrderedLine } from '../editor/list-continue.js';
import { parseMindmap } from './mindmap.js';

export const MAP_NEW_TOPIC = 'گره تازه';

const PREFIX_PATTERN = /^([ \t]*)((?:[*+-]|[0-9\u06F0-\u06F9]+[.)])\s+)(\[[ xX]\]\s+)?/;

/**
 * Splits a list line into its fixed prefix and content.
 * @param {string} line Raw line text.
 * @returns {object|null} `{ indent, marker, box, content }` or null.
 */
function parseLinePrefix(line) {
  const match = PREFIX_PATTERN.exec(line);
  if (!match) {
    return null;
  }
  return {
    indent: match[1],
    marker: match[2],
    box: match[3] ?? '',
    content: line.slice(match[0].length),
  };
}

/**
 * Takes the first line of a topic (map topics are single-line; pasted or
 * programmed input is clipped, never split, so line counts stay exact).
 * @param {unknown} topic Raw topic value.
 * @returns {string} First line.
 */
function firstTopicLine(topic) {
  return String(topic ?? '').split('\n')[0];
}

/**
 * Reads the indent of a 1-based line.
 * @param {Array<string>} lines Document lines.
 * @param {number} lineNo 1-based line number.
 * @returns {string|null} Indent or null for unknown lines.
 */
function indentOf(lines, lineNo) {
  if (!Number.isInteger(lineNo) || lineNo < 1 || lineNo > lines.length) {
    return null;
  }
  const parsed = parseLinePrefix(lines[lineNo - 1]);
  return parsed ? parsed.indent : null;
}

/**
 * Finds the last line of the subtree rooted at a 1-based line.
 * @param {Array<object>} items Flat items from `parseMindmap`.
 * @param {number} line 1-based root line.
 * @returns {number|null} Inclusive end line or null when unknown.
 */
function subtreeEnd(items, line) {
  const root = items.find((item) => item.line === line);
  if (!root) {
    return null;
  }
  let end = line;
  for (const item of items) {
    if (item.line > line && item.depth > root.depth) {
      end = item.line;
    } else if (item.line > line) {
      break;
    }
  }
  return end;
}

/**
 * Renumbers one contiguous ordered run in place following the editor rule:
 * the untouched opening keeps its start number, touched runs restart at 1.
 * Units are 0-based line indices throughout.
 * @param {Array<string>} lines Document lines (mutated).
 * @param {number} index 0-based index inside the run.
 * @param {number} touchedFrom 0-based first touched line.
 * @param {number} touchedTo 0-based first untouched line after the edit.
 * @param {Set<number>} [extraMoved] 0-based lines forced to recompute
 *   (moved blocks whose numbers are stale by construction).
 * @returns {void}
 */
function resequenceTouched(lines, index, touchedFrom, touchedTo, extraMoved = null) {
  if (index < 0 || index >= lines.length || !parseOrderedLine(lines[index])) {
    return;
  }
  let first = index;
  while (first > 0 && parseOrderedLine(lines[first - 1])) {
    first -= 1;
  }
  let last = first;
  while (last + 1 < lines.length && parseOrderedLine(lines[last + 1])) {
    last += 1;
  }
  const restart = touchedFrom <= first && first < touchedTo;
  const records = [];
  for (let number = first; number <= last; number += 1) {
    const parsed = parseOrderedLine(lines[number]);
    records.push({
      from: number,
      indent: parsed.indent,
      value: parsed.value,
      fa: parsed.fa,
      delimiter: parsed.delimiter,
      digitsLength: parsed.digitsLength,
      moved: restart || number !== first || (extraMoved !== null && extraMoved.has(number)),
    });
  }
  for (const computed of computeNumbers(records)) {
    const current = parseOrderedLine(lines[computed.from]);
    const prefix = `${computed.indent}${formatDigits(computed.value, computed.fa)}${computed.delimiter}`;
    const rest = lines[computed.from].slice(
      current.indent.length + current.digitsLength + current.delimiter.length,
    );
    lines[computed.from] = prefix + rest;
  }
}

/**
 * Renames one item line, preserving indent, marker and task box.
 * @param {string} text Raw document text.
 * @param {number} line 1-based line number.
 * @param {string} topic New topic text.
 * @returns {string|null} New text or null for unknown lines.
 */
export function renameNodeLine(text, line, topic) {
  if (typeof text !== 'string') {
    return null;
  }
  const lines = text.split('\n');
  if (!Number.isInteger(line) || line < 1 || line > lines.length) {
    return null;
  }
  const parsed = parseLinePrefix(lines[line - 1]);
  if (!parsed) {
    return null;
  }
  lines[line - 1] = parsed.indent + parsed.marker + parsed.box + firstTopicLine(topic);
  return lines.join('\n');
}

/**
 * Appends a child item under a parent line (bullets, matching the editor's
 * Tab convention of one tab stop per level).
 * @param {string} text Raw document text.
 * @param {number} parentLine 1-based parent line.
 * @param {string} [topic] Child topic (defaults to the new-node label).
 * @returns {object|null} `{ text, line }` with the inserted 1-based line.
 */
export function insertChildLine(text, parentLine, topic = MAP_NEW_TOPIC) {
  if (typeof text !== 'string') {
    return null;
  }
  const lines = text.split('\n');
  const items = parseMindmap(text);
  const parent = items.find((item) => item.line === parentLine);
  if (!parent) {
    return null;
  }
  const indent = indentOf(lines, parentLine);
  if (indent === null) {
    return null;
  }
  const end = subtreeEnd(items, parentLine);
  if (end === null) {
    return null;
  }
  lines.splice(end, 0, `${indent}\t- ${firstTopicLine(topic)}`);
  resequenceTouched(lines, Math.min(end, lines.length - 1), end, end + 1);
  return { text: lines.join('\n'), line: end + 1 };
}

/**
 * Inserts a sibling item before or after a reference line, copying its
 * marker style (tasks reopen unchecked, ordered runs resequence).
 * @param {string} text Raw document text.
 * @param {number} line 1-based reference line.
 * @param {string} [topic] Sibling topic (defaults to the new-node label).
 * @param {string} [position] `'after'` (default) or `'before'`.
 * @param {number|null} [parentLine] Parent line, required for `'first'`.
 * @returns {object|null} `{ text, line }` with the inserted 1-based line.
 */
export function insertSiblingLine(text, line, topic = MAP_NEW_TOPIC, position = 'after', parentLine = null) {
  if (typeof text !== 'string') {
    return null;
  }
  const lines = text.split('\n');
  const items = parseMindmap(text);
  if (position === 'first') {
    if (!Number.isInteger(parentLine)) {
      return null;
    }
    const indent = indentOf(lines, parentLine);
    if (indent === null || !items.some((item) => item.line === parentLine)) {
      return null;
    }
    lines.splice(parentLine, 0, `${indent}\t- ${firstTopicLine(topic)}`);
    return { text: lines.join('\n'), line: parentLine + 1 };
  }
  const ref = items.find((item) => item.line === line);
  if (!ref) {
    return null;
  }
  const parsed = parseLinePrefix(lines[line - 1]);
  if (!parsed) {
    return null;
  }
  const ordered = parseOrderedLine(lines[line - 1]);
  const marker = ordered
    ? `${formatDigits(1, ordered.fa)}${ordered.delimiter} `
    : parsed.marker;
  const box = parsed.box === '' ? '' : '[ ] ';
  const index = position === 'before' ? line - 1 : subtreeEnd(items, line);
  if (index === null) {
    return null;
  }
  lines.splice(index, 0, `${parsed.indent}${marker}${box}${firstTopicLine(topic)}`);
  if (ordered) {
    resequenceTouched(lines, index, index, index + 1);
  }
  return { text: lines.join('\n'), line: index + 1 };
}

/**
 * Inserts a parent item above a line, pushing its subtree one level deeper.
 * @param {string} text Raw document text.
 * @param {number} line 1-based child line.
 * @param {string} [topic] Parent topic (defaults to the new-node label).
 * @returns {object|null} `{ text, line }` with the inserted 1-based line.
 */
export function insertParentLine(text, line, topic = MAP_NEW_TOPIC) {
  if (typeof text !== 'string') {
    return null;
  }
  const lines = text.split('\n');
  const items = parseMindmap(text);
  const child = items.find((item) => item.line === line);
  if (!child) {
    return null;
  }
  const indent = indentOf(lines, line);
  if (indent === null) {
    return null;
  }
  const end = subtreeEnd(items, line);
  if (end === null) {
    return null;
  }
  lines.splice(line - 1, 0, `${indent}- ${firstTopicLine(topic)}`);
  for (let number = line + 1; number <= end + 1; number += 1) {
    const parsed = parseLinePrefix(lines[number - 1]);
    if (!parsed) {
      continue;
    }
    const relative = parsed.indent.startsWith(indent) ? parsed.indent.slice(indent.length) : parsed.indent;
    lines[number - 1] = `${indent}\t${relative}${parsed.marker}${parsed.box}${parsed.content}`;
  }
  resequenceTouched(lines, line - 1, line - 1, line);
  resequenceTouched(lines, line, line, line + 1);
  return { text: lines.join('\n'), line };
}

/**
 * Deletes node subtrees by 1-based lines (deepest first, so earlier
 * indices stay valid).
 * @param {string} text Raw document text.
 * @param {Array<number>} targetLines Lines to delete with their subtrees.
 * @returns {string|null} New text or null when nothing resolves.
 */
export function removeNodeLines(text, targetLines) {
  if (typeof text !== 'string' || !Array.isArray(targetLines) || targetLines.length === 0) {
    return null;
  }
  const lines = text.split('\n');
  const items = parseMindmap(text);
  const ranges = [];
  for (const target of targetLines) {
    const entry = items.find((item) => item.line === target);
    if (!entry) {
      return null;
    }
    const end = subtreeEnd(items, target);
    if (end === null) {
      return null;
    }
    ranges.push({ from: target - 1, to: end });
  }
  ranges.sort((left, right) => right.from - left.from);
  const kept = [];
  for (const range of ranges) {
    if (kept.some((other) => range.from >= other.from && range.to <= other.to)) {
      continue;
    }
    kept.push(range);
  }
  if (kept.length === 0) {
    return null;
  }
  for (const range of kept) {
    const before = lines.slice(0, range.from);
    const after = lines.slice(range.to);
    lines.length = 0;
    lines.push(...before, ...after);
    if (lines.length > 0) {
      resequenceTouched(lines, Math.min(range.from, lines.length - 1), range.from, range.to);
    }
  }
  return lines.join('\n');
}

/**
 * Moves a node subtree to before, after or inside a target line.
 * @param {string} text Raw document text.
 * @param {number} fromLine 1-based moving line.
 * @param {number} toLine 1-based target line.
 * @param {string} position `'inside'`, `'before'` or `'after'`.
 * @returns {string|null} New text or null when the move cannot apply.
 */
export function moveNodeLines(text, fromLine, toLine, position) {
  if (typeof text !== 'string'
    || !['inside', 'before', 'after'].includes(position)) {
    return null;
  }
  const lines = text.split('\n');
  const items = parseMindmap(text);
  if (items.length === 0) {
    return null;
  }
  const moving = items.find((item) => item.line === fromLine);
  const target = items.find((item) => item.line === toLine);
  if (!moving || !target) {
    return null;
  }
  const movingEnd = subtreeEnd(items, fromLine);
  if (movingEnd === null) {
    return null;
  }
  if (toLine >= fromLine && toLine <= movingEnd) {
    return null;
  }
  const movingIndent = indentOf(lines, fromLine);
  const targetIndent = indentOf(lines, toLine);
  if (movingIndent === null || targetIndent === null) {
    return null;
  }
  const blockSize = movingEnd - fromLine + 1;
  const block = lines.splice(fromLine - 1, blockSize);
  const shiftedTarget = toLine > movingEnd ? toLine - block.length : toLine;
  const destination = position === 'inside' ? `${targetIndent}\t` : targetIndent;
  const moved = block.map((raw) => {
    const parsed = parseLinePrefix(raw);
    if (!parsed) {
      return `${destination}${raw.trimStart()}`;
    }
    const relative = parsed.indent.startsWith(movingIndent)
      ? parsed.indent.slice(movingIndent.length)
      : parsed.indent;
    return `${destination}${relative}${parsed.marker}${parsed.box}${parsed.content}`;
  });
  let insertAt;
  if (position === 'inside') {
    const fresh = parseMindmap(lines.join('\n'));
    const freshTarget = fresh.find((item) => item.line === shiftedTarget);
    if (!freshTarget) {
      return null;
    }
    const freshEnd = subtreeEnd(fresh, shiftedTarget);
    if (freshEnd === null) {
      return null;
    }
    insertAt = freshEnd;
  } else if (position === 'before') {
    insertAt = shiftedTarget - 1;
  } else {
    const fresh = parseMindmap(lines.join('\n'));
    const freshTarget = fresh.find((item) => item.line === shiftedTarget);
    if (!freshTarget) {
      return null;
    }
    const freshEnd = subtreeEnd(fresh, shiftedTarget);
    if (freshEnd === null) {
      return null;
    }
    insertAt = freshEnd;
  }
  lines.splice(insertAt, 0, ...moved);
  const forced = new Set();
  for (let number = insertAt; number < insertAt + moved.length; number += 1) {
    forced.add(number);
  }
  resequenceTouched(lines, Math.min(fromLine - 1, lines.length - 1), fromLine - 1, fromLine - 1 + blockSize);
  resequenceTouched(lines, Math.min(insertAt, lines.length - 1), insertAt, insertAt + moved.length, forced);
  return lines.join('\n');
}

/**
 * Appends pasted subtree records as children of a target line.
 * @param {string} text Raw document text.
 * @param {number} targetLine 1-based target line.
 * @param {Array<object>} nodes `{ id?, topic, children }` records (ids are
 *   opaque data, paired back to placed lines for the caller).
 * @returns {object|null} `{ text, placed: [{ id, line }] }` or null.
 */
export function pasteSubtreeLines(text, targetLine, nodes) {
  if (typeof text !== 'string' || !Array.isArray(nodes) || nodes.length === 0) {
    return null;
  }
  const lines = text.split('\n');
  const items = parseMindmap(text);
  const target = items.find((item) => item.line === targetLine);
  if (!target) {
    return null;
  }
  const indent = indentOf(lines, targetLine);
  if (indent === null) {
    return null;
  }
  const end = subtreeEnd(items, targetLine);
  if (end === null) {
    return null;
  }
  const rendered = [];
  const render = (entries, level) => {
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      rendered.push({
        id: typeof entry.id === 'string' ? entry.id : null,
        text: `${indent}${'\t'.repeat(level)}- ${firstTopicLine(entry.topic)}`,
      });
      if (Array.isArray(entry.children) && entry.children.length > 0) {
        render(entry.children, level + 1);
      }
    }
  };
  render(nodes, 1);
  if (rendered.length === 0) {
    return null;
  }
  lines.splice(end, 0, ...rendered.map((entry) => entry.text));
  return {
    text: lines.join('\n'),
    placed: rendered.map((entry, index) => ({ id: entry.id, line: end + 1 + index })),
  };
}

/**
 * Records a fresh library id for later line resolution (map ids created
 * between refreshes; cleared on every rebuild).
 * @param {Map} pending Fresh-id table (mutated).
 * @param {string|null} id Library node id.
 * @param {number} line 1-based placed line.
 * @returns {void}
 */
function recordFresh(pending, id, line) {
  if (pending instanceof Map
    && typeof id === 'string'
    && !/^m-\d+$/.test(id)
    && Number.isInteger(line)
    && line >= 1) {
    pending.set(id, line);
  }
}

/**
 * Applies one described map operation to source text. Pure except for the
 * passed fresh-id table (mutated on placements) and the line resolver.
 * @param {string} text Current document text.
 * @param {object} described Described op (see adapter `describeOperation`;
 *   paste carries `targetLine`, sibling-first carries a parent line).
 * @param {Function} resolveLine Maps a node id to a 1-based line or null.
 * @param {Map} pending Fresh-id table (mutated).
 * @returns {object} `{ text: string|null, refresh: boolean }` — null text
 *   means veto (caller heals by rebuilding from current text).
 */
export function applyMapOperation(text, described, resolveLine, pending) {
  const current = typeof text === 'string' ? text : '';
  const resolve = typeof resolveLine === 'function' ? resolveLine : () => null;
  if (!described || typeof described !== 'object') {
    return { text: null, refresh: true };
  }
  switch (described.kind) {
    case 'rename': {
      const line = resolve(described.id);
      if (line === null) {
        return { text: null, refresh: true };
      }
      return { text: renameNodeLine(current, line, described.topic), refresh: false };
    }
    case 'add': {
      const parentLine = resolve(described.parentId);
      if (parentLine === null) {
        return { text: null, refresh: true };
      }
      const inserted = insertChildLine(current, parentLine, described.topic);
      if (!inserted) {
        return { text: null, refresh: true };
      }
      recordFresh(pending, described.newId, inserted.line);
      return { text: inserted.text, refresh: false };
    }
    case 'sibling': {
      let inserted = null;
      if (described.position === 'first') {
        const parentLine = resolve(described.refId);
        if (parentLine === null) {
          return { text: null, refresh: true };
        }
        inserted = insertSiblingLine(current, 0, described.topic, 'first', parentLine);
      } else {
        const refLine = resolve(described.refId);
        if (refLine === null) {
          return { text: null, refresh: true };
        }
        inserted = insertSiblingLine(current, refLine, described.topic, described.position);
      }
      if (!inserted) {
        return { text: null, refresh: true };
      }
      recordFresh(pending, described.newId, inserted.line);
      return { text: inserted.text, refresh: false };
    }
    case 'parent': {
      const wrappedLine = resolve(described.wrappedId);
      if (wrappedLine === null) {
        return { text: null, refresh: true };
      }
      const inserted = insertParentLine(current, wrappedLine, described.topic);
      if (!inserted) {
        return { text: null, refresh: true };
      }
      recordFresh(pending, described.newId, inserted.line);
      return { text: inserted.text, refresh: false };
    }
    case 'remove': {
      const targetLines = [];
      for (const id of Array.isArray(described.ids) ? described.ids : []) {
        const line = resolve(id);
        if (line === null) {
          return { text: null, refresh: true };
        }
        targetLines.push(line);
      }
      return { text: removeNodeLines(current, targetLines), refresh: true };
    }
    case 'move': {
      const fromLine = resolve(described.fromId);
      const toLine = resolve(described.toId);
      if (fromLine === null || toLine === null) {
        return { text: null, refresh: true };
      }
      return { text: moveNodeLines(current, fromLine, toLine, described.position), refresh: true };
    }
    case 'paste': {
      if (described.targetLine === null || described.targetLine === undefined) {
        return { text: null, refresh: true };
      }
      const pasted = pasteSubtreeLines(current, described.targetLine, described.nodes);
      if (!pasted) {
        return { text: null, refresh: true };
      }
      for (const placed of pasted.placed) {
        recordFresh(pending, placed.id, placed.line);
      }
      return { text: pasted.text, refresh: false };
    }
    default:
      return { text: null, refresh: true };
  }
}
