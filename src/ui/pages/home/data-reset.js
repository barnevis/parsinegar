// Data reset for the workbench page.
//
// Arms and runs the "wipe all data" flow: the settings view requests it,
// the page shows the confirm-wipe modal, and on confirmation the app
// service wipes every store in one transaction and the page reloads — a
// fresh boot is the only honest post-wipe state, and it re-seeds the
// welcome document like a fresh install.
export function createDataReset({
  getService = () => null,
  isConnected = () => true,
  reload = () => window.location.reload(),
} = {}) {
  let armed = false;

  /**
   * Arms the confirmation: the wipe modal shows on the next render and the
   * service stays untouched until the user confirms.
   * @returns {void}
   */
  function arm() {
    armed = true;
  }

  /**
   * Disarms the confirmation (cancel choice, backdrop, or Escape).
   * @returns {void}
   */
  function cancel() {
    armed = false;
  }

  /**
   * The pending wipe modal snapshot, or null when nothing is armed.
   * @returns {object|null} `{ kind: 'confirm-wipe' }` or null.
   */
  function modal() {
    return armed ? { kind: 'confirm-wipe' } : null;
  }

  /**
   * Runs the wipe against the app service and reloads the page on success.
   * A failed wipe (storage outage) keeps the page as it is: nothing was
   * deleted because the transaction is atomic, and the arm stays closed.
   * @returns {Promise<boolean>} True when the wipe ran and the reload fired.
   */
  async function confirm() {
    const service = getService();
    armed = false;
    if (!service || !isConnected()) {
      return false;
    }
    try {
      const outcome = await service.wipeAllData();
      if (outcome?.ok !== true) {
        return false;
      }
    } catch {
      // Atomic wipe: a rejection leaves every store untouched; the page
      // keeps its state instead of reloading into a half reset.
      return false;
    }
    reload();
    return true;
  }

  return { arm, cancel, modal, confirm };
}
