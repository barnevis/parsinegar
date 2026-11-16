// Parsinegar application plugin: owns the version-1 route catalog and the
// app-level data reset (the only operations that span every plugin's stores).
import { appCriticalError, appStartupError } from './lib/error.js';
import { SERVICE_NAME, createService } from './lib/app-service.js';

const ROUTER_SERVICE = 'pey.router.service';
const STORAGE_SERVICE = 'pey.storage.service';
const HOME_PATTERN = '/';
const NOT_FOUND_PATTERN = '/not-found';

const state = { storage: null };
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
  savedContext.reportCriticalError(appCriticalError(
    'REQUIRED_DEPENDENCY_LOST',
    `Required service ${STORAGE_SERVICE} is no longer available`,
    { service: STORAGE_SERVICE },
  ));
}

/**
 * Prepares the plugin: registers lifecycle hooks and builds the service.
 * Storage binds later in activate(); until then service calls fail
 * clearly instead of crashing.
 * @param {object} prepareContext Bonyan preparation context.
 * @returns {Promise<Array>} Service registration.
 */
export async function prepare(prepareContext) {
  state.storage = null;
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
 * Activates the plugin: registers owned route patterns with the router and
 * binds the storage dependency for the reset service. Registration is only
 * allowed during local activation, after binding.
 * @param {Record<string, object>} services Bound declared dependencies.
 * @returns {Promise<void>}
 */
export async function activate(services) {
  const router = services[ROUTER_SERVICE];
  if (!router) {
    throw new Error(`Required service is unavailable: ${ROUTER_SERVICE}`);
  }
  const storage = services[STORAGE_SERVICE];
  if (!storage) {
    throw appStartupError(
      'APP_STORAGE_UNAVAILABLE',
      `Required service is unavailable: ${STORAGE_SERVICE}`,
      { service: STORAGE_SERVICE },
    );
  }
  router.registerRoutes([HOME_PATTERN, NOT_FOUND_PATTERN]);
  state.storage = storage;
}
