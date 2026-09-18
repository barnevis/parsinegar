// Confirm and properties modals: centered dialog markup.
//
// Pure render functions owned by this module (same pattern as the view
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

/**
 * Renders the document properties modal, or '' when nothing is pending.
 * All values arrive preformatted; this function only escapes and places.
 * @param {object} options Render options.
 * @param {Function} options.t Translation function.
 * @param {string|null} options.title Document name, or null when closed.
 * @param {string} options.createdText Formatted creation date.
 * @param {string} options.updatedText Formatted last-edit date.
 * @param {string} options.sizeText Formatted byte size.
 * @param {string|null} options.assetBaseUrl Resolved asset directory URL.
 * @returns {string} Modal markup or ''.
 */
export function renderPropertiesModal({ t, title, createdText, updatedText, sizeText, assetBaseUrl }) {
  if (typeof title !== 'string' || title.length === 0) {
    return '';
  }
  const translate = typeof t === 'function' ? t : (key) => key;
  const icon = iconMarkup(assetBaseUrl, 'files');
  const row = (labelKey, value) => `
          <div part="modal-row">
            <dt part="modal-term">${escapeHtml(translate(labelKey))}</dt>
            <dd part="modal-value">${escapeHtml(value)}</dd>
          </div>`;
  return `
    <div part="modal-backdrop">
      <div part="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div part="modal-icon" aria-hidden="true">${icon}</div>
        <h2 part="modal-title" id="modal-title">${escapeHtml(translate('parsinegar.documents.properties'))}</h2>
        <dl part="modal-list">
          <div part="modal-row">
            <dt part="modal-term">${escapeHtml(translate('parsinegar.documents.property-name'))}</dt>
            <dd part="modal-value">${escapeHtml(title)}</dd>
          </div>${row('parsinegar.documents.property-created', createdText)}${row('parsinegar.documents.property-updated', updatedText)}${row('parsinegar.documents.property-size', sizeText)}
        </dl>
        <div part="modal-actions">
          <button type="button" part="modal-cancel" data-close-props="yes">${escapeHtml(translate('parsinegar.documents.close'))}</button>
        </div>
      </div>
    </div>`;
}
