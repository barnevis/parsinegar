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
  let folders = [];
  let currentId = null;
  let docTitle = '';
  let draft = null;
  let saveTimer = null;
  let confirmDeleteId = null;
  let confirmFolderDeleteId = null;
  let propsRecord = null;

  function clearSaveTimer() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  }

  /**
   * Reads both lists, degrading when the service predates folders.
   * @returns {Promise<object>} `{ items, folders }`.
   */
  async function readLists() {
    const listed = await service.listDocuments();
    const folderList = typeof service.listFolders === 'function' ? await service.listFolders() : [];
    return { items: listed, folders: folderList };
  }

  /**
   * Counts documents inside a folder subtree (the folder itself plus all
   * descendants) from the current snapshots.
   * @param {string} id Folder id.
   * @returns {number} Contained document count.
   */
  function countFolderDocuments(id) {
    const childrenOf = new Map();
    for (const folder of folders) {
      const parent = folder.parentId ?? null;
      if (!childrenOf.has(parent)) {
        childrenOf.set(parent, []);
      }
      childrenOf.get(parent).push(folder.id);
    }
    const inside = new Set([id]);
    const queue = [id];
    while (queue.length > 0) {
      for (const child of childrenOf.get(queue.pop()) ?? []) {
        if (!inside.has(child)) {
          inside.add(child);
          queue.push(child);
        }
      }
    }
    return items.filter((item) => inside.has(item.folderId ?? null)).length;
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
     * @returns {object} `{ items, folders, currentId, docTitle, draft, confirmDeleteId, confirmFolderDeleteId, propsRecord }`.
     */
    getState() {
      return {
        items: [...items],
        folders: [...folders],
        currentId,
        docTitle,
        draft,
        confirmDeleteId,
        confirmFolderDeleteId,
        propsRecord,
      };
    },

    /**
     * Returns the pending modal snapshot, or null when nothing is pending.
     * @returns {object|null} `{ kind: 'confirm', title }`, `{ kind: 'confirm-folder', title, count }` or the formatted properties snapshot.
     */
    getModal() {
      if (confirmDeleteId !== null) {
        const pending = items.find((item) => item.id === confirmDeleteId) ?? null;
        return { kind: 'confirm', title: pending?.title ?? null };
      }
      if (confirmFolderDeleteId !== null) {
        const pending = folders.find((folder) => folder.id === confirmFolderDeleteId) ?? null;
        return { kind: 'confirm-folder', title: pending?.name ?? null, count: countFolderDocuments(confirmFolderDeleteId) };
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
     * @param {object[]|null} [foldersSnapshot] Fresh folder list (keeps the old one when absent).
     * @returns {void}
     */
    adopt(record, itemsSnapshot, foldersSnapshot = null) {
      items = itemsSnapshot;
      if (foldersSnapshot !== null) {
        folders = foldersSnapshot;
      }
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
     * @returns {Promise<object>} `{ apply, items, folders }` to open, or `{ none: true }`.
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
        const folderList = typeof service.listFolders === 'function' ? await service.listFolders() : [];
        if (!isLive()) {
          return { none: true };
        }
        if (listed.length === 0) {
          const created = await service.saveDocument({
            title: translate('parsinegar.documents.new-title'),
            content: SAMPLE_DOCUMENT,
          });
          if (!isLive()) {
            return { none: true };
          }
          return { apply: created, items: [created], folders: folderList };
        }
        const opened = await service.openDocument(listed[0].id);
        if (!isLive()) {
          return { none: true };
        }
        const record = opened ?? listed[0];
        return { apply: record, items: listed, folders: folderList };
      } catch (error) {
        console.error('[parsi-document-controller] document load failed');
        return { none: true };
      }
    },

    /**
     * Switches to another document, flushing the pending save first.
     * @param {unknown} id Target document id.
     * @returns {Promise<object|null>} `{ apply, items, folders }`, or null on no-op/failure.
     */
    async switchDocument(id) {
      if (!id || id === currentId || !service) {
        return null;
      }
      confirmDeleteId = null;
      confirmFolderDeleteId = null;
      try {
        await controller.flushSave();
        if (!isLive()) {
          return null;
        }
        const opened = await service.openDocument(id);
        if (!isLive() || !opened) {
          return null;
        }
        const { items: listed, folders: folderList } = await readLists();
        if (!isLive()) {
          return null;
        }
        return { apply: opened, items: listed, folders: folderList };
      } catch (error) {
        console.error('[parsi-document-controller] document switch failed');
        return null;
      }
    },

    /**
     * Creates a new empty document and opens it (in the given folder, or
     * the root).
     * @param {string|null} [folderId] Target folder id, null for the root.
     * @returns {Promise<object|null>} `{ apply, items, folders }`, or null on failure.
     */
    async createDocument(folderId = null) {
      if (!service) {
        return null;
      }
      confirmDeleteId = null;
      confirmFolderDeleteId = null;
      try {
        await controller.flushSave();
        if (!isLive()) {
          return null;
        }
        const created = await service.createDocument(translate('parsinegar.documents.new-title'), folderId);
        if (!isLive()) {
          return null;
        }
        const { items: listed, folders: folderList } = await readLists();
        if (!isLive()) {
          return null;
        }
        const record = { ...created, content: '' };
        return { apply: record, items: listed, folders: folderList };
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
     * Dismisses any pending overlay (delete confirmations, properties).
     * @returns {void}
     */
    cancelOverlays() {
      confirmDeleteId = null;
      confirmFolderDeleteId = null;
      propsRecord = null;
    },

    /**
     * Deletes the confirmed document. Removing the open document returns the
     * most recent survivor (or a fresh one) for the page to adopt; removing
     * a background document only refreshes the list — the timer, focus and
     * undo of the open document stay alive because the timer is cleared
     * solely on current removal.
     * @returns {Promise<object|null>} `{ apply|null, items, folders, removingCurrent }`, or null on no-op.
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
        const { items: listed, folders: folderList } = await readLists();
        if (!isLive()) {
          return null;
        }
        if (!removingCurrent) {
          items = listed;
          folders = folderList;
          return { apply: null, items: listed, folders: folderList, removingCurrent };
        }
        if (listed.length === 0) {
          const created = await service.saveDocument({
            title: translate('parsinegar.documents.new-title'),
            content: '',
          });
          if (!isLive()) {
            return null;
          }
          return { apply: created, items: [created], folders: folderList, removingCurrent };
        }
        const opened = await service.openDocument(listed[0].id);
        if (!isLive()) {
          return null;
        }
        const record = opened ?? listed[0];
        return { apply: record, items: listed, folders: folderList, removingCurrent };
      } catch (error) {
        console.error('[parsi-document-controller] document deletion failed');
        return null;
      }
    },

    /**
     * Arms the folder delete confirmation. The modal names the folder with
     * its contained document count.
     * @param {unknown} id Folder id from the event detail.
     * @returns {boolean} True when a confirmation is pending.
     */
    armFolderDelete(id) {
      if (!service || typeof id !== 'string' || id.length === 0) {
        return false;
      }
      if (!folders.some((folder) => folder.id === id)) {
        return false;
      }
      confirmFolderDeleteId = id;
      confirmDeleteId = null;
      propsRecord = null;
      return true;
    },

    /**
     * Deletes the confirmed folder with its subtree. When the open document
     * goes away with it, the most recent survivor (or a fresh document) is
     * returned for the page to adopt.
     * @returns {Promise<object|null>} `{ apply|null, items, folders, removingCurrent }`, or null on no-op.
     */
    async confirmFolderDelete() {
      if (!service || confirmFolderDeleteId === null) {
        return null;
      }
      const removedId = confirmFolderDeleteId;
      confirmFolderDeleteId = null;
      try {
        await controller.flushSave();
        if (!isLive()) {
          return null;
        }
        await service.deleteFolder(removedId);
        if (!isLive()) {
          return null;
        }
        const { items: listed, folders: folderList } = await readLists();
        if (!isLive()) {
          return null;
        }
        const removingCurrent = currentId !== null && !listed.some((item) => item.id === currentId);
        if (!removingCurrent) {
          items = listed;
          folders = folderList;
          return { apply: null, items: listed, folders: folderList, removingCurrent };
        }
        clearSaveTimer();
        if (listed.length === 0) {
          const created = await service.saveDocument({
            title: translate('parsinegar.documents.new-title'),
            content: '',
          });
          if (!isLive()) {
            return null;
          }
          return { apply: created, items: [created], folders: folderList, removingCurrent };
        }
        const opened = await service.openDocument(listed[0].id);
        if (!isLive()) {
          return null;
        }
        const record = opened ?? listed[0];
        return { apply: record, items: listed, folders: folderList, removingCurrent };
      } catch (error) {
        console.error('[parsi-document-controller] folder deletion failed');
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
     * @returns {Promise<object|null>} `{ apply, items, folders }`, or null on no-op/failure.
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
        const { items: listed, folders: folderList } = await readLists();
        if (!isLive()) {
          return null;
        }
        const record = { ...saved, content: text };
        return { apply: record, items: listed, folders: folderList };
      } catch (error) {
        console.error('[parsi-document-controller] document import failed');
        return null;
      }
    },

    /**
     * Imports a device folder as browser documents: reuses the root folder
     * with the same name (or creates it), recreates nested folders, and
     * matches files by disk origin — changed files update in place (even
     * renamed documents), new files are added, and files gone from disk
     * stay untouched (never auto-deleted).
     * @param {object} [input] Import payload.
     * @param {string} [input.rootName] Disk folder name.
     * @param {Array} [input.files] `{ name, path, content }` in disk order.
     * @returns {Promise<object|null>} `{ apply|null, items, folders }`, or null on no-op/failure.
     */
    async importFolder({ rootName, files } = {}) {
      if (!service || typeof service.createFolder !== 'function') {
        return null;
      }
      const entries = (Array.isArray(files) ? files : []).filter((file) => file && typeof file.name === 'string');
      try {
        await controller.flushSave();
        if (!isLive()) {
          return null;
        }
        const cleanRoot = typeof rootName === 'string' && rootName.trim().length > 0
          ? rootName.trim()
          : translate('parsinegar.folders.new');
        let folderList = await service.listFolders();
        const findChild = (parentId, name) => folderList.find((folder) => (folder.parentId ?? null) === (parentId ?? null) && folder.name === name) ?? null;
        let root = findChild(null, cleanRoot);
        if (!root) {
          root = await service.createFolder(cleanRoot, null);
          folderList = await service.listFolders();
        }
        if (!isLive()) {
          return null;
        }
        const ensureDir = async (segments) => {
          let parent = root;
          for (const segment of segments) {
            const next = findChild(parent.id, segment);
            if (next) {
              parent = next;
            } else {
              parent = await service.createFolder(segment, parent.id);
              folderList = await service.listFolders();
            }
          }
          return parent;
        };
        const listed = await service.listDocuments();
        const byOrigin = new Map();
        for (const record of listed) {
          if (typeof record.origin === 'string') {
            byOrigin.set(`${record.folderId ?? ''}\n${record.origin}`, record);
          }
        }
        const adopted = [];
        for (const file of entries) {
          const relative = typeof file.path === 'string' && file.path.length > 0 ? file.path : file.name;
          const segments = relative.split('/').filter((segment) => segment.length > 0);
          const folder = await ensureDir(segments.slice(0, -1));
          if (!isLive()) {
            return null;
          }
          const title = deriveImportTitle(file.name);
          const text = typeof file.content === 'string' ? file.content.replace(/^\uFEFF/, '') : '';
          const known = byOrigin.get(`${folder.id}\n${relative}`);
          if (known) {
            const saved = await service.saveDocument({ id: known.id, title: known.title, content: text });
            adopted.push({ ...saved, content: text });
          } else {
            const created = await service.createDocument(title.length > 0 ? title : translate('parsinegar.documents.new-title'), folder.id, relative);
            const saved = await service.saveDocument({ id: created.id, title: created.title, content: text });
            adopted.push({ ...saved, content: text });
          }
          if (!isLive()) {
            return null;
          }
        }
        const { items: fresh, folders: freshFolders } = await readLists();
        items = fresh;
        folders = freshFolders;
        if (adopted.length === 0) {
          return { apply: null, items: fresh, folders: freshFolders };
        }
        return { apply: adopted[0], items: fresh, folders: freshFolders };
      } catch (error) {
        console.error('[parsi-document-controller] folder import failed');
        return null;
      }
    },

    /**
     * Imports a device folder as browser documents: reuses the root folder
     * with the same name (or creates it), recreates nested folders, and
     * matches files by disk origin — changed files update in place (even
     * renamed documents keep their names), new files are added, and files
     * gone from disk stay untouched (never auto-deleted).
     * @param {object} [input] Import payload.
     * @param {string} [input.rootName] Disk folder name.
     * @param {Array} [input.files] `{ name, path, content }` in disk order.
     * @returns {Promise<object|null>} `{ apply|null, items, folders }`, or null on no-op/failure.
     */
    async importFolder({ rootName, files } = {}) {
      if (!service || typeof service.createFolder !== 'function') {
        return null;
      }
      const entries = (Array.isArray(files) ? files : []).filter((file) => file && typeof file.name === 'string');
      try {
        await controller.flushSave();
        if (!isLive()) {
          return null;
        }
        const cleanRoot = typeof rootName === 'string' && rootName.trim().length > 0
          ? rootName.trim()
          : translate('parsinegar.folders.new');
        let folderList = await service.listFolders();
        const findChild = (parentId, name) => folderList.find((folder) => (folder.parentId ?? null) === (parentId ?? null) && folder.name === name) ?? null;
        let root = findChild(null, cleanRoot);
        if (!root) {
          root = await service.createFolder(cleanRoot, null);
          folderList = await service.listFolders();
        }
        if (!isLive()) {
          return null;
        }
        const ensureDir = async (segments) => {
          let parent = root;
          for (const segment of segments) {
            const next = findChild(parent.id, segment);
            if (next) {
              parent = next;
            } else {
              parent = await service.createFolder(segment, parent.id);
              folderList = await service.listFolders();
            }
          }
          return parent;
        };
        const listed = await service.listDocuments();
        const byOrigin = new Map();
        for (const record of listed) {
          if (typeof record.origin === 'string') {
            byOrigin.set(`${record.folderId ?? ''}\n${record.origin}`, record);
          }
        }
        const adopted = [];
        for (const file of entries) {
          const relative = typeof file.path === 'string' && file.path.length > 0 ? file.path : file.name;
          const segments = relative.split('/').filter((segment) => segment.length > 0);
          const folder = await ensureDir(segments.slice(0, -1));
          if (!isLive()) {
            return null;
          }
          const name = deriveImportTitle(file.name);
          const title = name.length > 0 ? name : translate('parsinegar.documents.new-title');
          const text = typeof file.content === 'string' ? file.content.replace(/^\uFEFF/, '') : '';
          const known = byOrigin.get(`${folder.id}\n${relative}`);
          if (known) {
            const saved = await service.saveDocument({ id: known.id, title: known.title, content: text });
            adopted.push({ ...saved, content: text });
          } else {
            const created = await service.createDocument(title, folder.id, relative);
            const saved = await service.saveDocument({ id: created.id, title: created.title, content: text });
            adopted.push({ ...saved, content: text });
          }
          if (!isLive()) {
            return null;
          }
        }
        const { items: fresh, folders: freshFolders } = await readLists();
        items = fresh;
        folders = freshFolders;
        if (adopted.length === 0) {
          return { apply: null, items: fresh, folders: freshFolders };
        }
        return { apply: adopted[0], items: fresh, folders: freshFolders };
      } catch (error) {
        console.error('[parsi-document-controller] folder import failed');
        return null;
      }
    },

    /**
     * Creates a folder (optionally nested) and refreshes the lists.
     * @param {unknown} name Folder name.
     * @param {unknown} parentId Parent folder id, null for the root.
     * @returns {Promise<object|null>} `{ folders, items }`, or null on no-service.
     */
    async createFolder(name, parentId = null) {
      if (!service || typeof service.createFolder !== 'function') {
        return null;
      }
      try {
        const clean = typeof name === 'string' && name.trim().length > 0
          ? name.trim()
          : translate('parsinegar.folders.new');
        const folder = await service.createFolder(clean, typeof parentId === 'string' ? parentId : null);
        if (!isLive()) {
          return null;
        }
        const { items: listed, folders: folderList } = await readLists();
        if (!isLive()) {
          return null;
        }
        items = listed;
        folders = folderList;
        return { folders: folderList, items: listed, created: folder };
      } catch (error) {
        console.error('[parsi-document-controller] folder creation failed');
        return null;
      }
    },

    /**
     * Renames a folder through the service.
     * @param {unknown} id Folder id from the event detail.
     * @param {unknown} name New name from the event detail.
     * @returns {Promise<string>} 'renamed', 'empty', 'duplicate', 'failed' or 'ignored'.
     */
    async renameFolder(id, name) {
      if (!service || typeof service.renameFolder !== 'function' || typeof id !== 'string' || id.length === 0) {
        return 'ignored';
      }
      const next = typeof name === 'string' ? name.trim() : '';
      if (next.length === 0) {
        return 'empty';
      }
      try {
        const saved = await service.renameFolder(id, next);
        if (!isLive() || !saved) {
          return 'failed';
        }
        const { folders: folderList } = await readLists();
        folders = folderList;
        return 'renamed';
      } catch (error) {
        if (error?.code === 'FOLDER_TITLE_DUPLICATE') {
          return 'duplicate';
        }
        console.error('[parsi-document-controller] folder rename failed');
        return 'failed';
      }
    },

    /**
     * Moves a document into a folder (or back to the root) and refreshes
     * the lists. The open document stays open wherever it lands.
     * @param {unknown} id Document id from the event detail.
     * @param {unknown} folderId Target folder id, null for the root.
     * @returns {Promise<boolean>} True when the lists were refreshed.
     */
    async moveDocument(id, folderId = null) {
      if (!service || typeof service.moveDocument !== 'function' || typeof id !== 'string' || id.length === 0) {
        return false;
      }
      try {
        const moved = await service.moveDocument(id, typeof folderId === 'string' ? folderId : null);
        if (!isLive() || !moved) {
          return false;
        }
        const { items: listed, folders: folderList } = await readLists();
        items = listed;
        folders = folderList;
        return true;
      } catch (error) {
        console.error('[parsi-document-controller] document move failed');
        return false;
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
