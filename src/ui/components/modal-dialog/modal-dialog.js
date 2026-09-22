// Modal dialog element: delete confirmation and document properties.
//
// Pure display driven entirely by configure(); the markup renderers live in
// `workbench/modal.js` and stay unit-tested there. User gestures leave only
// as bubbled CustomEvents: `modal-confirm` with `{ accepted }` for the
// yes/no buttons, `modal-dismiss` for the properties close button and
// backdrop clicks. Escape stays with the owning page (global keydown).
import { PeyElement } from 'pey.webui/base/pey-element';
import { renderConfirmModal, renderPropertiesModal } from '../workbench/modal.js';

const TAG = 'parsi-modal-dialog';
const STYLE_URL = new URL('./modal-dialog.css', import.meta.url).href;

class ParsiModalDialog extends PeyElement {
  #t = (key) => key;
  #assetBaseUrl = null;
  #modal = null;

  onConnect(refs = {}) {
    if (typeof refs.t === 'function') {
      this.#t = refs.t;
    }
    if (typeof refs.assetBaseUrl === 'string' && refs.assetBaseUrl.length > 0) {
      this.#assetBaseUrl = refs.assetBaseUrl;
    }
  }

  /**
   * Declares the external stylesheet attached by the base class before the
   * first contentful render (preload-and-cache contract of the kit).
   * @returns {string} Absolute stylesheet URL.
   */
  stylesheetHref() {
    return STYLE_URL;
  }

  /**
   * Updates the pending overlay snapshot.
   * @param {object} data New data.
   * @param {object|null} [data.modal] `{ kind: 'confirm', title }` or the formatted properties snapshot, or null when closed.
   * @returns {void}
   */
  configure({ modal } = {}) {
    this.#modal = modal ?? null;
    this.requestRender();
  }

  eventTypes() {
    return ['click'];
  }

  handleEvent(event) {
    if (event.type !== 'click') {
      return;
    }
    const target = event.target;
    const confirmButton = target?.closest?.('[data-confirm-delete]');
    if (confirmButton) {
      this.dispatchEvent(
        new CustomEvent('modal-confirm', {
          bubbles: true,
          composed: true,
          detail: { accepted: confirmButton.getAttribute('data-confirm-delete') === 'yes' },
        }),
      );
      return;
    }
    if (target?.closest?.('[data-close-props]')) {
      this.dispatchEvent(new CustomEvent('modal-dismiss', { bubbles: true, composed: true }));
      return;
    }
    if (target?.closest?.('[part="modal-backdrop"]') && !target?.closest?.('[part="modal-dialog"]')) {
      this.dispatchEvent(new CustomEvent('modal-dismiss', { bubbles: true, composed: true }));
    }
  }

  render() {
    if (this.#modal?.kind === 'confirm') {
      return renderConfirmModal({ t: this.#t, title: this.#modal.title, assetBaseUrl: this.#assetBaseUrl });
    }
    if (this.#modal?.kind === 'properties') {
      return renderPropertiesModal({
        t: this.#t,
        title: this.#modal.title,
        createdText: this.#modal.createdText,
        updatedText: this.#modal.updatedText,
        sizeText: this.#modal.sizeText,
        assetBaseUrl: this.#assetBaseUrl,
      });
    }
    return '';
  }
}

customElements.define(TAG, ParsiModalDialog);

export { ParsiModalDialog, TAG };
