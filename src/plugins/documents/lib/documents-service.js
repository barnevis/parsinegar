// Documents service: multi-document management over the storage service.
const STORAGE_SERVICE = 'pey.storage.service';
const SERVICE_NAME = 'parsinegar.documents.service';
const COLLECTION = 'documents';
const CHANGED_EVENT = 'documents:changed';
const UNTITLED_TITLE = 'بدون عنوان';

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
      return orderByUpdated(records);
    },
    async openDocument(id) {
      try {
        return await requireStorage(state).read(COLLECTION, id);
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
      await requireStorage(state).write(COLLECTION, record);
      state.events?.publish(CHANGED_EVENT, { id: record.id });
      return record;
    },
    async createDocument(title) {
      return service.saveDocument({ title });
    },
    async deleteDocument(id) {
      await requireStorage(state).delete(COLLECTION, id);
      state.events?.publish(CHANGED_EVENT, { id });
    },
  };
  return service;
}

export { CHANGED_EVENT, COLLECTION, SERVICE_NAME, STORAGE_SERVICE, UNTITLED_TITLE, createService };
