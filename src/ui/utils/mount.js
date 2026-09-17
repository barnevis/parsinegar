// Shared child-composition helpers for PeyElement parents.
//
// The kit gives neither a composition helper nor a post-render hook, so this
// module standardizes both in app land (see decisions §11): parents render an
// empty placeholder, schedule attachment after render, and mount children
// through mountComponent with re-entry reuse.

/**
 * Schedules a callback after the current render has landed in the shadow DOM.
 * Combines a microtask with requestAnimationFrame: the slot must sit in the
 * shadow DOM before it is queryable. Callers must guard inside the callback
 * (still connected, slot present) because render timing is not guaranteed.
 * @param {Function} callback Attachment work.
 * @returns {void}
 */
export function scheduleAttachments(callback) {
  if (typeof callback !== 'function') {
    throw new Error('scheduleAttachments requires a callback function');
  }
  queueMicrotask(() => {
    if (typeof globalThis.requestAnimationFrame === 'function') {
      globalThis.requestAnimationFrame(() => callback());
    } else {
      callback();
    }
  });
}

/**
 * Mounts a PeyElement child into a placeholder, or reuses the mounted child.
 * The child is always connected before DOM insertion (kit contract); on
 * re-entry the same instance is kept and only configured again, so later
 * parent renders never destroy child state or focus.
 * @param {object} options Mount options.
 * @param {ShadowRoot} options.shadowRoot Parent shadow root holding the slot.
 * @param {string} options.slot Selector of the placeholder element.
 * @param {string} options.tag Child custom-element tag.
 * @param {object} options.infrastructure Event Bus facade forwarded to the child.
 * @param {object} options.refs References forwarded to the child.
 * @param {Function} [options.configure] Called with the child on first mount
 *   and on every re-entry, before insertion on first mount.
 * @returns {HTMLElement} The mounted (or reused) child element.
 */
export function mountComponent({ shadowRoot, slot, tag, infrastructure, refs, configure }) {
  if (!shadowRoot || typeof shadowRoot.querySelector !== 'function') {
    throw new Error('mountComponent requires a shadowRoot with querySelector');
  }
  if (typeof slot !== 'string' || slot.length === 0) {
    throw new Error('mountComponent requires a non-empty slot selector');
  }
  if (typeof tag !== 'string' || tag.length === 0) {
    throw new Error('mountComponent requires a non-empty tag name');
  }
  if (!infrastructure || typeof infrastructure !== 'object') {
    throw new Error('mountComponent requires an infrastructure object');
  }
  if (!refs || typeof refs !== 'object') {
    throw new Error('mountComponent requires a refs object');
  }
  if (configure !== undefined && typeof configure !== 'function') {
    throw new Error('mountComponent requires configure to be a function');
  }
  const slotElement = shadowRoot.querySelector(slot);
  if (!slotElement) {
    throw new Error(`mountComponent placeholder not found: ${slot}`);
  }
  const existing = slotElement.querySelector(tag);
  if (existing) {
    if (configure) {
      configure(existing);
    }
    return existing;
  }
  const element = document.createElement(tag);
  if (typeof element.connect !== 'function') {
    throw new Error(`mountComponent tag is not a connectable element: ${tag}`);
  }
  element.connect({ infrastructure, refs });
  if (configure) {
    configure(element);
  }
  slotElement.append(element);
  return element;
}
