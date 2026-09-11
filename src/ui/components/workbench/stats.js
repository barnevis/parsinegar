// Pure document statistics for the status bar.
//
// Takes only raw text: no DOM, no editor dependency. Words split on
// whitespace, so Persian half-spaces (ZWNJ) keep words intact.

/**
 * Counts characters (with spaces), words and lines of a Markdown document.
 * @param {string} text Raw document text.
 * @returns {object} `{ chars, words, lines }`.
 */
export function countStats(text) {
  const source = typeof text === 'string' ? text : '';
  const trimmed = source.trim();
  return {
    chars: source.length,
    words: trimmed === '' ? 0 : trimmed.split(/\s+/).length,
    lines: source === '' ? 0 : source.split('\n').length,
  };
}
