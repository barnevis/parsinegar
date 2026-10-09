// Shared file-name rules for export: the download menu rule (path
// separators become dashes) plus the default title, used by both the
// single-document and the zip export.
const DEFAULT_TITLE = 'بدون عنوان';

/**
 * Sanitizes a document title for use as a file name (mirrors the download
 * menu rule: path separators become dashes).
 * @param {string} title Document title.
 * @returns {string} File-safe base name.
 */
function sanitizeFileName(title) {
  const base = title.replace(/[\\/]/g, '-').trim();
  return base.length > 0 ? base : DEFAULT_TITLE;
}

export { DEFAULT_TITLE, sanitizeFileName };
