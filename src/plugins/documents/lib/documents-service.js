// Documents service: multi-document management over the storage service.
const STORAGE_SERVICE = 'pey.storage.service';
const SERVICE_NAME = 'parsinegar.documents.service';
const COLLECTION = 'documents';
const FOLDERS_COLLECTION = 'folders';
const CHANGED_EVENT = 'documents:changed';
const FOLDER_CHANGED_EVENT = 'folders:changed';
const UNTITLED_TITLE = 'بدون عنوان';
const UNTITLED_FOLDER = 'پوشهٔ تازه';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/**
 * Generates a document id. Prefers crypto.randomUUID, which is unavailable
 * outside secure contexts (plain HTTP on a LAN).
 * @returns {string} Unique-enough id.
 */
function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffffff).toString(36)}`;
}

/**
 * Returns the bound storage service or fails clearly before activation.
 * @param {object} state Activation-bound references.
 * @returns {object} Bound pey.storage.service.
 * @throws {Error} When called before local activation.
 */
function requireStorage(state) {
  if (!state.storage) {
    throw documentsError(
      'DOCUMENTS_STORAGE_UNAVAILABLE',
      `Required service is unavailable: ${STORAGE_SERVICE}`,
      { service: STORAGE_SERVICE },
    );
  }
  return state.storage;
}

/**
 * Builds a standard Bonyan boundary error for validation failures.
 * @param {string} code Stable error code.
 * @param {string} message Log-safe message.
 * @param {object} [detail] Extra machine-readable detail.
 * @returns {Error} Structured error.
 */
function documentsError(code, message, detail = {}) {
  return Object.assign(new Error(message), {
    code,
    source: SERVICE_NAME,
    type: 'operational',
    timestamp: new Date().toISOString(),
    detail,
  });
}

/**
 * Backfills the creation timestamp for records stored before it existed.
 * @param {object|null} record Stored record.
 * @returns {object|null} Record with `createdAt`.
 */
function withCreatedAt(record) {
  if (!record || typeof record !== 'object') {
    return record;
  }
  return { ...record, createdAt: record.createdAt ?? record.updatedAt ?? Date.now() };
}

/**
 * Backfills the read-only flag for records stored before it existed.
 * @param {object|null} record Stored record.
 * @returns {object|null} Record with a boolean `readOnly`.
 */
function withReadOnly(record) {
  if (!record || typeof record !== 'object') {
    return record;
  }
  return { ...record, readOnly: record.readOnly === true };
}

/**
 * Backfills the folder reference for records stored before folders existed.
 * @param {object|null} record Stored record.
 * @returns {object|null} Record with `folderId`.
 */
function withFolderId(record) {
  if (!record || typeof record !== 'object') {
    return record;
  }
  return { ...record, folderId: typeof record.folderId === 'string' ? record.folderId : null };
}

/**
 * Checks whether another record already carries the title.
 * @param {object} state Activation-bound references.
 * @param {string} title Candidate title.
 * @param {string|null} exceptId Record id to exclude from the check.
 * @returns {Promise<boolean>} True when the title is taken.
 */
async function isTitleTaken(state, title, exceptId) {
  const records = await requireStorage(state).query(COLLECTION, {});
  return records.some((record) => record.title === title && record.id !== exceptId);
}

/**
 * Checks whether a sibling folder already carries the name (same parent).
 * @param {object} state Activation-bound references.
 * @param {string} name Candidate name.
 * @param {string|null} parentId Parent folder id, null for the root.
 * @param {string|null} exceptId Folder id to exclude from the check.
 * @returns {Promise<boolean>} True when the name is taken among siblings.
 */
async function isFolderNameTaken(state, name, parentId, exceptId) {
  const folders = await requireStorage(state).query(FOLDERS_COLLECTION, {});
  return folders.some((folder) => folder.name === name
    && (folder.parentId ?? null) === (parentId ?? null)
    && folder.id !== exceptId);
}

/**
 * Validates a folder name: non-empty after trimming, no slashes (names
 * double as path segments in the tree).
 * @param {unknown} name Candidate name.
 * @returns {string|null} Trimmed name, or null when invalid.
 */
function cleanFolderName(name) {
  if (typeof name !== 'string') {
    return null;
  }
  const next = name.trim();
  if (next.length === 0 || next.includes('/')) {
    return null;
  }
  return next;
}

/**
 * Resolves a folder reference to an existing folder id, falling back to
 * the root when missing.
 * @param {object} state Activation-bound references.
 * @param {unknown} folderId Candidate folder id.
 * @returns {Promise<string|null>} Existing folder id or null.
 */
async function resolveFolderId(state, folderId) {
  if (typeof folderId !== 'string' || folderId.length === 0) {
    return null;
  }
  try {
    const folder = await requireStorage(state).read(FOLDERS_COLLECTION, folderId);
    return folder ? folderId : null;
  } catch (error) {
    return null;
  }
}

/**
 * Collects a folder id with all its descendant folder ids.
 * @param {Array<object>} folders All folder records.
 * @param {string} id Root folder id.
 * @returns {Array<string>} The id plus every descendant id.
 */
function collectFolderTree(folders, id) {
  const childrenOf = new Map();
  for (const folder of folders) {
    const parent = folder.parentId ?? null;
    if (!childrenOf.has(parent)) {
      childrenOf.set(parent, []);
    }
    childrenOf.get(parent).push(folder.id);
  }
  const collected = [id];
  for (let index = 0; index < collected.length; index += 1) {
    for (const child of childrenOf.get(collected[index]) ?? []) {
      collected.push(child);
    }
  }
  return collected;
}

/**
 * Formats a counter with Persian digits for generated titles.
 * @param {number} value Counter value.
 * @returns {string} Persian-digit string.
 */
function toFaDigits(value) {
  return String(value).replace(/[0-9]/g, (digit) => FA_DIGITS[Number(digit)]);
}

/**
 * Sorts records by most recently updated first (storage has no ordering).
 * @param {Array<object>} records Document records.
 * @returns {Array<object>} Sorted copy.
 */
function orderByUpdated(records) {
  return [...records].sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
}

/**
 * Builds the documents service closing over activation-bound references.
 * @param {object} state References bound in prepare/activate ({ storage, events }).
 * @returns {object} Service implementation.
 */
function createService(state) {
  const service = {
    async listDocuments() {
      const records = await requireStorage(state).query(COLLECTION, {});
      return orderByUpdated(records).map(withCreatedAt).map(withReadOnly).map(withFolderId);
    },
    async openDocument(id) {
      try {
        return withFolderId(withReadOnly(withCreatedAt(await requireStorage(state).read(COLLECTION, id))));
      } catch (error) {
        if (error?.code === 'RECORD_NOT_FOUND') {
          return null;
        }
        throw error;
      }
    },
    async saveDocument(input = {}) {
      const record = {
        id: typeof input.id === 'string' && input.id.length > 0 ? input.id : generateId(),
        title: typeof input.title === 'string' && input.title.length > 0 ? input.title : UNTITLED_TITLE,
        content: typeof input.content === 'string' ? input.content : '',
        updatedAt: Date.now(),
      };
      if (await isTitleTaken(state, record.title, record.id)) {
        throw documentsError('DOCUMENT_TITLE_DUPLICATE', `Document title is taken: ${record.title}`, { field: 'title' });
      }
      const existing = await service.openDocument(record.id);
      // The lock survives overwrites unless the caller states it explicitly.
      const readOnly = typeof input.readOnly === 'boolean' ? input.readOnly : existing?.readOnly === true;
      const folderId = typeof input.folderId === 'string'
        ? await resolveFolderId(state, input.folderId)
        : (input.folderId === null ? null : (existing?.folderId ?? null));
      const stored = { ...record, readOnly, folderId, createdAt: existing?.createdAt ?? record.updatedAt };
      await requireStorage(state).write(COLLECTION, stored);
      state.events?.publish(CHANGED_EVENT, { id: stored.id });
      return stored;
    },
    async createDocument(title, folderId = null) {
      const base = typeof title === 'string' && title.length > 0 ? title : UNTITLED_TITLE;
      const folder = await resolveFolderId(state, folderId);
      for (let attempt = 1; attempt <= 999; attempt += 1) {
        const candidate = attempt === 1 ? base : `${base} ${toFaDigits(attempt)}`;
        try {
          return await service.saveDocument({ title: candidate, folderId: folder });
        } catch (error) {
          if (error?.code !== 'DOCUMENT_TITLE_DUPLICATE') {
            throw error;
          }
        }
      }
      throw documentsError('DOCUMENT_TITLE_DUPLICATE', `Document title is taken: ${base}`, { field: 'title' });
    },
    async renameDocument(id, title) {
      const next = typeof title === 'string' ? title.trim() : '';
      if (next.length === 0) {
        throw documentsError('DOCUMENT_INVALID_TITLE', 'Document title must not be empty', { field: 'title' });
      }
      const existing = await service.openDocument(id);
      if (!existing) {
        return null;
      }
      if (await isTitleTaken(state, next, id)) {
        throw documentsError('DOCUMENT_TITLE_DUPLICATE', `Document title is taken: ${next}`, { field: 'title' });
      }
      const stored = { ...existing, title: next, updatedAt: Date.now() };
      await requireStorage(state).write(COLLECTION, stored);
      state.events?.publish(CHANGED_EVENT, { id });
      return stored;
    },
    async deleteDocument(id) {
      await requireStorage(state).delete(COLLECTION, id);
      state.events?.publish(CHANGED_EVENT, { id });
    },
    async setReadOnly(id, readOnly) {
      const existing = await service.openDocument(id);
      if (!existing) {
        return null;
      }
      const stored = { ...existing, readOnly: readOnly === true, updatedAt: Date.now() };
      await requireStorage(state).write(COLLECTION, stored);
      state.events?.publish(CHANGED_EVENT, { id });
      return stored;
    },
    async listFolders() {
      const folders = await requireStorage(state).query(FOLDERS_COLLECTION, {});
      return [...folders]
        .sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0))
        .map((folder) => ({
          id: folder.id,
          name: folder.name,
          parentId: folder.parentId ?? null,
          createdAt: folder.createdAt ?? Date.now(),
        }));
    },
    async createFolder(name, parentId = null) {
      const clean = cleanFolderName(name) ?? UNTITLED_FOLDER;
      const parent = await resolveFolderId(state, parentId);
      for (let attempt = 1; attempt <= 999; attempt += 1) {
        const candidate = attempt === 1 ? clean : `${clean} ${toFaDigits(attempt)}`;
        if (await isFolderNameTaken(state, candidate, parent, null)) {
          continue;
        }
        const now = Date.now();
        const folder = { id: generateId(), name: candidate, parentId: parent, createdAt: now, updatedAt: now };
        await requireStorage(state).write(FOLDERS_COLLECTION, folder);
        state.events?.publish(FOLDER_CHANGED_EVENT, { id: folder.id });
        return folder;
      }
      throw documentsError('FOLDER_TITLE_DUPLICATE', `Folder name is taken: ${clean}`, { field: 'name' });
    },
    async renameFolder(id, name) {
      const clean = cleanFolderName(name);
      if (clean === null) {
        throw documentsError('FOLDER_INVALID_NAME', 'Folder name must not be empty and must not contain slashes', { field: 'name' });
      }
      let existing = null;
      try {
        existing = await requireStorage(state).read(FOLDERS_COLLECTION, id);
      } catch (error) {
        if (error?.code !== 'RECORD_NOT_FOUND') {
          throw error;
        }
      }
      if (!existing) {
        return null;
      }
      if (await isFolderNameTaken(state, clean, existing.parentId ?? null, id)) {
        throw documentsError('FOLDER_TITLE_DUPLICATE', `Folder name is taken: ${clean}`, { field: 'name' });
      }
      const stored = { ...existing, name: clean, updatedAt: Date.now() };
      await requireStorage(state).write(FOLDERS_COLLECTION, stored);
      state.events?.publish(FOLDER_CHANGED_EVENT, { id });
      return stored;
    },
    async deleteFolder(id) {
      const folders = await requireStorage(state).query(FOLDERS_COLLECTION, {});
      if (!folders.some((folder) => folder.id === id)) {
        return;
      }
      const doomed = new Set(collectFolderTree(folders, id));
      const records = await requireStorage(state).query(COLLECTION, {});
      for (const record of records) {
        if (doomed.has(record.folderId ?? null)) {
          await requireStorage(state).delete(COLLECTION, record.id);
          state.events?.publish(CHANGED_EVENT, { id: record.id });
        }
      }
      for (const folderId of doomed) {
        await requireStorage(state).delete(FOLDERS_COLLECTION, folderId);
        state.events?.publish(FOLDER_CHANGED_EVENT, { id: folderId });
      }
    },
    async moveDocument(id, folderId = null) {
      const existing = await service.openDocument(id);
      if (!existing) {
        return null;
      }
      const folder = folderId === null ? null : await resolveFolderId(state, folderId);
      if (folderId !== null && folder === null) {
        return null;
      }
      const stored = { ...existing, folderId: folder, updatedAt: Date.now() };
      await requireStorage(state).write(COLLECTION, stored);
      state.events?.publish(CHANGED_EVENT, { id });
      return stored;
    },
  };
  return service;
}

export { CHANGED_EVENT, COLLECTION, FOLDER_CHANGED_EVENT, FOLDERS_COLLECTION, SERVICE_NAME, STORAGE_SERVICE, UNTITLED_FOLDER, UNTITLED_TITLE, createService };
