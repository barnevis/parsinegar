// Creates a CodeMirror Markdown view inside a host element.
//
// This is a plain controller factory, not a custom element: a PeyElement child
// cannot be nested declaratively (connect-before-insertion plus the
// render-cycle rule forbid it), so the owning page renders the host node in
// its template and mounts the third-party view here. CodeMirror owns its own
// listeners until destroy() releases them.
import { EditorView, minimalSetup } from 'codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { redo, selectAll, undo } from '@codemirror/commands';
import { EditorSelection } from '@codemirror/state';
import { livePreviewExtensions } from './live-preview.js';
import { taskListExtensions } from './task-list.js';
import { textHighlightExtensions } from './text-highlight.js';

const PERSIAN_FONT = "'Vazirmatn', Tahoma, sans-serif";

/**
 * Matches the select-all gesture on any keyboard layout. Shortcut matching in
 * CodeMirror and in browsers is based on `event.key`, which follows the active
 * layout (e.g. `ش` instead of `a` on a Persian layout), so the physical key
 * position (`event.code`) is checked instead.
 * @param {KeyboardEvent} event Keydown event.
 * @returns {boolean} True for Ctrl/⌘+A without other modifiers.
 */
function isSelectAllEvent(event) {
  return event.code === 'KeyA'
    && (event.ctrlKey || event.metaKey)
    && !event.altKey
    && !event.shiftKey;
}

/**
 * Creates a right-to-left Markdown editing view in the given host element.
 * @param {HTMLElement} host Container rendered by the owning component.
 * @param {object} [options] View options.
 * @param {string} [options.document] Initial Markdown text.
 * @param {string} [options.label] Accessible label for the editor.
 * @param {string} [options.direction] Writing direction: 'rtl' (default) or 'ltr'.
 * @param {Function} [options.onChange] Called with the new text on every edit.
 * @returns {object} Controller with getValue(), setDocument(text),
 *   focus(), undo(), redo(), gotoLine(line), destroy().
 * @throws {Error} When host is not an element.
 */
export function createMarkdownView(host, options = {}) {
  const isElement = host !== null && typeof host === 'object' && typeof host.appendChild === 'function';
  if (!isElement) {
    throw new Error('createMarkdownView requires an element host');
  }
  const onChange = typeof options.onChange === 'function' ? options.onChange : null;
  const direction = options.direction === 'ltr' ? 'ltr' : 'rtl';
  let current = typeof options.document === 'string' ? options.document : '';
  let destroyed = false;

  const view = new EditorView({
    parent: host,
    doc: current,
    extensions: [
      minimalSetup,
      markdown({ base: markdownLanguage }),
      EditorView.lineWrapping,
      ...livePreviewExtensions(),
      ...taskListExtensions(),
      ...textHighlightExtensions(),
      EditorView.domEventHandlers({
        keydown(event, editorView) {
          if (isSelectAllEvent(event)) {
            event.preventDefault();
            selectAll(editorView);
            return true;
          }
          return false;
        },
      }),
      EditorView.editorAttributes.of({ dir: direction, 'aria-label': options.label ?? '' }),
      EditorView.theme({
        '&': {
          direction,
          textAlign: 'start',
          fontFamily: PERSIAN_FONT,
          fontSize: '1rem',
        },
        '& .cm-scroller': {
          fontFamily: PERSIAN_FONT,
        },
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || destroyed) {
          return;
        }
        current = update.state.doc.toString();
        onChange?.(current);
      }),
    ],
  });

  return {
    /**
     * Returns the current Markdown text.
     * @returns {string} Current document content.
     */
    getValue() {
      if (!destroyed) {
        current = view.state.doc.toString();
      }
      return current;
    },
    /**
     * Replaces the editor content.
     * @param {string} text New Markdown text.
     * @returns {void}
     */
    setDocument(text) {
      if (typeof text !== 'string' || destroyed) {
        return;
      }
      current = text;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    },
    /**
     * Moves keyboard focus into the editor. No-op after destroy.
     * @returns {void}
     */
    focus() {
      if (!destroyed) {
        view.focus();
      }
    },
    /**
     * Undoes the last change. No-op after destroy or with empty history.
     * @returns {void}
     */
    undo() {
      if (!destroyed) {
        undo(view);
      }
    },
    /**
     * Redoes the last undone change. No-op after destroy or with empty future.
     * @returns {void}
     */
    redo() {
      if (!destroyed) {
        redo(view);
      }
    },
    /**
     * Moves the cursor to the start of the given 1-based line and focuses.
     * Out-of-range lines clamp to the document. No-op after destroy.
     * @param {number} line 1-based line number.
     * @returns {void}
     */
    gotoLine(line) {
      if (destroyed) {
        return;
      }
      const total = view.state.doc.lines;
      const safe = Math.min(Math.max(1, Math.trunc(line) || 1), total);
      view.focus();
      view.dispatch({
        selection: EditorSelection.cursor(view.state.doc.line(safe).from),
        scrollIntoView: true,
      });
    },
    /**
     * Destroys the view and releases its listeners. Keeps the last text.
     * @returns {void}
     */
    destroy() {
      if (destroyed) {
        return;
      }
      current = view.state.doc.toString();
      destroyed = true;
      view.destroy();
    },
  };
}
