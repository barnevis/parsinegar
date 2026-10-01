// Parsinegar export plugin: entry point wiring prepare/activate.
import { MARKDOWN_SERVICE, SERVICE_NAME, createService } from './lib/export-service.js';

const state = { markdown: null, events: null };
let savedContext = null;

/**
 * Reports a critical error when the required Markdown service disappears at
 * runtime. Settlement already handles startup-time absence automatically.
 * @param {object} event Core event envelope.
 * @returns {void}
 */
function handleServiceUnavailable(event) {
  if (event?.data?.serviceName !== MARKDOWN_SERVICE || !savedContext) {
    return;
  }
  savedContext.reportCriticalError({
    code: 'REQUIRED_DEPENDENCY_LOST',
    message: `Required service ${MARKDOWN_SERVICE} is no longer available`,
    source: SERVICE_NAME,
    type: 'critical',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Prepares the plugin: builds the service and registers lifecycle hooks.
 * @param {object} prepareContext Bonyan preparation context.
 * @returns {Promise<Array>} Service registration.
 */
export async function prepare(prepareContext) {
  state.markdown = null;
  state.events = prepareContext.events ?? null;
  savedContext = prepareContext;
  prepareContext.events?.subscribe('core:service-unavailable', handleServiceUnavailable);
  prepareContext.onDeactivated = () => {
    state.markdown = null;
  };
  prepareContext.onShutdown = async () => {
    state.markdown = null;
  };
  return [{ name: SERVICE_NAME, object: createService(state) }];
}

/**
 * Activates the plugin: binds the Markdown dependency for service methods.
 * @param {Record<string, object>} services Bound declared dependencies.
 * @returns {Promise<void>}
 */
export async function activate(services) {
  const markdown = services[MARKDOWN_SERVICE];
  if (!markdown) {
    throw new Error(`Required service is unavailable: ${MARKDOWN_SERVICE}`);
  }
  state.markdown = markdown;
}
