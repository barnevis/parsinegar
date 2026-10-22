// Disk folder import for the workbench page.
//
// Brings a local Markdown folder into the library: the File System Access
// directory picker first (Chromium), a hidden webkitdirectory input second
// (Firefox has no directory picker). Files read as text and handed to the
// document controller, which reuses the same-named browser folder and
// updates changed files in place. Unreadable files are skipped.
export function createDiskImport({
  getFilesystem = () => null,
  getDocs = () => null,
  getShadowRoot = () => null,
  isConnected = () => true,
  applyResult = () => {},
} = {}) {
  /**
   * Hands one collected folder to the document controller's import flow.
   * @param {string} rootName Reused/created folder name.
   * @param {Array<{name, path, content}>} files Read files.
   * @returns {Promise<void>}
   */
  async function deliver(rootName, files) {
    applyResult(await getDocs()?.importFolder({ rootName, files }));
  }

  /**
   * Opens the local folder import: the picker path when the browser offers
   * one, the fallback input otherwise.
   * @returns {Promise<void>}
   */
  async function openDiskFolder() {
    const filesystem = getFilesystem();
    if (!filesystem) {
      return;
    }
    if (typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function') {
      try {
        const picked = await filesystem.pickDirectory(window.showDirectoryPicker.bind(window));
        if (!isConnected() || !picked?.handle) {
          return;
        }
        const entries = await filesystem.listDirectory(picked.handle);
        if (!isConnected()) {
          return;
        }
        if (entries.length === 0) {
          console.error('[parsi-page-home] disk folder has no markdown files');
          return;
        }
        const files = [];
        for (const entry of entries) {
          try {
            files.push({ name: entry.name, path: entry.path, content: await filesystem.readEntry(entry) });
          } catch (error) {
            console.error('[parsi-page-home] disk file skipped');
          }
        }
        if (!isConnected() || files.length === 0) {
          return;
        }
        await deliver(picked.name, files);
      } catch (error) {
        console.error('[parsi-page-home] disk folder open failed');
      }
      return;
    }
    diskFallbackInput();
  }

  /**
   * Fallback folder input for browsers without a directory picker: the
   * File list carries relative paths, so files read straight into the
   * same folder-import flow as the picker path.
   * @returns {void}
   */
  function diskFallbackInput() {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      return;
    }
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.setAttribute('webkitdirectory', '');
    picker.style.display = 'none';
    getShadowRoot()?.append(picker);
    const cleanup = () => picker.remove();
    picker.addEventListener('cancel', cleanup, { once: true });
    picker.addEventListener('change', async () => {
      try {
        const listed = await getFilesystem()?.collectEntries([...(picker.files ?? [])]) ?? [];
        if (!isConnected()) {
          return;
        }
        if (listed.length === 0) {
          console.error('[parsi-page-home] disk fallback found no markdown files');
          return;
        }
        const files = [];
        for (const item of listed) {
          try {
            files.push({ name: item.name, path: item.path, content: await item.file.text() });
          } catch (error) {
            console.error('[parsi-page-home] disk file skipped');
          }
        }
        if (!isConnected() || files.length === 0) {
          return;
        }
        const root = listed[0].path.split('/')[0] ?? '';
        await deliver(root, files);
      } catch (error) {
        console.error('[parsi-page-home] disk fallback failed');
      } finally {
        cleanup();
      }
    }, { once: true });
    picker.click();
  }

  return { openDiskFolder };
}
