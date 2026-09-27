// List and quote continuation on Enter for the Persian Markdown editor,
// plus level-aware indent/outdent with block resequencing on Tab.
//
// `continueList(view)` follows the CodeMirror `(view) => boolean` signature
// like the toggle commands: it handles a plain Enter press with a collapsed
// cursor at the end of a list, task or quote line by opening the next item
// with the same marker (tasks reopen unchecked, ordered markers increment
// from the current line's own number, quotes repeat their `>` run). An
// Enter on a marker-only line removes the marker instead (the standard
// second-Enter-exits). Anything else — mid-line cursors, selections,
// headings, fences, modified keys — returns false so the default newline
// runs.
//
// `indentListItem(view, outdent)` handles Tab/Shift-Tab on an ordered item
// line (collapsed cursor, no modifiers): it moves the line one level and
// then resequences the contiguous ordered block, so nesting `3.` under `2.`
// and returning to base can never strand a `4.` where a `3.` belongs.
// Unordered lines, selections and the locked (read-only) state fall through
// or swallow respectively (see below).
import { EditorSelection } from '@codemirror/state';

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const UNORDERED_EMPTY_PATTERN = /^(\s*)([*+-])(\s+)$/;
const UNORDERED_CONTENT_PATTERN = /^(\s*)([*+-])\s+\S/;
const TASK_EMPTY_PATTERN = /^(\s*)((?:[*+-]|\d+[.)])\s+\[[ xX]\])\s*$/;
const TASK_CONTENT_PATTERN = /^(\s*)([*+-]|\d+[.)])\s+\[[ xX]\]\s*\S/;
const ORDERED_EMPTY_PATTERN = /^(\s*)\d+[.)]\s*$/;
const ORDERED_CONTENT_PATTERN = /^(\s*)([0-9\u06F0-\u06F9]+)([.)])\s+\S/;
const QUOTE_PREFIX_PATTERN = /^(\s*(?:>\s*)+)/;

/**
 * Parses an ASCII or Persian digit run.
 * @param {string} text Digit run.
 * @returns {object|null} `{ value, fa }`, or null for other input.
 */
function parseDigits(text) {
  if (/^[0-9]+$/.test(text)) {
    return { value: Number(text), fa: false };
  }
  if (/^[\u06F0-\u06F9]+$/.test(text)) {
    let value = 0;
    for (const character of text) {
      value = value * 10 + FA_DIGITS.indexOf(character);
    }
    return { value, fa: true };
  }
  return null;
}

/**
 * Formats a number in ASCII or Persian digits.
 * @param {number} value Number value.
 * @param {boolean} fa Persian digits when true.
 * @returns {string} Digit run.
 */
function formatDigits(value, fa) {
  const text = String(value);
  if (!fa) {
    return text;
  }
  return [...text].map((digit) => FA_DIGITS[Number(digit)]).join('');
}

/**
 * Continues the list, task or quote under the cursor on Enter.
 * @param {object} view Active editor view.
 * @returns {boolean} True when handled (cursor moved to the new prefix).
 */
export function continueList(view) {
  const { state } = view;
  const selection = state.selection.main;
  if (!selection.empty) {
    return false;
  }
  const line = state.doc.lineAt(selection.from);
  if (selection.from !== line.to) {
    return false;
  }
  if (selection.from !== line.to) {
    return false;
  }
  const { text } = line;
  let match = TASK_EMPTY_PATTERN.exec(text)
    ?? UNORDERED_EMPTY_PATTERN.exec(text)
    ?? ORDERED_EMPTY_PATTERN.exec(text);
  if (match) {
    const indent = match[1] ?? '';
    view.dispatch({
      changes: { from: line.from + indent.length, to: line.to, insert: '' },
      selection: EditorSelection.cursor(line.from + indent.length),
      scrollIntoView: true,
    });
    return true;
  }
  const quote = QUOTE_PREFIX_PATTERN.exec(text);
  if (quote && text.slice(quote[0].length) === '') {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: '' },
      selection: EditorSelection.cursor(line.from),
      scrollIntoView: true,
    });
    return true;
  }
  match = TASK_CONTENT_PATTERN.exec(text);
  if (match) {
    // The box always reopens unchecked; an ordered task marker is kept
    // as-is (Markdown renders consecutive `1.` items numbered anyway).
    const prefix = `\n${match[1]}${match[2]} [ ] `;
    view.dispatch({
      changes: { from: selection.from, insert: prefix },
      selection: EditorSelection.cursor(selection.from + prefix.length),
      scrollIntoView: true,
    });
    return true;
  }
  match = UNORDERED_CONTENT_PATTERN.exec(text);
  if (match) {
    const prefix = `\n${match[1]}${match[2]} `;
    view.dispatch({
      changes: { from: selection.from, insert: prefix },
      selection: EditorSelection.cursor(selection.from + prefix.length),
      scrollIntoView: true,
    });
    return true;
  }
  match = ORDERED_CONTENT_PATTERN.exec(text);
  if (match) {
    const digits = parseDigits(match[2]);
    if (!digits) {
      return false;
    }
    const prefix = `\n${match[1]}${formatDigits(digits.value + 1, digits.fa)}${match[3]} `;
    view.dispatch({
      changes: { from: selection.from, insert: prefix },
      selection: EditorSelection.cursor(selection.from + prefix.length),
      scrollIntoView: true,
    });
    return true;
  }
  if (quote) {
    const prefix = `\n${quote[1]}`;
    view.dispatch({
      changes: { from: selection.from, insert: prefix },
      selection: EditorSelection.cursor(selection.from + prefix.length),
      scrollIntoView: true,
    });
    return true;
  }
  return false;
}

