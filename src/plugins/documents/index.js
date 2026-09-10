// Parsinegar documents plugin: multi-document management over storage.
const STORAGE_SERVICE = 'pey.storage.service';
const SERVICE_NAME = 'parsinegar.documents.service';
const COLLECTION = 'documents';
const CHANGED_EVENT = 'documents:changed';
const UNTITLED_TITLE = 'بدون عنوان';

const state = { storage: null, events: null };

/**
 * Returns the bound storage service or fails clearly before activation.
 * @returns {object} Bound pey.storage.service.
 * @throws {Error} When called before local activation.
 */
function requireStorage() {
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
 * @returns {object} Service implementation.
 */
function createService() {
  const service = {
    async listDocuments() {
      const records = await requireStorage().query(COLLECTION, {});
      return orderByUpdated(records);
    },
    async openDocument(id) {
      try {
        return await requireStorage().read(COLLECTION, id);
      } catch (error) {
        if (error?.code === 'RECORD_NOT_FOUND') {
          return null;
        }
        throw error;
      }
    },
    async saveDocument(input = {}) {
      const record = {
        id: typeof input.id === 'string' && input.id.length > 0 ? input.id : crypto.randomUUID(),
        title: typeof input.title === 'string' && input.title.length > 0 ? input.title : UNTITLED_TITLE,
        content: typeof input.content === 'string' ? input.content : '',
        updatedAt: Date.now(),
      };
      await requireStorage().write(COLLECTION, record);
      state.events?.publish(CHANGED_EVENT, { id: record.id });
      return record;
    },
    async createDocument(title) {
      return service.saveDocument({ title });
    },
    async deleteDocument(id) {
      await requireStorage().delete(COLLECTION, id);
      state.events?.publish(CHANGED_EVENT, { id });
    },
  };
  return service;
}

/**
 * Prepares the plugin: builds the service and registers lifecycle hooks.
 * @param {object} prepareContext Bonyan preparation context.
 * @returns {Promise<Array>} Service registration.
 */
export async function prepare(prepareContext) {
  state.storage = null;
  state.events = prepareContext.events ?? null;
  prepareContext.onDeactivated = () => {
    state.storage = null;
  };
  prepareContext.onShutdown = async () => {
    state.storage = null;
  };
  return [{ name: SERVICE_NAME, object: createService() }];
}

/**
 * Activates the plugin: binds the storage dependency for service methods.
 * @param {Record<string, object>} services Bound declared dependencies.
 * @returns {Promise<void>}
 */
export async function activate(services) {
  const storage = services[STORAGE_SERVICE];
  if (!storage) {
    throw new Error(`Required service is unavailable: ${STORAGE_SERVICE}`);
  }
  state.storage = storage;
}
