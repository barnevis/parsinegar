// Document working set for the workbench page.
//
// Owns everything the page knows about documents: the list snapshot, the
// open-document working set (id, title, draft), the autosave timer, and the
// pending overlay targets (delete confirmation, properties record). Speaks
// only to the documents service and answers with plain data; the page reads
// snapshots, applies records to the editor and owns every child handle and
// DOM effect. No DOM, no custom elements, no events.
import SAMPLE_DOCUMENT from '../../sample-document.js';
import { formatFileSize } from '../../components/workbench/stats.js';
import { formatDate, formatNumber } from '../../utils/format.js';

const AUTOSAVE_DELAY_MS = 1000;

/**
 * Filename extensions stripped when deriving an import title.
 */
const IMPORT_EXTENSIONS = ['.md', '.markdown', '.mdown', '.txt'];

/**
 * Derives a document title from an uploaded filename: trims whitespace,
 * strips a known Markdown/text extension (case-insensitive) and keeps
 * extensionless names whole. Returns '' when nothing remains.
 * @param {unknown} filename Uploaded file name.
 * @returns {string} Candidate title (possibly empty).
 */
export function deriveImportTitle(filename) {
  const trimmed = typeof filename === 'string' ? filename.trim() : '';
  const lower = trimmed.toLowerCase();
  for (const extension of IMPORT_EXTENSIONS) {
    if (lower.endsWith(extension)) {
      return trimmed.slice(0, -extension.length).trim();
    }
  }
  return trimmed;
}

/**
 * Creates the document working set bound to explicit dependencies.
 * @param {object} [options] Dependencies (all replaceable for tests).
 * @param {object|null} [options.documents] Documents service (null degrades to in-memory editing).
 * @param {Function} [options.t] Translate function `(key, params)`.
 * @param {Function|null} [options.format] Optional refs formatter.
 * @param {Function} [options.isLive] Returns false once the owner disconnects; pending flows stop then.
 * @param {Function} [options.readEditorContent] Returns the live editor text, or undefined when unmounted.
 * @returns {object} Document controller.
 */
