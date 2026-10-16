// Content codecs for pey.sync: record <-> file text, plus the filename
// rule that keeps titles addressable. Byte fidelity is the point —
// serializers never reformat, only encode.

const FALLBACK_SEGMENT = 'untitled';

/**
 * Sorts an object tree by key so identical records always stringify
 * identically (hash stability across push/pull cycles).
 * @param {unknown} value JSON value.
 * @returns {unknown} Sorted copy.
 */
function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeys(value[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Serializes a record to stable JSON text.
 * @param {object} record Storage record.
 * @returns {string} Canonical JSON.
 * @throws {TypeError} When the record is not an object.
 */
function serializeJson(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError('serializeJson requires a record object');
  }
  return JSON.stringify(sortKeys(record));
}

/**
 * Parses JSON file text back to a record.
 * @param {string} content File text.
 * @returns {object} Parsed record.
 * @throws {SyntaxError} When the payload is not a JSON object (message
 *   carries no content, which may be large).
 */
function deserializeJson(content) {
  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new SyntaxError('Invalid JSON payload');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SyntaxError('Invalid JSON payload');
  }
  return parsed;
}

/**
 * Serializes a record to raw Markdown: the content field verbatim, so a
 * round trip never reformats the user's bytes.
 * @param {object} record Storage record with string content.
 * @param {string} [contentField] Record field holding the text.
 * @returns {string} File text.
 * @throws {TypeError} When content is not a string.
 */
function serializeMarkdown(record, contentField = 'content') {
  const text = record?.[contentField];
  if (!record || typeof text !== 'string') {
    throw new TypeError('serializeMarkdown requires a string content field');
  }
  return text;
}

/**
 * Parses Markdown file text back to a partial record. Title and folder
 * come from the path and manifest, never from the text.
 * @param {string} content File text.
 * @param {string} [contentField] Record field holding the text.
 * @returns {object} Partial record keyed by content field.
 * @throws {TypeError} When content is not a string.
 */
function deserializeMarkdown(content, contentField = 'content') {
  if (typeof content !== 'string') {
    throw new TypeError('deserializeMarkdown requires a string');
  }
  return { [contentField]: content };
}

/**
 * Sanitizes one path segment derived from a title: separators become
 * dashes so a title can never escape its directory, exact dots fall back,
 * and control characters are stripped.
 * @param {unknown} name Raw title.
 * @returns {string} File-safe segment, never empty.
 */
function sanitizePathSegment(name) {
  const base = String(name ?? '')
    .replace(/[\\/]/g, '-')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim();
  if (base.length === 0 || base === '.' || base === '..') {
    return FALLBACK_SEGMENT;
  }
  return base;
}

const json = {
  extension: 'json',
  serialize: serializeJson,
  deserialize: deserializeJson,
};

const markdown = {
  extension: 'md',
  serialize: serializeMarkdown,
  deserialize: deserializeMarkdown,
};

export { FALLBACK_SEGMENT, json, markdown, sanitizePathSegment };
