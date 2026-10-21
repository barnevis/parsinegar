// Helpers shared by git-family backends (GitHub Contents, GitLab files).
// Transport, endpoints and error naming stay per-adapter; only the content
// codec, the commit-message resolution and the request timeout live here.

// Sanctioned/blackholed networks hang instead of refusing: without a
// deadline the UI stalls forever with zero feedback. t.mock.timers drives
// this timer in tests; real clocks everywhere else.
export const REQUEST_TIMEOUT_MS = 30000;

/**
 * Resolves the commit text for one write or delete: an explicit message
 * from the run wins, otherwise the automatic per-path default.
 * @param {object|null} options Run options.
 * @param {string} fallback Automatic message (`pey.sync write|delete ${path}`).
 * @returns {string} Commit message.
 */
export function commitMessageOf(options, fallback) {
  const text = typeof options?.message === 'string' ? options.message.trim() : '';
  return text.length > 0 ? text : fallback;
}

/**
 * Encodes text to base64 without blowing the stack on long files.
 * @param {string} content UTF-8 text.
 * @returns {string} Base64.
 */
export function encodeContent(content) {
  const bytes = new TextEncoder().encode(content);
  let binary = '';
  const CHUNK = 8192;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

/**
 * Decodes base64 file content to text (providers wrap lines).
 * @param {string} content Base64 payload.
 * @returns {string} UTF-8 text.
 */
export function decodeContent(content) {
  const cleaned = String(content ?? '').replace(/\s/g, '');
  const bytes = Uint8Array.from(atob(cleaned), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
