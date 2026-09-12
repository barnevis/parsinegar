// Confirm modal: centered delete-confirmation dialog markup.
//
// Pure render function owned by this module (same pattern as the view
// modules): a separate custom element is not possible because nested
// PeyElement children cannot be declaratively composed, so the owning page
// renders this markup and wires behavior through its own handlers.
// Takes explicit data, never services or DOM.
import { escapeHtml, iconMarkup } from './html.js';

/**
 * Renders the delete-confirmation modal, or '' when nothing is pending.
 * @param {object} options Render options.
 * @param {Function} options.t Translation function.
 * @param {string|null} options.title Document name, or null when closed.
 * @param {string|null} options.assetBaseUrl Resolved asset directory URL.
 * @returns {string} Modal markup or ''.
 */
export function renderConfirmModal({ t, title, assetBaseUrl }) {
  if (typeof title !== 'string' || title.length === 0) {
    return '';
  }
  const translate = typeof t === 'function' ? t : (key) => key;
  const icon = iconMarkup(assetBaseUrl, 'trash');
  return `
    <div part="modal-backdrop">
      <div part="modal-dialog" role="alertdialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-desc">
        <div part="modal-icon" aria-hidden="true">${icon}</div>
        <h2 part="modal-title" id="modal-title">${escapeHtml(translate('parsinegar.documents.delete'))}</h2>
        <p part="modal-desc" id="modal-desc">${escapeHtml(translate('parsinegar.documents.delete-confirm', { title }))}</p>
        <div part="modal-actions">
          <button type="button" part="modal-cancel" data-confirm-delete="no">${escapeHtml(translate('parsinegar.documents.delete-no'))}</button>
          <button type="button" part="modal-confirm" data-confirm-delete="yes">${escapeHtml(translate('parsinegar.documents.delete-yes'))}</button>
        </div>
      </div>
    </div>`;
}
