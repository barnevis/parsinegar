// Pey sync plugin: entry point wiring prepare/activate.
import { gitAdapterDescriptor } from './adapters/git-adapter.js';
import { gitlabAdapterDescriptor } from './adapters/gitlab-adapter.js';
import { syncCriticalError, syncStartupError } from './lib/error.js';
import { SERVICE_NAME, createService } from './lib/sync-service.js';

const STORAGE_SERVICE = 'pey.storage.service';

const state = { storage: null, events: null, fetchFn: globalThis.fetch, adapters: { git: gitAdapterDescriptor, gitlab: gitlabAdapterDescriptor } };
let savedContext = null;
let unsubscribeUnavailable = null;

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
  savedContext.reportCriticalError(syncCriticalError(
    'REQUIRED_DEPENDENCY_LOST',
    `Required service ${STORAGE_SERVICE} is no longer available`,
    { service: STORAGE_SERVICE },
  ));
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
  if (typeof unsubscribeUnavailable === 'function') {
    try {
      unsubscribeUnavailable();
    } catch {
      // Re-prepare after a failed subscribe is best effort.
    }
    unsubscribeUnavailable = null;
  }
  const subscribed = prepareContext.events?.subscribe('core:service-unavailable', handleServiceUnavailable);
  unsubscribeUnavailable = typeof subscribed === 'function' ? subscribed : null;
  prepareContext.onDeactivated = () => {
    state.storage = null;
  };
  prepareContext.onShutdown = async () => {
    if (typeof unsubscribeUnavailable === 'function') {
      try {
        unsubscribeUnavailable();
      } catch {
        // Shutdown unsubscribe is best effort.
      }
      unsubscribeUnavailable = null;
    }
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
    throw syncStartupError(
      'SYNC_STORAGE_UNAVAILABLE',
      `Required service is unavailable: ${STORAGE_SERVICE}`,
      { service: STORAGE_SERVICE },
    );
  }
  state.storage = storage;
}
