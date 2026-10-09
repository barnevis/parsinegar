// Bulk Markdown export: packs text documents into one zip archive.
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { DEFAULT_TITLE, sanitizeFileName } from './file-names.js';

const MIME_ZIP = 'application/zip';
const ARCHIVE_FILENAME = 'parsinegar-documents.zip';

/**
 * Sanitizes one zip path segment: path separators become dashes (mirroring
 * the download menu rule) and traversal segments collapse to the default.
 * @param {string} segment Raw path segment.
 * @returns {string} File-safe segment.
 */
function sanitizePathSegment(segment) {
  const base = sanitizeFileName(segment);
  return base === '.' || base === '..' ? DEFAULT_TITLE : base;
}

/**
 * Builds the zip entry path for a document: its folder path (if any) plus
 * the sanitized `<title>.md` file name.
 * @param {string} [path] Slash-separated folder path, '' for the root.
 * @param {string} [title] Document title.
 * @returns {string} Entry path like `notes/todo.md` or `todo.md`.
 */
export function zipEntryPath(path, title) {
  const segments = typeof path === 'string'
    ? path.split('/').filter((segment) => segment.length > 0)
    : [];
  return [...segments.map(sanitizePathSegment), `${sanitizeFileName(title ?? '')}.md`].join('/');
}

/**
 * Resolves a repeat full path with a numeric suffix (`name (2).md`), so a
 * duplicate entry never silently overwrites another.
 * @param {Set} seen Already used entry paths.
 * @param {string} entry Candidate entry path.
 * @returns {string} Unused entry path.
 */
function disambiguatePath(seen, entry) {
  if (!seen.has(entry)) {
    return entry;
  }
  const dot = entry.lastIndexOf('.');
  const stem = dot < 0 ? entry : entry.slice(0, dot);
  const extension = dot < 0 ? '' : entry.slice(dot);
  let counter = 2;
  while (seen.has(`${stem} (${counter})${extension}`)) {
    counter += 1;
  }
  return `${stem} (${counter})${extension}`;
}

/**
 * Packs documents into a zip archive Blob. Entries are added sequentially
 * (order matters: the archive lists documents in input order). Lenient
 * about shapes: non-string content reads as empty, missing titles take the
 * default — mirroring the single-document export.
 * @param {Array} [documents] `{ markdown, title, path }` records.
 * @returns {Promise<Blob>} Zip archive (`application/zip`).
 */
export async function createZipBlob(documents) {
  const records = Array.isArray(documents) ? documents : [];
  const writer = new ZipWriter(new BlobWriter(MIME_ZIP));
  const seen = new Set();
  for (const record of records) {
    const source = record && typeof record === 'object' ? record : {};
    const markdown = typeof source.markdown === 'string' ? source.markdown : '';
    const entry = disambiguatePath(seen, zipEntryPath(source.path, source.title));
    seen.add(entry);
    await writer.add(entry, new TextReader(markdown));
  }
  return writer.close();
}

export { ARCHIVE_FILENAME, MIME_ZIP };
