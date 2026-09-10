// Parsinegar documents plugin: entry point wiring prepare/activate.
import { SERVICE_NAME, STORAGE_SERVICE, createService } from './lib/documents-service.js';

const state = { storage: null, events: null };

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
  return [{ name: SERVICE_NAME, object: createService(state) }];
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