/**
 * Matches any ordered item line (content or marker-only), capturing indent,
 * digits and delimiter for resequencing.
 */
const ORDERED_LINE_PATTERN = /^(\s*)([0-9\u06F0-\u06F9]+)([.)])(?:\s|$)/;

/**
 * Parses an ordered item line for indent handling.
 * @param {string} text Line text.
 * @returns {object|null} `{ indent, value, fa, delimiter, digitsLength }`,
 *   or null for non-ordered lines.
 */
function parseOrderedLine(text) {
  const match = ORDERED_LINE_PATTERN.exec(text);
  if (!match) {
    return null;
  }
  const digits = parseDigits(match[2]);
  if (!digits) {
    return null;
  }
  return { indent: match[1], value: digits.value, fa: digits.fa, delimiter: match[3], digitsLength: match[2].length };
}

/**
 * Resequences a contiguous run of ordered lines in place: one counter per
 * indent level, deeper levels restarting at 1 like rendered output. The
 * untouched opening line keeps its typed start number (browsers honor
 * `start`); the moved line always recomputes. Digit style and delimiter of
 * each line are preserved, only values move.
 * @param {Array} lines `{ from, indent, value, fa, delimiter, moved }` records.
 * @returns {Array} Same records with computed `value`.
 */
function computeNumbers(lines) {
  const stack = [];
  return lines.map((entry, index) => {
    const level = entry.indent.length;
    while (stack.length > 0 && stack[stack.length - 1].level > level) {
      stack.pop();
    }
    if (stack.length > 0 && stack[stack.length - 1].level === level) {
      stack[stack.length - 1].count += 1;
    } else if (index === 0 && !entry.moved) {
      stack.push({ level, count: entry.value });
    } else {
      stack.push({ level, count: 1 });
    }
    return { ...entry, value: stack[stack.length - 1].count };
  });
}

/**
 * Moves the ordered item under the cursor one level (Tab indents,
 * Shift-Tab outdents) and resequences the contiguous ordered block, so a
 * `3.` nested under `2.` becomes `1.` there and the outer run closes its
 * gap — all in one undoable transaction with the cursor mapped along.
 * Non-ordered lines, selections and modified keys fall through (false);
 * the locked state swallows the key (true) so nothing edits.
 * @param {object} view Active editor view.
 * @param {boolean} outdent True for Shift-Tab, false for Tab.
 * @returns {boolean} True when handled.
 */
export function indentListItem(view, outdent) {
  const { state } = view;
  if (state.readOnly) {
    return true;
  }
  const selection = state.selection.main;
  if (!selection.empty) {
    return false;
  }
  const line = state.doc.lineAt(selection.from);
  const parsed = parseOrderedLine(line.text);
  if (!parsed) {
    return false;
  }
  let newIndent;
  if (!outdent) {
    newIndent = `${parsed.indent}\t`;
  } else if (parsed.indent.startsWith('\t')) {
    newIndent = parsed.indent.slice(1);
  } else {
    const spaces = /^[ ]{1,4}/.exec(parsed.indent);
    if (!spaces) {
      return false;
    }
    newIndent = parsed.indent.slice(spaces[0].length);
  }
  const numbers = [];
  for (let n = line.number - 1; n >= 1; n -= 1) {
    if (!parseOrderedLine(state.doc.line(n).text)) {
      break;
    }
    numbers.unshift(n);
  }
  numbers.push(line.number);
  for (let n = line.number + 1; n <= state.doc.lines; n += 1) {
    if (!parseOrderedLine(state.doc.line(n).text)) {
      break;
    }
    numbers.push(n);
  }
  const records = numbers.map((n) => {
    const current = state.doc.line(n);
    const effective = n === line.number
      ? newIndent + current.text.slice(parsed.indent.length)
      : current.text;
    const entry = parseOrderedLine(effective);
    return { from: current.from, indent: entry.indent, value: entry.value, fa: entry.fa, delimiter: entry.delimiter, moved: n === line.number };
  });
  const changes = [];
  for (const entry of computeNumbers(records)) {
    const current = state.doc.lineAt(entry.from);
    const original = parseOrderedLine(current.text);
    const prefixLength = original.indent.length + original.digitsLength + original.delimiter.length;
    const next = `${entry.indent}${formatDigits(entry.value, entry.fa)}${entry.delimiter}`;
    if (next !== current.text.slice(0, prefixLength)) {
      changes.push({ from: entry.from, to: entry.from + prefixLength, insert: next });
    }
  }
  if (changes.length === 0) {
    return true;
  }
  // No explicit selection: the cursor rides its anchor through the edits.
  view.dispatch({ changes, scrollIntoView: true });
  return true;
}
