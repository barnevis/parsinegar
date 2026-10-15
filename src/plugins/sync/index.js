// Pey sync plugin: entry point wiring prepare/activate.
import { SERVICE_NAME, createService } from './lib/sync-service.js';

const STORAGE_SERVICE = 'pey.storage.service';

const state = { storage: null, events: null, fetchFn: globalThis.fetch };
let savedContext = null;

/**
 * Reports a critical error when the required storage service disappears
 * at runtime. Settlement already handles startup-time absence automatically.
 * @param {object} event Core event envelope.
 * @returns {void}
 */
function handleServiceUnavailable(event) {
  if (event?.data?.serviceName !== STORAGE_SERVICE || !savedContext) {
    return;
  }
  savedContext.reportCriticalError({
    code: 'REQUIRED_DEPENDENCY_LOST',
    message: `Required service ${STORAGE_SERVICE} is no longer available`,
    source: SERVICE_NAME,
    type: 'critical',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Prepares the plugin: builds the service and registers lifecycle hooks.
 * Storage binds later in activate(); until then service calls fail
 * clearly instead of crashing.
 * @param {object} prepareContext Bonyan preparation context.
 * @returns {Promise<Array>} Service registration.
 */
export async function prepare(prepareContext) {
  state.storage = null;
  state.events = prepareContext.events ?? null;
  savedContext = prepareContext;
  prepareContext.events?.subscribe('core:service-unavailable', handleServiceUnavailable);
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
