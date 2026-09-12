// Markdown toggle commands for editor shortcuts.
//
// Each command wraps or unwraps the selection with Markdown marks, so pressing
// the same shortcut twice restores the original text. Commands follow the
// CodeMirror `(view) => boolean` signature. Shortcut matching itself lives in
// `shortcutCommand`, which matches physical key positions (`event.code`) so
// shortcuts work on any keyboard layout, including Persian.
import { EditorSelection } from '@codemirror/state';

/**
 * Toggles an inline mark (`**`, `*`, `~~`, `` ` ``) around the selection.
 * @param {object} view Active editor view.
 * @param {string} mark Mark text.
 * @returns {boolean} Always true (handled).
 */
function toggleInlineMark(view, mark) {
  const range = view.state.selection.main;
  const text = view.state.sliceDoc(range.from, range.to);
  if (range.empty) {
    const cursor = range.from + mark.length;
    view.dispatch({
      changes: { from: range.from, insert: mark + mark },
      selection: EditorSelection.cursor(cursor),
      scrollIntoView: true,
    });
    return true;
  }
  if (text.length > mark.length * 2 && text.startsWith(mark) && text.endsWith(mark)) {
    const inner = text.slice(mark.length, text.length - mark.length);
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: inner },
      selection: EditorSelection.range(range.from, range.from + inner.length),
      scrollIntoView: true,
    });
    return true;
  }
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: mark + text + mark },
    selection: EditorSelection.range(range.from, range.to + mark.length * 2),
    scrollIntoView: true,
  });
  return true;
}

/**
 * Toggles a line prefix (`# `, `> `, `- `, `1. `) on every overlapped line.
 * @param {object} view Active editor view.
 * @param {RegExp} pattern Matches an existing prefix with indent in group 1.
 * @param {string} prefix Prefix to insert (after indentation).
 * @returns {boolean} Always true (handled).
 */
function toggleLinePrefix(view, pattern, prefix) {
  const { state } = view;
  const selection = state.selection.main;
  const firstLine = state.doc.lineAt(selection.from).number;
  let lastLine = state.doc.lineAt(selection.to).number;
  if (selection.to > selection.from && state.doc.line(lastLine).from === selection.to) {
    lastLine -= 1;
  }
  const changes = [];
  for (let number = firstLine; number <= lastLine; number += 1) {
    const line = state.doc.line(number);
    const match = pattern.exec(line.text);
    if (match) {
      changes.push({ from: line.from + match[1].length, to: line.from + match[0].length, insert: '' });
    } else {
      const indent = /^(\s*)/.exec(line.text)?.[1] ?? '';
      changes.push({ from: line.from + indent.length, insert: prefix });
    }
  }
  view.dispatch({ changes, scrollIntoView: true });
  return true;
}

/**
 * Toggles bold (`**`) around the selection.
 * @param {object} view Active editor view.
 * @returns {boolean} Always true.
 */
export function toggleBold(view) {
  return toggleInlineMark(view, '**');
}

/**
 * Toggles italic (`*`) around the selection.
 * @param {object} view Active editor view.
 * @returns {boolean} Always true.
 */
export function toggleItalic(view) {
  return toggleInlineMark(view, '*');
}

/**
 * Toggles strikethrough (`~~`) around the selection.
 * @param {object} view Active editor view.
 * @returns {boolean} Always true.
 */
export function toggleStrikethrough(view) {
  return toggleInlineMark(view, '~~');
}

/**
 * Toggles inline code (`` ` ``) around the selection.
 * @param {object} view Active editor view.
 * @returns {boolean} Always true.
 */
export function toggleCode(view) {
  return toggleInlineMark(view, '`');
}

/**
 * Toggles an `# ` heading prefix on every overlapped line.
 * @param {object} view Active editor view.
 * @returns {boolean} Always true.
 */
export function toggleHeading(view) {
  return toggleLinePrefix(view, /^(\s*)#{1,6}\s+/, '# ');
}

/**
 * Toggles a `> ` quote prefix on every overlapped line.
 * @param {object} view Active editor view.
 * @returns {boolean} Always true.
 */
export function toggleQuote(view) {
  return toggleLinePrefix(view, /^(\s*)>\s?/, '> ');
}

/**
 * Toggles an unordered `- ` prefix on every overlapped line.
 * @param {object} view Active editor view.
 * @returns {boolean} Always true.
 */
export function toggleUnorderedList(view) {
  return toggleLinePrefix(view, /^(\s*)[*+-]\s+/, '- ');
}

/**
 * Toggles an ordered `1. ` prefix on every overlapped line. Markdown
 * auto-numbers consecutive `1.` items, so no renumbering is needed.
 * @param {object} view Active editor view.
 * @returns {boolean} Always true.
 */
export function toggleOrderedList(view) {
  return toggleLinePrefix(view, /^(\s*)\d+[.)]\s+/, '1. ');
}

/**
 * Wraps the selection as `[text]()`, placing the cursor inside the parens,
 * or inserts `[]()` with the cursor inside the brackets when empty.
 * @param {object} view Active editor view.
 * @returns {boolean} Always true.
 */
export function insertLink(view) {
  const range = view.state.selection.main;
  const text = view.state.sliceDoc(range.from, range.to);
  if (range.empty) {
    view.dispatch({
      changes: { from: range.from, insert: '[]()' },
      selection: EditorSelection.cursor(range.from + 1),
      scrollIntoView: true,
    });
    return true;
  }
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: `[${text}]()` },
    selection: EditorSelection.cursor(range.from + text.length + 3),
    scrollIntoView: true,
  });
  return true;
}

const SHORTCUTS = [
  { code: 'KeyB', shift: false, command: toggleBold },
  { code: 'KeyI', shift: false, command: toggleItalic },
  { code: 'KeyS', shift: true, command: toggleStrikethrough },
  { code: 'KeyH', shift: false, command: toggleHeading },
  { code: 'KeyQ', shift: false, command: toggleQuote },
  { code: 'KeyK', shift: false, command: insertLink },
  { code: 'KeyE', shift: false, command: toggleCode },
  { code: 'KeyL', shift: true, command: toggleOrderedList },
  { code: 'KeyU', shift: true, command: toggleUnorderedList },
];

/**
 * Matches a keydown event to a toggle command by physical key position,
 * so shortcuts work on any keyboard layout. Ctrl/⌘ is required; Alt never is.
 * @param {KeyboardEvent} event Keydown event.
 * @returns {Function|null} Matching command or null.
 */
export function shortcutCommand(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) {
    return null;
  }
  const shift = event.shiftKey === true;
  const entry = SHORTCUTS.find(({ code, shift: wantsShift }) => event.code === code && shift === wantsShift);
  return entry?.command ?? null;
}