export function createDocumentController({
  documents = null,
  t = (key) => key,
  format = null,
  isLive = () => true,
  readEditorContent = () => undefined,
} = {}) {
  let service = documents;
  let translate = t;
  let formatFn = format;
  let items = [];
  let currentId = null;
  let docTitle = '';
  let draft = null;
  let saveTimer = null;
  let confirmDeleteId = null;
  let propsRecord = null;

  function clearSaveTimer() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  }

  async function saveNow() {
    clearSaveTimer();
    if (!service || !currentId || !isLive()) {
      return;
    }
    try {
      await service.saveDocument({
        id: currentId,
        title: docTitle,
        content: readEditorContent() ?? draft ?? '',
      });
      items = await service.listDocuments();
    } catch (error) {
      console.error('[parsi-document-controller] autosave failed');
    }
  }

  const controller = {
    /**
     * Rebinds service dependencies, keeping the working set (reconnects must
     * not lose the open document).
     * @param {object} [options] Replacement dependencies.
     * @returns {void}
     */
    reconnect({ documents: nextDocuments, t: nextT, format: nextFormat } = {}) {
      if (nextDocuments !== undefined) {
        service = nextDocuments;
      }
      if (typeof nextT === 'function') {
        translate = nextT;
      }
      if (nextFormat !== undefined) {
        formatFn = nextFormat;
      }
    },

    /**
     * Releases owned resources (the pending autosave timer).
     * @returns {void}
     */
    dispose() {
      clearSaveTimer();
    },

    /**
     * Returns a render snapshot of the working set (never the live arrays).
     * @returns {object} `{ items, currentId, docTitle, draft, confirmDeleteId, propsRecord }`.
     */
    getState() {
      return {
        items: [...items],
        currentId,
        docTitle,
        draft,
        confirmDeleteId,
        propsRecord,
      };
    },

    /**
     * Returns the pending modal snapshot, or null when nothing is pending.
     * @returns {object|null} `{ kind: 'confirm', title }` or the formatted properties snapshot.
     */
    getModal() {
      if (confirmDeleteId !== null) {
        const pending = items.find((item) => item.id === confirmDeleteId) ?? null;
        return { kind: 'confirm', title: pending?.title ?? null };
      }
      if (propsRecord !== null) {
        const record = propsRecord;
        return {
          kind: 'properties',
          title: record.title ?? '',
          createdText: formatDate(formatFn, record.createdAt),
          updatedText: formatDate(formatFn, record.updatedAt),
          sizeText: formatFileSize(
            new TextEncoder().encode(record.content ?? '').length,
            (value) => formatNumber(formatFn, value),
            translate,
          ),
        };
      }
      return null;
    },

    /**
     * Adopts an opened record as the working set. The page calls this after
     * unmounting the editor, so the parked old content cannot overwrite the
     * incoming draft.
     * @param {object} record Opened document record.
     * @param {object[]} itemsSnapshot Fresh document list.
     * @returns {void}
     */
    adopt(record, itemsSnapshot) {
      items = itemsSnapshot;
      currentId = record.id;
      docTitle = record.title ?? '';
      draft = record.content ?? '';
    },

    /**
     * Returns the unsaved draft text.
     * @returns {string|null} Draft, or null before the first edit.
     */
    getDraft() {
      return draft;
    },

    /**
     * Replaces the draft text (the page mirrors it into the editor).
     * @param {string} text New Markdown text.
     * @returns {void}
     */
    setDraft(text) {
      draft = text;
    },

    /**
     * Opens the most recent document on boot, creating the welcome document
     * when the store is empty.
     * @returns {Promise<object>} `{ apply, items }` to open, or `{ none: true }`.
     */
    async ensureInitial() {
      if (!service) {
        return { none: true };
      }
      try {
        const listed = await service.listDocuments();
        if (!isLive()) {
          return { none: true };
        }
        if (listed.length === 0) {
          const created = await service.saveDocument({
            title: translate('parsinegar.documents.welcome-title'),
            content: SAMPLE_DOCUMENT,
          });
          if (!isLive()) {
            return { none: true };
          }
          return { apply: created, items: [created] };
        }
        const opened = await service.openDocument(listed[0].id);
        if (!isLive()) {
          return { none: true };
        }
        const record = opened ?? listed[0];
        return { apply: record, items: listed };
      } catch (error) {
        console.error('[parsi-document-controller] document load failed');
        return { none: true };
      }
    },

    /**
     * Switches to another document, flushing the pending save first.
     * @param {unknown} id Target document id.
     * @returns {Promise<object|null>} `{ apply, items }`, or null on no-op/failure.
     */
    async switchDocument(id) {
      if (!id || id === currentId || !service) {
        return null;
      }
      confirmDeleteId = null;
      try {
        await controller.flushSave();
        if (!isLive()) {
          return null;
        }
        const opened = await service.openDocument(id);
        if (!isLive() || !opened) {
          return null;
        }
        const listed = await service.listDocuments();
        if (!isLive()) {
          return null;
        }
        return { apply: opened, items: listed };
      } catch (error) {
        console.error('[parsi-document-controller] document switch failed');
        return null;
      }
    },

    /**
     * Creates a new empty document and opens it.
     * @returns {Promise<object|null>} `{ apply, items }`, or null on failure.
     */
    async createDocument() {
      if (!service) {
        return null;
      }
      confirmDeleteId = null;
      try {
        await controller.flushSave();
        if (!isLive()) {
          return null;
        }
        const created = await service.createDocument(translate('parsinegar.documents.new-title'));
        if (!isLive()) {
          return null;
        }
        const listed = await service.listDocuments();
        if (!isLive()) {
          return null;
        }
        const record = { ...created, content: '' };
        return { apply: record, items: listed };
      } catch (error) {
        console.error('[parsi-document-controller] document creation failed');
        return null;
      }
    },

    /**
     * Arms the delete confirmation for the file-menu target (or the open
     * document when no id travels with the event, e.g. the top menu action).
     * @param {unknown} id Document id from the event detail.
     * @returns {boolean} True when a confirmation is pending.
     */
    armDelete(id) {
      if (!service) {
        return false;
      }
      const target = typeof id === 'string' && id.length > 0 ? id : currentId;
      if (!target) {
        return false;
      }
      confirmDeleteId = target;
      propsRecord = null;
      return true;
    },

    /**
     * Dismisses any pending overlay (delete confirmation, properties).
     * @returns {void}
     */
    cancelOverlays() {
      confirmDeleteId = null;
      propsRecord = null;
    },

    /**
     * Deletes the confirmed document. Removing the open document returns the
     * most recent survivor (or a fresh one) for the page to adopt; removing
     * a background document only refreshes the list — the timer, focus and
     * undo of the open document stay alive because the timer is cleared
     * solely on current removal.
     * @returns {Promise<object|null>} `{ apply|null, items, removingCurrent }`, or null on no-op.
     */
    async confirmDelete() {
      if (!service) {
        return null;
      }
      const removedId = confirmDeleteId ?? currentId;
      if (!removedId) {
        return null;
      }
      const removingCurrent = removedId === currentId;
      if (removingCurrent) {
        clearSaveTimer();
      }
      confirmDeleteId = null;
      try {
        await service.deleteDocument(removedId);
        if (!isLive()) {
          return null;
        }
        const listed = await service.listDocuments();
        if (!isLive()) {
          return null;
        }
        if (!removingCurrent) {
          items = listed;
          return { apply: null, items: listed, removingCurrent };
        }
        if (listed.length === 0) {
          const created = await service.saveDocument({
            title: translate('parsinegar.documents.new-title'),
            content: '',
          });
          if (!isLive()) {
            return null;
          }
          return { apply: created, items: [created], removingCurrent };
        }
        const opened = await service.openDocument(listed[0].id);
        if (!isLive()) {
          return null;
        }
        const record = opened ?? listed[0];
        return { apply: record, items: listed, removingCurrent };
      } catch (error) {
        console.error('[parsi-document-controller] document deletion failed');
        return null;
      }
    },

    /**
     * Renames a document through the service.
     * @param {unknown} id Document id from the event detail.
     * @param {unknown} title New title from the event detail.
     * @returns {Promise<string>} 'renamed', 'empty', 'duplicate', 'failed' or 'ignored'.
     */
    async renameDocument(id, title) {
      if (!service || typeof id !== 'string' || id.length === 0) {
        return 'ignored';
      }
      const next = typeof title === 'string' ? title.trim() : '';
      if (next.length === 0) {
        return 'empty';
      }
      try {
        const saved = await service.renameDocument(id, next);
        if (!isLive() || !saved) {
          return 'failed';
        }
        if (id === currentId) {
          docTitle = saved.title;
        }
        items = await service.listDocuments();
        return 'renamed';
      } catch (error) {
        if (error?.code === 'DOCUMENT_TITLE_DUPLICATE') {
          return 'duplicate';
        }
        console.error('[parsi-document-controller] document rename failed');
        return 'failed';
      }
    },

    /**
     * Locks or unlocks a document for reading through the service, keeping
     * the working-set snapshot in sync. Missing service or method degrades
     * to null (older service contracts carry no lock).
     * @param {unknown} id Document id.
     * @param {boolean} locked True locks, anything else unlocks.
     * @returns {Promise<object|null>} Updated record, or null on no-op/failure.
     */
    async setLock(id, locked) {
      if (!service || typeof service.setReadOnly !== 'function' || typeof id !== 'string' || id.length === 0) {
        return null;
      }
      try {
        const updated = await service.setReadOnly(id, locked === true);
        if (!isLive() || !updated) {
          return null;
        }
        items = items.map((item) => (item.id === id ? { ...item, readOnly: updated.readOnly } : item));
        return updated;
      } catch (error) {
        console.error('[parsi-document-controller] document lock failed');
        return null;
      }
    },

    /**
     * Imports file content as a new document: the title is uniquified through
     * `createDocument` (same Persian-digit suffixes), then the content is
     * saved onto it. A leading byte-order mark is stripped.
     * @param {object} [input] Import payload.
     * @param {string} [input.title] Candidate title (falls back to a new title).
     * @param {string} [input.content] Markdown text.
     * @returns {Promise<object|null>} `{ apply, items }`, or null on no-op/failure.
     */
    async importContent({ title, content } = {}) {
      if (!service) {
        return null;
      }
      const cleanTitle = typeof title === 'string' && title.trim().length > 0
        ? title.trim()
        : translate('parsinegar.documents.new-title');
      const text = typeof content === 'string' ? content.replace(/^\uFEFF/, '') : '';
      try {
        await controller.flushSave();
        if (!isLive()) {
          return null;
        }
        const created = await service.createDocument(cleanTitle);
        if (!isLive()) {
          return null;
        }
        const saved = await service.saveDocument({ id: created.id, title: created.title, content: text });
        if (!isLive()) {
          return null;
        }
        const listed = await service.listDocuments();
        if (!isLive()) {
          return null;
        }
        const record = { ...saved, content: text };
        return { apply: record, items: listed };
      } catch (error) {
        console.error('[parsi-document-controller] document import failed');
        return null;
      }
    },

    /**
     * Loads a document record for the properties overlay.
     * @param {unknown} id Document id from the event detail.
     * @returns {Promise<object|null>} Record, or null when unavailable.
     */
    async showProperties(id) {
      if (!service) {
        return null;
      }
      try {
        const record = await service.openDocument(id);
        if (!isLive() || !record) {
          return null;
        }
        confirmDeleteId = null;
        propsRecord = record;
        return record;
      } catch (error) {
        console.error('[parsi-document-controller] properties load failed');
        return null;
      }
    },

    /**
     * Loads a document record for download (the page owns the anchor trick).
     * @param {unknown} id Document id from the event detail.
     * @returns {Promise<object|null>} Record, or null when unavailable.
     */
    async prepareDownload(id) {
      if (!service || typeof id !== 'string' || id.length === 0) {
        return null;
      }
      try {
        const record = await service.openDocument(id);
        if (!isLive() || !record) {
          return null;
        }
        return record;
      } catch (error) {
        console.error('[parsi-document-controller] document download failed');
        return null;
      }
    },

    /**
     * Schedules an autosave of the working set (no-op without a service or
     * an open document).
     * @returns {void}
     */
    scheduleSave() {
      if (!service || !currentId) {
        return;
      }
      clearSaveTimer();
      saveTimer = setTimeout(() => void saveNow(), AUTOSAVE_DELAY_MS);
    },

    /**
     * Flushes a pending autosave immediately.
     * @returns {Promise<void>}
     */
    async flushSave() {
      if (!saveTimer) {
        return;
      }
      clearSaveTimer();
      await saveNow();
    },
  };

  return controller;
}
