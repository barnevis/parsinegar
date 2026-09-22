// Settings application for the workbench page.
//
// Owns the preferences snapshot and the applied editor traits (document
// direction, font size): loading them at boot and persisting radio/step
// changes through the settings service. Rapid writes serialize through a
// chain so back-to-back changes apply in order instead of racing on stale
// reads. Answers with plain outcomes; the page remounts the editor on
// `applied` and never lets service details leak into chrome code. Theme
// itself reaches the shell through the `settings:changed` domain event
// handled by the entry point, not through here.
export function createSettingsApplier({
  settingsApi = null,
  isLive = () => true,
} = {}) {
  let api = settingsApi;
  let settings = null;
  let direction = 'rtl';
  let fontSize = 16;
  let writeChain = Promise.resolve();
  let colorQuery = null;
  let colorHandler = null;

  function chainWrite(task) {
    const run = writeChain.then(task, task);
    writeChain = run.catch(() => {});
    return run;
  }

  const applier = {
    /**
     * Rebinds the settings service, keeping the applied snapshot.
     * @param {object} [options] Replacement dependencies.
     * @returns {void}
     */
    reconnect({ settingsApi: nextApi } = {}) {
      if (nextApi !== undefined) {
        api = nextApi;
      }
    },

    /**
     * Returns the applied snapshot for chrome and editor options.
     * @returns {object} `{ settings, direction, fontSize }`.
     */
    getState() {
      return { settings, direction, fontSize };
    },

    /**
     * Loads stored preferences before the first editor mount. A failed load
     * keeps the built-in fallbacks and never blocks documents.
     * @returns {Promise<boolean>} True when preferences loaded.
     */
    async load() {
      if (!api) {
        return false;
      }
      try {
        const saved = await api.getSettings();
        if (!isLive()) {
          return false;
        }
        settings = saved;
        direction = saved.direction;
        fontSize = saved.fontSize;
        return true;
      } catch (error) {
        console.error('[parsi-settings-applier] settings load failed');
        return false;
      }
    },

    /**
     * Persists one radio-group setting (theme or direction).
     * @param {unknown} key Setting key from the event detail.
     * @param {unknown} value Setting value from the event detail.
     * @returns {Promise<string>} 'applied', 'ignored' or 'failed'.
     */
    async applyChange(key, value) {
      if (!api || (key !== 'theme' && key !== 'direction')) {
        return 'ignored';
      }
      if (typeof value !== 'string' || value.length === 0) {
        return 'ignored';
      }
      try {
        return await chainWrite(async () => {
          const saved = await api.saveSettings({ [key]: value });
          if (!isLive()) {
            return 'failed';
          }
          settings = saved;
          direction = saved.direction;
          fontSize = saved.fontSize;
          return 'applied';
        });
      } catch (error) {
        console.error('[parsi-settings-applier] setting save failed');
        return 'failed';
      }
    },

    /**
     * Persists one font-size step. Out-of-range steps reject in the service
     * and leave everything unchanged.
     * @param {unknown} key Setting key from the event detail.
     * @param {unknown} delta Step delta from the event detail.
     * @returns {Promise<string>} 'applied', 'ignored' or 'failed'.
     */
    async applyStep(key, delta) {
      if (!api || key !== 'fontSize') {
        return 'ignored';
      }
      const step = Number(delta);
      if (step !== 1 && step !== -1) {
        return 'ignored';
      }
      try {
        return await chainWrite(async () => {
          const saved = await api.saveSettings({ fontSize: fontSize + step });
          if (!isLive()) {
            return 'failed';
          }
          settings = saved;
          direction = saved.direction;
          fontSize = saved.fontSize;
          return 'applied';
        });
      } catch (error) {
        console.error('[parsi-settings-applier] setting save failed');
        return 'failed';
      }
    },
    /**
     * Starts watching the operating-system color scheme so a `device` theme
     * flips the editor when the system changes between light and dark.
     * @param {Function} onFlip Called on system flips while the theme is `device`.
     * @returns {void}
     */
    watchColorScheme(onFlip) {
      if (colorQuery || typeof globalThis.matchMedia !== 'function') {
        return;
      }
      try {
        colorQuery = globalThis.matchMedia('(prefers-color-scheme: dark)');
        colorHandler = () => {
          if (settings?.theme === 'device') {
            onFlip();
          }
        };
        colorQuery.addEventListener('change', colorHandler);
      } catch {
        colorQuery = null;
        colorHandler = null;
      }
    },

    /**
     * Stops watching the operating-system color scheme (best-effort).
     * @returns {void}
     */
    unwatchColorScheme() {
      try {
        if (colorQuery && colorHandler) {
          colorQuery.removeEventListener('change', colorHandler);
        }
      } catch {
        // Listener removal is best-effort during teardown.
      }
      colorQuery = null;
      colorHandler = null;
    },
  };

  return applier;
}
