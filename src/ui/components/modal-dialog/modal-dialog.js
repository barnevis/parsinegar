// Modal dialog element: delete confirmation, document properties, sync
// conflict choices and the sync commit-message prompt.
//
// Pure display driven entirely by configure(); the markup renderers live in
// `workbench/modal.js` and stay unit-tested there. User gestures leave only
// as bubbled CustomEvents: `modal-confirm` with `{ accepted }` for the
// yes/no buttons, `modal-dismiss` for the properties close/message-cancel
// buttons and backdrop clicks, `sync-message-send` with the typed text,
// `sync-resolve`/`sync-later` for the conflict choice. Escape stays with the
// owning page (global keydown).
import { PeyElement } from 'pey.webui/base/pey-element';
import { renderConfirmModal, renderPropertiesModal, renderSyncConflictModal, renderSyncMessageModal } from '../workbench/modal.js';

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
   * @param {object|null} [data.modal] `{ kind: 'confirm', title }`, `{ kind: 'confirm-folder', title, count }`, `{ kind: 'sync-conflict', conflict }`, `{ kind: 'sync-message' }` or the formatted properties snapshot, or null when closed.
   * @returns {void}
   */
  configure({ modal } = {}) {
    this.#modal = modal ?? null;
    this.requestRender();
  }

  eventTypes() {
    return ['click', 'input'];
  }

  handleEvent(event) {
    if (event.type === 'input') {
      const input = event.target?.closest?.('[data-sync-message-input]');
      if (input) {
        const text = String(input.value ?? '').trim();
        this.shadowRoot?.querySelector('[data-sync-message-send]')?.toggleAttribute('disabled', text.length === 0);
      }
      return;
    }
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
    const sendButton = target?.closest?.('[data-sync-message-send]');
    if (sendButton && sendButton.disabled === false) {
      const text = String(this.shadowRoot?.querySelector('[data-sync-message-input]')?.value ?? '').trim();
      this.dispatchEvent(new CustomEvent('sync-message-send', { bubbles: true, composed: true, detail: { message: text } }));
      return;
    }
    if (target?.closest?.('[data-sync-message-cancel]')) {
      this.dispatchEvent(new CustomEvent('modal-dismiss', { bubbles: true, composed: true }));
      return;
    }
    const resolveButton = target?.closest?.('[data-sync-resolve]');
    if (resolveButton) {
      this.dispatchEvent(
        new CustomEvent('sync-resolve', {
          bubbles: true,
          composed: true,
          detail: {
            collection: resolveButton.getAttribute('data-sync-collection') ?? '',
            id: resolveButton.getAttribute('data-sync-id') ?? '',
            choice: resolveButton.getAttribute('data-sync-resolve') === 'remote' ? 'remote' : 'local',
          },
        }),
      );
      return;
    }
    if (target?.closest?.('[data-sync-later]')) {
      this.dispatchEvent(new CustomEvent('sync-later', { bubbles: true, composed: true, detail: {} }));
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
    if (this.#modal?.kind === 'confirm-folder') {
      return renderConfirmModal({
        t: this.#t,
        title: this.#modal.title,
        assetBaseUrl: this.#assetBaseUrl,
        headingKey: 'parsinegar.folders.delete',
        messageKey: 'parsinegar.folders.delete-confirm',
        messageParams: { count: this.#modal.count ?? 0 },
      });
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
    if (this.#modal?.kind === 'sync-message') {
      return renderSyncMessageModal({ t: this.#t, assetBaseUrl: this.#assetBaseUrl });
    }
    if (this.#modal?.kind === 'sync-conflict') {
      return renderSyncConflictModal({
        t: this.#t,
        conflict: this.#modal.conflict ?? null,
        assetBaseUrl: this.#assetBaseUrl,
      });
    }
    return '';
  }
}

customElements.define(TAG, ParsiModalDialog);

export { ParsiModalDialog, TAG };
