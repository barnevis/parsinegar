// Pey filesystem plugin: entry point wiring prepare/activate.
import { SERVICE_NAME, createService } from './lib/filesystem-service.js';

const state = { events: null };

/**
 * Prepares the plugin: builds the service and registers lifecycle hooks.
 * The service is stateless (handles live with the caller), so shutdown
 * only releases the bus reference. No required dependencies exist, hence
 * no service-unavailable subscription.
 * @param {object} prepareContext Bonyan preparation context.
 * @returns {Promise<Array>} Service registration.
 */
export async function prepare(prepareContext) {
  state.events = prepareContext.events ?? null;
  prepareContext.onDeactivated = () => {
    state.events = null;
  };
  prepareContext.onShutdown = async () => {
    state.events = null;
  };
  return [{ name: SERVICE_NAME, object: createService(state) }];
}

/**
 * Activates the plugin: nothing to bind (no declared dependencies).
 * @param {Record<string, object>} services Bound declared dependencies.
 * @returns {Promise<void>}
 */
export async function activate(services) {
  void services;
}
