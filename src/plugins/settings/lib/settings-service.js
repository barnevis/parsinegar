// Settings service: validated user preferences over the storage service.
//
// Owns preference defaults and every validation rule for its domain; the UI
// never validates values itself, it only forwards them. A single record holds
// the whole preference set, so readers always get a complete object.
const STORAGE_SERVICE = 'pey.storage.service';
const SERVICE_NAME = 'parsinegar.settings.service';
const COLLECTION = 'settings';
const RECORD_ID = 'preferences';
const CHANGED_EVENT = 'settings:changed';

const THEMES = ['light', 'dark', 'device'];
const DIRECTIONS = ['auto', 'rtl', 'ltr'];
const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 24;

const DEFAULT_SETTINGS = { theme: 'device', direction: 'auto', fontSize: 16 };

/**
 * Builds a standard Bonyan boundary error.
 * @param {string} code Stable error code.
 * @param {string} message Log-safe message.
 * @param {object} [detail] Extra machine-readable detail.
 * @returns {Error} Structured error.
 */
function settingsError(code, message, detail = {}) {
  return Object.assign(new Error(message), {
    code,
    source: SERVICE_NAME,
    type: 'operational',
    timestamp: new Date().toISOString(),
    detail,
  });
}

/**
 * Returns the bound storage service or fails with a structured error.
 * @param {object} state Activation-bound references.
 * @returns {object} Bound pey.storage.service.
 * @throws {Error} Structured error when called before local activation.
 */
function requireStorage(state) {
  if (!state.storage) {
    throw settingsError(
      'SETTINGS_STORAGE_UNAVAILABLE',
      `Required service is unavailable: ${STORAGE_SERVICE}`,
      { service: STORAGE_SERVICE },
    );
  }
  return state.storage;
}

/**
 * Sanitizes one stored or incoming value per field, falling back per field.
 * @param {object} input Raw values.
 * @returns {object} Complete valid settings.
 */
function sanitizeSettings(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const fontSize = Number(source.fontSize);
  return {
    theme: THEMES.includes(source.theme) ? source.theme : DEFAULT_SETTINGS.theme,
    direction: DIRECTIONS.includes(source.direction) ? source.direction : DEFAULT_SETTINGS.direction,
    fontSize: Number.isInteger(fontSize) && fontSize >= FONT_SIZE_MIN && fontSize <= FONT_SIZE_MAX
      ? fontSize
      : DEFAULT_SETTINGS.fontSize,
  };
}

/**
 * Rejects a patch carrying known fields with invalid values. Unknown fields
 * are ignored so older readers tolerate newer writers.
 * @param {object} patch Incoming patch.
 * @throws {Error} Structured error naming the offending field.
 */
function validatePatch(patch) {
  const source = patch && typeof patch === 'object' ? patch : {};
  if ('theme' in source && !THEMES.includes(source.theme)) {
    throw settingsError('SETTINGS_INVALID_VALUE', `Invalid theme value: ${String(source.theme)}`, { field: 'theme' });
  }
  if ('direction' in source && !DIRECTIONS.includes(source.direction)) {
    throw settingsError('SETTINGS_INVALID_VALUE', `Invalid direction value: ${String(source.direction)}`, { field: 'direction' });
  }
  if ('fontSize' in source) {
    const fontSize = Number(source.fontSize);
    if (!Number.isInteger(fontSize) || fontSize < FONT_SIZE_MIN || fontSize > FONT_SIZE_MAX) {
      throw settingsError('SETTINGS_INVALID_VALUE', `Invalid fontSize value: ${String(source.fontSize)}`, { field: 'fontSize' });
    }
  }
}

/**
 * Builds the settings service closing over activation-bound references.
 * @param {object} state References bound in prepare/activate ({ storage, events }).
 * @returns {object} Service implementation.
 */
function createService(state) {
  const service = {
    async getSettings() {
      const stored = await requireStorage(state).read(COLLECTION, RECORD_ID);
      return sanitizeSettings(stored ?? {});
    },
    async saveSettings(patch = {}) {
      validatePatch(patch);
      const current = await service.getSettings();
      const next = sanitizeSettings({ ...current, ...(patch && typeof patch === 'object' ? patch : {}) });
      await requireStorage(state).write(COLLECTION, { id: RECORD_ID, ...next });
      state.events?.publish(CHANGED_EVENT, { id: RECORD_ID });
      return next;
    },
  };
  return service;
}

export {
  CHANGED_EVENT,
  COLLECTION,
  DEFAULT_SETTINGS,
  DIRECTIONS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  RECORD_ID,
  SERVICE_NAME,
  STORAGE_SERVICE,
  THEMES,
  createService,
};
