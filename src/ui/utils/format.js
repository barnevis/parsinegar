// Locale-aware formatting helpers for page chrome and dialogs.
//
// Both helpers take the optional `format` function handed down through refs
// and fall back to plain output when it is absent or throws, so callers in
// components, controllers and the page share one behavior.
export function formatNumber(format, value) {
  if (typeof format === 'function') {
    try {
      return format(value, 'number', {});
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Formats an epoch-millisecond timestamp for the active language.
 * @param {Function|null} format Optional refs formatter.
 * @param {number} value Epoch milliseconds.
 * @returns {string} Formatted date and time, or ISO/fallback text.
 */
export function formatDate(format, value) {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) {
    return String(value ?? '');
  }
  if (typeof format === 'function') {
    try {
      return format(time, 'dateTime', {});
    } catch {
      return time.toISOString();
    }
  }
  return time.toISOString();
}
