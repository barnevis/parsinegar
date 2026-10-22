// Download flows for the workbench page.
//
// Turns documents into deliverable files (Markdown, standalone HTML, zip
// of the whole library) and hands the bytes to the browser through a
// temporary anchor in the page shadow. The export service renders, the
// document controller prepares records; this module only shapes the
// payloads and releases the object URLs it creates.
/**
 * Resolves a stored theme preference to an export theme. `device` follows
 * the OS preference; anything unknown falls back to light (the export
 * service accepts only light, dark and sepia).
 * @param {unknown} value Stored theme value.
 * @returns {string} Export theme name.
 */
function resolveExportTheme(value) {
  if (value === 'dark' || value === 'sepia' || value === 'light') {
    return value;
  }
  if (value === 'device' && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches === true ? 'dark' : 'light';
  }
  return 'light';
}

/**
 * Delivers one blob through a temporary anchor (released after the click).
 * @param {ShadowRoot} shadowRoot Page shadow hosting the anchor.
 * @param {Blob} blob Payload bytes.
 * @param {string} filename Download name.
 * @returns {void}
 */
function deliverBlob(shadowRoot, blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    shadowRoot.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function createExportFlow({
  getDocs = () => null,
  getExporter = () => null,
  getSettings = () => null,
  getShadowRoot = () => null,
  isConnected = () => true,
} = {}) {
  const supported = () => typeof URL.createObjectURL === 'function' && getShadowRoot() !== null;

  /**
   * Downloads a document as a Markdown file through a temporary anchor in
   * the page shadow (released right after the click).
   * @param {unknown} id Document id from the event detail.
   * @returns {Promise<void>}
   */
  async function downloadDocument(id) {
    if (!supported()) {
      console.error('[parsi-page-home] download is unsupported here');
      return;
    }
    try {
      const record = await getDocs()?.prepareDownload(id);
      if (!isConnected() || !record) {
        return;
      }
      deliverBlob(
        getShadowRoot(),
        new Blob([record.content ?? ''], { type: 'text/markdown' }),
        `${String(record.title ?? '').replace(/[\\/]/g, '-')}.md`,
      );
    } catch (error) {
      console.error('[parsi-page-home] document download failed');
    }
  }

  /**
   * Downloads a document as a standalone HTML file: the export service
   * renders the content with the effective theme, the page only delivers
   * the resulting bytes through a temporary anchor (released after click).
   * @param {unknown} id Document id from the event detail.
   * @returns {Promise<void>}
   */
  async function downloadHtmlDocument(id) {
    if (!supported()) {
      console.error('[parsi-page-home] download is unsupported here');
      return;
    }
    try {
      const record = await getDocs()?.prepareDownload(id);
      const exporter = getExporter();
      if (!isConnected() || !record || !exporter) {
        return;
      }
      const stored = getSettings()?.getState().settings ?? null;
      const result = await exporter.exportHtml({
        markdown: record.content ?? '',
        title: record.title ?? '',
        theme: resolveExportTheme(stored?.theme),
      });
      if (!isConnected() || !result) {
        return;
      }
      deliverBlob(
        getShadowRoot(),
        new Blob([result.html ?? ''], { type: 'text/html' }),
        result.filename ?? 'document.html',
      );
    } catch (error) {
      console.error('[parsi-page-home] html download failed');
    }
  }

  /**
   * Downloads the whole library as a Markdown zip archive: every document
   * with its folder path goes through the export service, the page only
   * delivers the resulting bytes through a temporary anchor.
   * @returns {Promise<void>}
   */
  async function downloadZipLibrary() {
    if (!supported()) {
      console.error('[parsi-page-home] download is unsupported here');
      return;
    }
    try {
      const exporter = getExporter();
      if (!isConnected() || !exporter || typeof exporter.exportZip !== 'function') {
        return;
      }
      const result = await exporter.exportZip({
        documents: getDocs()?.collectLibraryDocuments() ?? [],
      });
      if (!isConnected() || !result) {
        return;
      }
      deliverBlob(getShadowRoot(), result.blob, result.filename ?? 'parsinegar-documents.zip');
    } catch (error) {
      console.error('[parsi-page-home] zip download failed');
    }
  }

  return { downloadDocument, downloadHtmlDocument, downloadZipLibrary };
}
