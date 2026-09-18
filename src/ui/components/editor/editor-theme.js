// Dark and sepia color-scheme overrides for the CodeMirror editor.
//
// CodeMirror injects theme styles into the document head, where shell-scoped
// token overrides are invisible — so non-light values are literals mirroring
// the matching scopes in public/theme.css. The light scheme needs no
// extension: the default CodeMirror styling plus inherited tokens already
// match it. Highlight washes keep a fixed per-scheme ink because their
// background stays constant across schemes.
import { EditorView } from 'codemirror';

const DARK_TEXT = '#e8eaf0';
const DARK_SELECTION = '#26436e';
const DARK_CURSOR = '#e8eaf0';
const DARK_GUTTER_BACKGROUND = '#1a2029';
const DARK_GUTTER_BORDER = '#2e3642';
const DARK_HIGHLIGHT_BACKGROUND = '#a3e635';
const DARK_HIGHLIGHT_INK = '#1a1a1a';

const SEPIA_TEXT = '#5f4b32';
const SEPIA_SELECTION = '#d3c4b3';
const SEPIA_CURSOR = '#5f4b32';
const SEPIA_HIGHLIGHT_BACKGROUND = '#fcd34d';
const SEPIA_HIGHLIGHT_INK = '#5f4b32';

/**
 * Returns the color-scheme extensions for the given scheme name.
 * @param {string} colorScheme 'dark' or 'sepia' enables overrides, anything else none.
 * @returns {Array} CodeMirror extensions (empty for the light scheme).
 */
export function editorColorScheme(colorScheme) {
  if (colorScheme !== 'dark' && colorScheme !== 'sepia') {
    return [];
  }
  const dark = colorScheme === 'dark';
  return [
    EditorView.theme({
      '&': {
        color: dark ? DARK_TEXT : SEPIA_TEXT,
        backgroundColor: 'transparent',
        ...(dark ? { colorScheme: 'dark' } : {}),
      },
      '& .cm-content': {
        caretColor: dark ? DARK_CURSOR : SEPIA_CURSOR,
      },
      '&.cm-focused .cm-cursor': {
        borderLeftColor: dark ? DARK_CURSOR : SEPIA_CURSOR,
      },
      '& ::selection': {
        backgroundColor: dark ? DARK_SELECTION : SEPIA_SELECTION,
      },
      '& .cm-selectionBackground': {
        backgroundColor: `${dark ? DARK_SELECTION : SEPIA_SELECTION} !important`,
      },
      '& .cm-gutters': {
        color: dark ? DARK_TEXT : SEPIA_TEXT,
        backgroundColor: dark ? DARK_GUTTER_BACKGROUND : 'transparent',
        borderRightColor: dark ? DARK_GUTTER_BORDER : 'transparent',
      },
      '& .parsi-highlight': {
        backgroundColor: dark ? DARK_HIGHLIGHT_BACKGROUND : SEPIA_HIGHLIGHT_BACKGROUND,
        color: dark ? DARK_HIGHLIGHT_INK : SEPIA_HIGHLIGHT_INK,
      },
    }),
  ];
}
