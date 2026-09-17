// Pure document statistics for the status bar.
//
// Takes only raw text: no DOM, no editor dependency. Words split on
// whitespace, so Persian half-spaces (ZWNJ) keep words intact. Letters are
// Unicode letters only: whitespace, digits, punctuation and the half-space
// joiner itself do not count. Bytes are UTF-8 encoded length.
const BYTES_PER_KILOBYTE = 1024;

/**
 * Counts characters (with spaces), letters, words, lines and UTF-8 bytes.
 * @param {string} text Raw document text.
 * @returns {object} `{ chars, letters, words, lines, bytes }`.
 */
export function countStats(text) {
  const source = typeof text === 'string' ? text : '';
  const trimmed = source.trim();
  const letters = source.match(/\p{L}/gu) ?? [];
  return {
    chars: source.length,
    letters: letters.length,
    words: trimmed === '' ? 0 : trimmed.split(/\s+/).length,
    lines: source === '' ? 0 : source.split('\n').length,
    bytes: new TextEncoder().encode(source).length,
  };
}

/**
 * Formats a byte count as bytes or kilobytes with one decimal.
 * @param {number} bytes Byte count.
 * @param {Function} formatNumber Number formatter.
 * @param {Function} t Translation function.
 * @returns {string} Display string such as `826 بایت` or `6 کیلوبایت`.
 */
export function formatFileSize(bytes, formatNumber, t) {
  const safe = Number.isFinite(bytes) && bytes > 0 ? Math.floor(bytes) : 0;
  const format = typeof formatNumber === 'function' ? formatNumber : String;
  const translate = typeof t === 'function' ? t : (key) => key;
  if (safe < BYTES_PER_KILOBYTE) {
    return `${format(safe)} ${translate('parsinegar.stats.bytes')}`;
  }
  return `${format(Math.round((safe / BYTES_PER_KILOBYTE) * 10) / 10)} ${translate('parsinegar.stats.kilobytes')}`;
}
