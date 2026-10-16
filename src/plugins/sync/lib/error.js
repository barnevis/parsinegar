// Standard Bonyan error shapes for the pey.sync plugin.
//
// Plain objects (never Error instances) with code/message/source/type/
// timestamp/detail, mirroring the Pey family convention so cross-plugin
// validators accept them. Converts internal failures into the contract;
// sensitive values (tokens, file contents) must never reach message or
// detail — callers pass only safe metadata.

const SERVICE_NAME = 'pey.sync.service';

/**
 * Stamps the shared envelope fields.
 * @param {string} type operational, startup or critical.
 * @returns {object} Envelope fields.
 */
function envelope(type) {
  return {
    source: SERVICE_NAME,
    type,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Builds a standard Bonyan operational error.
 * @param {string} code Machine-readable code (SYNC_*).
 * @param {string} message Log-safe human-readable description.
 * @param {object|null} [detail] Extra machine-readable detail, secrets-free.
 * @returns {object} Structured error.
 */
export function syncError(code, message, detail = null) {
  return {
    code,
    message,
    ...envelope('operational'),
    detail,
  };
}

/**
 * Builds a standard Bonyan startup error (prepare/activate failures).
 * @param {string} code Machine-readable code (SYNC_*).
 * @param {string} message Log-safe human-readable description.
 * @param {object|null} [detail] Extra machine-readable detail, secrets-free.
 * @returns {object} Structured error.
 */
export function syncStartupError(code, message, detail = null) {
  return {
    code,
    message,
    ...envelope('startup'),
    detail,
  };
}

/**
 * Builds a standard Bonyan critical error (required dependency lost).
 * @param {string} code Machine-readable code.
 * @param {string} message Log-safe human-readable description.
 * @param {object|null} [detail] Extra machine-readable detail, secrets-free.
 * @returns {object} Structured error.
 */
export function syncCriticalError(code, message, detail = null) {
  return {
    code,
    message,
    ...envelope('critical'),
    detail,
  };
}
