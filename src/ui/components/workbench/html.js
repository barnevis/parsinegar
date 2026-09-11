// Shared HTML helpers for workbench templates (pure, no DOM).
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/**
 * Escapes user content for safe template interpolation.
 * @param {string} value Raw text.
 * @returns {string} Escaped text.
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (character) => ESCAPES[character]);
}
