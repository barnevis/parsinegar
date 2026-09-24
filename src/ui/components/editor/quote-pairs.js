// Quote and backtick pairing for the Persian Markdown editor.
//
// CodeMirror's `closeBrackets` only pairs `()[]{}` here: same-character
// tokens (`"`, `'`, backtick) pair solely inside string contexts, which
// Markdown does not declare. These commands cover that family instead,
// following the same `(view) => boolean` signature as the toggle commands:
// typing an opener next to a boundary inserts the pair with the cursor
// between, typing a closer over its twin steps over it, typing over
// selected text wraps it, and Backspace inside an empty pair removes both.
// Anything else returns false so default handling (or `closeBrackets`)
// runs. Only unmodified keys reach these commands; IME composition commits
// must fall through untouched.
import { EditorSelection } from '@codemirror/state';

const PAIRS = {
  '"': '"',
  "'": "'",
  '`': '`',
  '«': '»',
};

// Characters allowed right after the cursor for a fresh pair: end of input,
// whitespace, or closing punctuation. A word character means the quote
// belongs to the word (`don't`), so a single character is inserted.
const PAIR_AFTER_PATTERN = /[\s)\]}:;,>?.!،؛؟]/;

/**
 * Handles typing a quote or backtick character.
 * @param {object} view Active editor view.
 * @param {string} key Typed character (`event.key`).
 * @returns {boolean} True when handled.
 */
export function pairInput(view, key) {
  const { state } = view;
  const selection = state.selection.main;
  const { from, to } = selection;
  const closer = PAIRS[key];
  if (closer === undefined) {
    // A bare `»` over its twin steps over it instead of doubling; anything
    // else is not our business.
    if (key === '»' && state.sliceDoc(to, to + 1) === '»') {
      view.dispatch({
        selection: EditorSelection.cursor(to + 1),
        scrollIntoView: true,
      });
      return true;
    }
    return false;
  }
  if (!selection.empty) {
    view.dispatch({
      changes: [
        { from, insert: key },
        { from: to, insert: closer },
      ],
      selection: EditorSelection.range(from + 1, to + 1),
      scrollIntoView: true,
    });
    return true;
  }
  const next = state.sliceDoc(to, to + closer.length);
  if (next === closer) {
    view.dispatch({
      selection: EditorSelection.cursor(to + closer.length),
      scrollIntoView: true,
    });
    return true;
  }
  const after = state.sliceDoc(to, to + 1);
  if (after !== '' && !PAIR_AFTER_PATTERN.test(after)) {
    return false;
  }
  view.dispatch({
    changes: { from, insert: key + closer },
    selection: EditorSelection.cursor(from + key.length),
    scrollIntoView: true,
  });
  return true;
}

/**
 * Removes both halves of an empty quote/backtick pair on Backspace.
 * CodeMirror's own pair deletion keeps handling `()[]{}`.
 * @param {object} view Active editor view.
 * @returns {boolean} True when a pair was removed.
 */
export function deletePair(view) {
  const { state } = view;
  const selection = state.selection.main;
  if (!selection.empty) {
    return false;
  }
  const { from } = selection;
  for (const opener of Object.keys(PAIRS)) {
    const closer = PAIRS[opener];
    if (state.sliceDoc(from - opener.length, from) === opener
      && state.sliceDoc(from, from + closer.length) === closer) {
      view.dispatch({
        changes: { from: from - opener.length, to: from + closer.length, insert: '' },
        selection: EditorSelection.cursor(from - opener.length),
        scrollIntoView: true,
      });
      return true;
    }
  }
  return false;
}
