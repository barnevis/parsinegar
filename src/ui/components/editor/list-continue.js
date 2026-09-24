// List and quote continuation on Enter for the Persian Markdown editor.
//
// `continueList(view)` follows the CodeMirror `(view) => boolean` signature
// like the toggle commands: it handles a plain Enter press with a collapsed
// cursor at the end of a list, task or quote line by opening the next item
// with the same marker (tasks reopen unchecked, ordered markers increment,
// quotes repeat their `>` run). An Enter on a marker-only line removes the
// marker instead (the standard second-Enter-exits). Anything else —
// mid-line cursors, selections, headings, fences, modified keys — returns
// false so the default newline runs.
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
