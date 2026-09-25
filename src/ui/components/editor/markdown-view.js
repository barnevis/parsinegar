// Creates a CodeMirror Markdown view inside a host element.
//
// This is a plain controller factory, not a custom element: a PeyElement child
// cannot be nested declaratively (connect-before-insertion plus the
// render-cycle rule forbid it), so the owning page renders the host node in
// its template and mounts the third-party view here. CodeMirror owns its own
// listeners until destroy() releases them.
import { EditorView, minimalSetup } from 'codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { indentWithTab, redo, selectAll, undo } from '@codemirror/commands';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { keymap } from '@codemirror/view';
import { EditorSelection, Prec } from '@codemirror/state';
import { editorColorScheme } from './editor-theme.js';
import { codeCopyExtensions } from './code-copy.js';
import { codeHighlightExtensions, codeLanguageDescriptions } from './code-highlight.js';
import { lineDirectionExtensions } from './line-direction.js';
import { livePreviewExtensions } from './live-preview.js';
import { continueList } from './list-continue.js';
import { deletePair, pairInput } from './quote-pairs.js';
import { taskListExtensions } from './task-list.js';
import { textHighlightExtensions } from './text-highlight.js';
import { shortcutCommand, toggleBold, toggleCode, toggleHeading, toggleItalic, toggleOrderedList, toggleQuote, toggleStrikethrough, toggleUnorderedList, insertLink } from './toggle-mark.js';

const PERSIAN_FONT = "'Vazirmatn', Tahoma, sans-serif";
const DEFAULT_FONT_SIZE = 16;
const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 24;
const INSERT_COMMANDS = {
  heading: toggleHeading,
  bold: toggleBold,
  italic: toggleItalic,
  strikethrough: toggleStrikethrough,
  quote: toggleQuote,
  link: insertLink,
  code: toggleCode,
  'unordered-list': toggleUnorderedList,
  'ordered-list': toggleOrderedList,
};

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
 * @param {string} [options.direction] Writing direction: 'rtl' locks every line right (fenced code stays ltr), 'ltr' locks every line left, 'auto' detects per line from the first strong letter (default 'rtl'; letter-less lines take the rtl base so the caret stays right).
 * @param {number} [options.fontSize] Editor font size in pixels (12-24, default 16).
 * @param {string} [options.colorScheme] Editor colors: 'light' (default), 'dark' or 'sepia'.
 * @param {Function} [options.t] Translation function for widget labels (falls back to identity).
 * @param {string|null} [options.assetBaseUrl] Resolved asset directory URL for widget icons.
 * @param {Function} [options.onChange] Called with the new text on every edit.
 * @returns {object} Controller with getValue(), setDocument(text),
 *   focus(), undo(), redo(), gotoLine(line), visibleLine(),
 *   insertMark(kind), destroy().
 * @throws {Error} When host is not an element.
 */
