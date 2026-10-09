// HTML export service: Persian Markdown over pey.markdown.service,
// assembled as a standalone themed RTL document.
import { assembleDocument, outputThemes } from './assemble-document.js';
import { ARCHIVE_FILENAME, MIME_ZIP, createZipBlob } from './export-zip.js';
import { DEFAULT_TITLE, sanitizeFileName } from './file-names.js';
import { highlight, highlightHtml } from './mark-extension.js';
import {
  persianFootnoteOptionsForRender,
  persianHtmlExtensions,
  persianSyntaxExtensions,
} from './persian-extensions.js';

const MARKDOWN_SERVICE = 'pey.markdown.service';
const SERVICE_NAME = 'parsinegar.export.service';
const DEFAULT_THEME = 'light';
const MIME_HTML = 'text/html';

/**
 * Builds a standard Bonyan boundary error.
 * @param {string} code Stable error code.
 * @param {string} message Log-safe message.
 * @param {object} [detail] Extra machine-readable detail.
 * @returns {Error} Structured error.
 */
function exportError(code, message, detail = {}) {
  return Object.assign(new Error(message), {
    code,
    source: SERVICE_NAME,
    type: 'operational',
    timestamp: new Date().toISOString(),
    detail,
  });
}

/**
 * Returns the bound Markdown service or fails with a structured error.
 * @param {object} state Activation-bound references.
 * @returns {object} Bound pey.markdown.service.
 * @throws {Error} Structured error when called before local activation.
 */
function requireMarkdown(state) {
  if (!state.markdown) {
    throw exportError(
      'EXPORT_MARKDOWN_UNAVAILABLE',
      `Required service is unavailable: ${MARKDOWN_SERVICE}`,
      { service: MARKDOWN_SERVICE },
    );
  }
  return state.markdown;
}

/**
 * Builds the export service closing over activation-bound references.
 * @param {object} state References bound in prepare/activate ({ markdown, events }).
 * @returns {object} Service implementation.
 */
function createService(state) {
  const service = {
    async exportHtml(input = {}) {
      const source = input && typeof input === 'object' ? input : {};
      const markdown = typeof source.markdown === 'string' ? source.markdown : '';
      const title =
        typeof source.title === 'string' && source.title.trim().length > 0
          ? source.title.trim()
          : DEFAULT_TITLE;
      const theme = source.theme ?? DEFAULT_THEME;
      if (!outputThemes().includes(theme)) {
        throw exportError('EXPORT_INVALID_THEME', `Invalid theme value: ${String(source.theme)}`, {
          field: 'theme',
        });
      }
      const markdownService = requireMarkdown(state);
      let fragment;
      try {
        fragment = await markdownService.renderFragment({
          markdown,
          syntaxExtensions: [...persianSyntaxExtensions(), highlight()],
          htmlExtensions: [...persianHtmlExtensions(), highlightHtml()],
          footnoteOptions: persianFootnoteOptionsForRender(),
        });
      } catch (error) {
        throw exportError('EXPORT_RENDER_FAILED', 'Markdown render failed', {
          cause: error?.code ?? 'UNKNOWN',
        });
      }
      const html = assembleDocument({ title, bodyHtml: fragment?.html ?? '', theme });
      return { html, filename: `${sanitizeFileName(title)}.html`, mime: MIME_HTML };
    },
    async exportZip(input = {}) {
      const source = input && typeof input === 'object' ? input : {};
      if (!Array.isArray(source.documents)) {
        throw exportError('EXPORT_INVALID_INPUT', 'Zip export requires a documents array', {
          field: 'documents',
        });
      }
      let blob;
      try {
        blob = await createZipBlob(source.documents);
      } catch (error) {
        throw exportError('EXPORT_ZIP_FAILED', 'Zip archive build failed', {
          cause: error?.code ?? 'UNKNOWN',
        });
      }
      return { blob, filename: ARCHIVE_FILENAME, mime: MIME_ZIP };
    },
  };
  return service;
}

export {
  DEFAULT_THEME,
  DEFAULT_TITLE,
  MARKDOWN_SERVICE,
  MIME_HTML,
  SERVICE_NAME,
  createService,
  sanitizeFileName,
};
