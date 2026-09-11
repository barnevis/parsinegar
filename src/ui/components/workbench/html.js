// Shared HTML helpers for workbench templates (pure, no DOM).
import { createIconMarkup } from 'pey.webui/base/icon-sprite';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/**
 * Escapes user content for safe template interpolation.
 * @param {string} value Raw text.
 * @returns {string} Escaped text.
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (character) => ESCAPES[character]);
}

/**
 * Builds an icon markup string, degrading to empty when no base is available.
 * @param {string|null} assetBaseUrl Resolved asset directory URL.
 * @param {string} symbol Icon symbol id.
 * @returns {string} Icon markup or ''.
 */
export function iconMarkup(assetBaseUrl, symbol) {
  if (typeof assetBaseUrl !== 'string' || assetBaseUrl.length === 0) {
    return '';
  }
  try {
    return createIconMarkup(assetBaseUrl, symbol);
  } catch {
    return '';
  }
}
