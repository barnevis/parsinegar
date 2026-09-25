// Documents service: multi-document management over the storage service.
const STORAGE_SERVICE = 'pey.storage.service';
const SERVICE_NAME = 'parsinegar.documents.service';
const COLLECTION = 'documents';
const CHANGED_EVENT = 'documents:changed';
const UNTITLED_TITLE = 'بدون عنوان';
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
    throw new Error(`Required service is unavailable: ${STORAGE_SERVICE}`);
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
      return orderByUpdated(records).map(withCreatedAt).map(withReadOnly);
    },
    async openDocument(id) {
      try {
        return withReadOnly(withCreatedAt(await requireStorage(state).read(COLLECTION, id)));
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
      const stored = { ...record, readOnly, createdAt: existing?.createdAt ?? record.updatedAt };
      await requireStorage(state).write(COLLECTION, stored);
      state.events?.publish(CHANGED_EVENT, { id: stored.id });
      return stored;
    },
    async createDocument(title) {
      const base = typeof title === 'string' && title.length > 0 ? title : UNTITLED_TITLE;
      for (let attempt = 1; attempt <= 999; attempt += 1) {
        const candidate = attempt === 1 ? base : `${base} ${toFaDigits(attempt)}`;
        try {
          return await service.saveDocument({ title: candidate });
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
  };
  return service;
}

export { CHANGED_EVENT, COLLECTION, SERVICE_NAME, STORAGE_SERVICE, UNTITLED_TITLE, createService };