export function createMarkdownView(host, options = {}) {
  const isElement = host !== null && typeof host === 'object' && typeof host.appendChild === 'function';
  if (!isElement) {
    throw new Error('createMarkdownView requires an element host');
  }
  const onChange = typeof options.onChange === 'function' ? options.onChange : null;
  const direction = options.direction === 'ltr' || options.direction === 'auto' ? options.direction : 'rtl';
  const fontSize = Number.isInteger(options.fontSize) && options.fontSize >= FONT_SIZE_MIN && options.fontSize <= FONT_SIZE_MAX
    ? options.fontSize
    : DEFAULT_FONT_SIZE;
  const baseDirection = direction === 'ltr' ? 'ltr' : 'rtl';
  // An explicit direction locks every line to it (fenced code stays ltr);
  // `auto` keeps per-line detection from the first strong letter.
  const forcedDirection = direction === 'auto' ? null : direction;
  let current = typeof options.document === 'string' ? options.document : '';
  let destroyed = false;

  const view = new EditorView({
    parent: host,
    doc: current,
    extensions: [
      minimalSetup,
      markdown({ base: markdownLanguage, codeLanguages: codeLanguageDescriptions }),
      EditorView.lineWrapping,
      ...livePreviewExtensions(),
      ...taskListExtensions(),
      ...textHighlightExtensions(),
      ...codeHighlightExtensions(),
      ...codeCopyExtensions({ t: options.t, assetBaseUrl: options.assetBaseUrl ?? null }),
      ...lineDirectionExtensions(baseDirection, forcedDirection),
      // Tab indents (Shift+Tab outdents); Alt+Arrow line moving already
      // arrives through the default keymap in minimalSetup.
      keymap.of([indentWithTab]),
      // Bracket pairing (`()[]{}`) plus pair-aware Backspace from the keymap.
      // Quotes and backticks pair through `quote-pairs.js` below instead:
      // closeBrackets only pairs same-character tokens inside string
      // contexts, which Markdown does not declare.
      closeBrackets(),
      keymap.of(closeBracketsKeymap),
      ...editorColorScheme(options.colorScheme),
      // High precedence so our layout-independent shortcuts win over
      // defaultKeymap bindings for the same gesture (e.g. Mod-i, which the
      // default keymap claims for selectParentSyntax). Returning true stops
      // further handling, including the keymap.
      Prec.high(EditorView.domEventHandlers({
        keydown(event, editorView) {
          if (isSelectAllEvent(event)) {
            event.preventDefault();
            selectAll(editorView);
            return true;
          }
          // Plain Enter continues the list, task or quote under the cursor;
          // anything unhandled (including IME composition commits) falls
          // through to the default newline.
          if (event.code === 'Enter'
            && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
            && !event.isComposing
            && continueList(editorView)) {
            event.preventDefault();
            return true;
          }
          // Unmodified typing pairs quotes and backticks (and Backspace
          // removes an empty pair); Shift stays allowed so shifted characters
          // like `"` still pair.
          if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing) {
            if (event.key === 'Backspace' && deletePair(editorView)) {
              event.preventDefault();
              return true;
            }
            if (event.key.length === 1 && pairInput(editorView, event.key)) {
              event.preventDefault();
              return true;
            }
          }
          const command = shortcutCommand(event);
          if (command) {
            event.preventDefault();
            command(editorView);
            return true;
          }
          return false;
        },
      })),
      EditorView.editorAttributes.of({ dir: direction, 'aria-label': options.label ?? '' }),
      EditorView.theme({
        '&': {
          // Explicit base direction (never inherited). Every rendered line
          // gets its own explicit direction plus a matching explicit
          // alignment from `line-direction.js`: a forced direction locks all
          // lines (fenced code stays ltr), while `auto` resolves per line
          // from the first strong letter. No `unicode-bidi: plaintext`
          // remains: Firefox aligns wrapped continuation rows that break
          // inside an inline span to the wrong side under `plaintext` plus
          // `text-align: start`.
          direction: baseDirection,
          textAlign: 'start',
          fontFamily: PERSIAN_FONT,
          fontSize: `${fontSize}px`,
        },
        '& .cm-scroller': {
          fontFamily: PERSIAN_FONT,
        },
        '& .cm-content': {
          lineHeight: '1.5',
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
     * Returns the 1-based line number visible at the given viewport offset,
     * so it works no matter which ancestor scrolls. Falls back to 1.
     * @param {number} [viewportTop] Viewport Y of the visible area top.
     * @returns {number} Visible line number, 1 on failure or after destroy.
     */
    visibleLine(viewportTop = 0) {
      if (destroyed) {
        return 1;
      }
      try {
        const top = typeof viewportTop === 'number' && Number.isFinite(viewportTop) ? viewportTop : 0;
        const box = view.scrollDOM.getBoundingClientRect();
        const pos = view.posAtCoords({ x: box.left + box.width / 2, y: top + 2 });
        if (typeof pos !== 'number') {
          return 1;
        }
        return view.state.doc.lineAt(pos).number;
      } catch {
        return 1;
      }
    },
    /**
     * Inserts a Markdown mark at the cursor or wraps the selection, using
     * the same toggle commands as the keyboard shortcuts.
     * @param {string} kind Mark kind (heading, bold, italic, strikethrough,
     *   quote, link, code, unordered-list, ordered-list).
     * @returns {boolean} True when a mark was inserted.
     */
    insertMark(kind) {
      if (destroyed) {
        return false;
      }
      const command = INSERT_COMMANDS[kind] ?? null;
      if (typeof command !== 'function') {
        return false;
      }
      view.focus();
      return command(view) === true;
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
