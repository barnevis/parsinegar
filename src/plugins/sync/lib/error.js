// Standard Bonyan error mapping for the pey.sync plugin.
// Converts internal failures into the standard error structure. Sensitive
// values (tokens, file contents) must never reach message or detail —
// callers pass only safe metadata.

const SERVICE_NAME = 'pey.sync';

/**
 * Builds a standard Bonyan operational error.
 * @param {string} code Machine-readable code (SYNC_*).
 * @param {string} message Log-safe human-readable description.
 * @param {object} [detail] Extra machine-readable detail, secrets-free.
 * @returns {object} Structured error.
 */
export function syncError(code, message, detail = {}) {
  return Object.assign(new Error(message), {
    code,
    source: SERVICE_NAME,
    type: 'operational',
    timestamp: new Date().toISOString(),
    detail,
  });
}
