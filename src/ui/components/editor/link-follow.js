// Follows Markdown links on modifier-click (live preview).
//
// Link labels render as plain text (the URL stays hidden until reveal), so
// plain clicks keep placing the cursor for editing. Ctrl/Cmd+click — or a
// middle-click — on a link label opens its http(s) target in a new tab,
// mirroring editor conventions (VS Code included). Linked pictures already
// navigate natively through their anchor and are left alone here.
import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';

const REMOTE_PATTERN = /^https?:\/\//i;

/**
 * Reads the href of the Link node enclosing the position, if any. Biases
 * forward at boundaries: a click on the opening bracket still belongs to
 * the link behind it.
 * @param {object} state Editor state.
 * @param {number} pos Document position.
 * @returns {string} Remote href, or '' when the position sits on no
 *   http(s) link.
 */
export function linkHrefAt(state, pos) {
  if (typeof pos !== 'number' || pos < 0 || pos > state.doc.length) {
    return '';
  }
  let node = syntaxTree(state).resolveInner(pos, 1).node;
  while (node) {
    if (node.name === 'Link') {
      break;
    }
    node = node.parent;
  }
  if (!node) {
    return '';
  }
  let href = '';
  let child = node.firstChild;
  while (child) {
    if (child.name === 'URL') {
      href = state.doc.sliceString(child.from, child.to);
    }
    child = child.nextSibling;
  }
  return REMOTE_PATTERN.test(href) ? href : '';
}

/**
 * Opens the URL in a new tab, degrading silently where popups or windows
 * are unavailable (tests, locked-down embeds).
 * @param {string} href Remote URL.
 * @returns {void}
 */
function openExternally(href) {
  try {
    if (typeof window === 'undefined' || typeof window.open !== 'function') {
      return;
    }
    window.open(href, '_blank', 'noopener');
  } catch {
    // Popups blocked or no window — reading continues undisturbed.
  }
}

/**
 * Returns the click-to-follow extensions for the editor.
 * @returns {Array} Click handler extension.
 */
export function linkFollowExtensions() {
  return [
    EditorView.domEventHandlers({
      click(event, view) {
        const following = event.ctrlKey || event.metaKey || event.button === 1;
        if (!following) {
          return false;
        }
        // Linked pictures navigate through their own anchor already.
        if (event.target?.closest?.('a[href]')) {
          return false;
        }
        // Coordinates need layout; fall back to the event target, which
        // also covers layout-less runtimes (tests).
        let pos = null;
        try {
          pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        } catch {
          pos = null;
        }
        if (typeof pos !== 'number' && event.target instanceof Node) {
          try {
            pos = view.posAtDOM(event.target);
          } catch {
            pos = null;
          }
        }
        if (typeof pos !== 'number') {
          return false;
        }
        const href = linkHrefAt(view.state, pos);
        if (!href) {
          return false;
        }
        event.preventDefault();
        openExternally(href);
        return true;
      },
    }),
  ];
}
