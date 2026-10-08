// Pey filesystem service: user-device file access behind injected pickers.
//
// The plugin never touches the DOM: directory/file pickers are supplied by
// the caller (the environment owns the user gesture), and entries carry
// either a File System Access handle or a plain File. Capability flags tell
// the caller which path is available so it can fall back (e.g. to a
// webkitdirectory input or a download) without probing globals itself.
export const SERVICE_NAME = 'pey.filesystem.service';

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.txt'];

/**
 * Builds a structured Bonyan operational error.
 * @param {string} code Stable error code.
 * @param {string} message Log-safe message.
 * @param {object} [detail] Extra machine-readable detail.
 * @returns {Error} Structured error.
 */
function filesystemError(code, message, detail = {}) {
  return Object.assign(new Error(message), {
    code,
    source: SERVICE_NAME,
    type: 'operational',
    timestamp: new Date().toISOString(),
    detail,
  });
}

/**
 * Checks whether a filename is a readable Markdown document.
 * @param {unknown} name Filename to check.
 * @returns {boolean} True for .md/.markdown/.mdown/.txt (case-insensitive).
 */
export function isMarkdownName(name) {
  if (typeof name !== 'string') {
    return false;
  }
  const lower = name.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Strips a leading byte-order mark from file text.
 * @param {string} text Raw file text.
 * @returns {string} Text without BOM.
 */
function stripBom(text) {
  return typeof text === 'string' ? text.replace(/^\uFEFF/, '') : '';
}

/**
 * Returns true when a picker was aborted by the user (cancel), as opposed
 * to a real failure.
 * @param {unknown} error Caught error.
 * @returns {boolean} True for user cancellation.
 */
function isAbort(error) {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Runs the handle permission round-trip: granted stays silent, otherwise
 * one request goes out and anything but granted counts as denied.
 * @param {object} handle File System Access handle.
 * @param {string} mode 'read' or 'readwrite'.
 * @returns {Promise<boolean>} True when the operation may proceed.
 */
async function ensurePermission(handle, mode) {
  const queried = await handle.queryPermission?.({ mode }).catch(() => undefined);
  if (queried === 'granted') {
    return true;
  }
  const requested = await handle.requestPermission?.({ mode }).catch(() => undefined);
  return requested === 'granted';
}

/**
 * Creates the filesystem service. Stateless across calls: handles and
 * permissions live with the caller, so deactivation needs no guard.
 * @param {object} state Plugin state (events bus holder).
 * @returns {object} Service implementation.
 */
export function createService(state) {
  void state;
  return {
    /**
     * Reports which environment pickers exist and whether picked entries
     * can be written back (only handle-backed entries can).
     * @returns {Promise<object>} `{ directoryPicker, filePicker, writable }`.
     */
    async getCapabilities() {
      const scope = globalThis ?? {};
      const directoryPicker = typeof scope.showDirectoryPicker === 'function';
      const filePicker = typeof scope.showOpenFilePicker === 'function';
      return { directoryPicker, filePicker, writable: directoryPicker || filePicker };
    },

    /**
     * Opens the injected directory picker; null when unavailable/cancelled.
     * @param {Function|null} picker Environment directory picker or null.
     * @returns {Promise<object|null>} `{ name, path, handle }` or null.
     */
    async pickDirectory(picker) {
      if (typeof picker !== 'function') {
        return null;
      }
      try {
        const handle = await picker();
        return { name: handle?.name ?? '', path: handle?.name ?? '', handle };
      } catch (error) {
        if (isAbort(error)) {
          return null;
        }
        throw filesystemError('FILESYSTEM_PICK_FAILED', 'Directory picker failed');
      }
    },

    /**
     * Opens the injected file picker; null when unavailable/cancelled.
     * @param {Function|null} picker Environment file picker or null.
     * @returns {Promise<object|null>} `{ name, path, handle }` or null.
     */
    async pickFile(picker) {
      if (typeof picker !== 'function') {
        return null;
      }
      try {
        const picked = await picker();
        const handle = Array.isArray(picked) ? picked[0] ?? null : picked;
        if (!handle) {
          return null;
        }
        return { name: handle?.name ?? '', path: handle?.name ?? '', handle };
      } catch (error) {
        if (isAbort(error)) {
          return null;
        }
        throw filesystemError('FILESYSTEM_PICK_FAILED', 'File picker failed');
      }
    },

    /**
     * Walks a directory handle recursively, returning every Markdown file
     * as a flat entry with its relative path and own file handle.
     * @param {object} handle Directory handle to walk.
     * @returns {Promise<Array>} `{ name, path, handle }` entries.
     */
    async listDirectory(handle) {
      const entries = [];
      try {
        const walk = async (directory, prefix) => {
          for await (const child of directory.values()) {
            if (child?.kind === 'file') {
              if (isMarkdownName(child?.name)) {
                entries.push({ name: child.name, path: prefix ? `${prefix}/${child.name}` : child.name, handle: child });
              }
            } else if (child?.kind === 'directory') {
              await walk(child, prefix ? `${prefix}/${child.name}` : child.name);
            }
          }
        };
        await walk(handle, '');
      } catch (error) {
        throw filesystemError('FILESYSTEM_READ_FAILED', 'Directory walk failed');
      }
      return entries;
    },

    /**
     * Filters a flat file list (e.g. from a webkitdirectory input) down to
     * Markdown entries, keeping each file for reading.
     * @param {Array} files Flat file list.
     * @returns {Promise<Array>} `{ name, path, file }` entries.
     */
    async collectEntries(files) {
      const list = Array.isArray(files) ? files : [];
      return list
        .filter((file) => file && isMarkdownName(file.name))
        .map((file) => ({
          name: file.name,
          path: typeof file.webkitRelativePath === 'string' && file.webkitRelativePath.length > 0
            ? file.webkitRelativePath
            : file.name,
          file,
        }));
    },

    /**
     * Reads entry text through its handle (read-permission round-trip) or
     * its plain file.
     * @param {object} entry `{ name, path, handle?, file? }`.
     * @returns {Promise<string>} File text without BOM.
     */
    async readEntry(entry) {
      try {
        if (entry?.file && typeof entry.file.text === 'function') {
          return stripBom(await entry.file.text());
        }
        if (entry?.handle && typeof entry.handle.getFile === 'function') {
          if (!await ensurePermission(entry.handle, 'read')) {
            throw filesystemError('FILESYSTEM_PERMISSION_DENIED', 'Read permission denied');
          }
          return stripBom(await entry.handle.getFile().then((file) => file.text()));
        }
      } catch (error) {
        if (error?.code === 'FILESYSTEM_PERMISSION_DENIED') {
          throw error;
        }
        throw filesystemError('FILESYSTEM_READ_FAILED', 'Entry read failed');
      }
      throw filesystemError('FILESYSTEM_READ_FAILED', 'Entry has nothing readable');
    },

    /**
     * Writes content through the entry handle (readwrite-permission
     * round-trip). Null when the entry has no writable handle — the caller
     * falls back (e.g. to a download) instead of failing.
     * @param {object} entry `{ name, path, handle? }`.
     * @param {string} content Text to write.
     * @returns {Promise<object|null>} `{ name, path }` or null.
     */
    async writeEntry(entry, content) {
      if (typeof content !== 'string') {
        throw filesystemError('FILESYSTEM_WRITE_FAILED', 'Entry content must be text');
      }
      if (!entry?.handle || typeof entry.handle.createWritable !== 'function') {
        return null;
      }
      try {
        if (!await ensurePermission(entry.handle, 'readwrite')) {
          throw filesystemError('FILESYSTEM_PERMISSION_DENIED', 'Write permission denied');
        }
        const writable = await entry.handle.createWritable();
        try {
          await writable.write(content);
        } finally {
          await writable.close().catch(() => {});
        }
        return { name: entry.name, path: entry.path };
      } catch (error) {
        if (error?.code === 'FILESYSTEM_PERMISSION_DENIED') {
          throw error;
        }
        throw filesystemError('FILESYSTEM_WRITE_FAILED', 'Entry write failed');
      }
    },
  };
}
