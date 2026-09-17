// Dark color-scheme overrides for the CodeMirror editor.
//
// CodeMirror injects theme styles into the document head, where shell-scoped
// token overrides are invisible — so dark values are literals mirroring the
// dark tokens in public/theme.css. The light scheme needs no extension: the
// default CodeMirror styling plus inherited tokens already match it.
import { EditorView } from 'codemirror';

const DARK_TEXT = '#e8eaf0';
const DARK_SELECTION = '#26436e';
const DARK_CURSOR = '#e8eaf0';
const DARK_ACTIVE_LINE = 'rgb(255 255 255 / 0.04)';
const DARK_GUTTER_BACKGROUND = '#1a2029';
const DARK_GUTTER_BORDER = '#2e3642';

/**
 * Returns the dark color-scheme extensions for the given scheme name.
 * @param {string} colorScheme 'dark' enables overrides, anything else none.
 * @returns {Array} CodeMirror extensions (empty for the light scheme).
 */
export function editorColorScheme(colorScheme) {
  if (colorScheme !== 'dark') {
    return [];
  }
  return [
    EditorView.theme({
      '&': {
        color: DARK_TEXT,
        backgroundColor: 'transparent',
        colorScheme: 'dark',
      },
      '& .cm-content': {
        caretColor: DARK_CURSOR,
      },
      '&.cm-focused .cm-cursor': {
        borderLeftColor: DARK_CURSOR,
      },
      '& ::selection': {
        backgroundColor: DARK_SELECTION,
      },
      '& .cm-selectionBackground': {
        backgroundColor: `${DARK_SELECTION} !important`,
      },
      '& .cm-activeLine': {
        backgroundColor: DARK_ACTIVE_LINE,
      },
      '& .cm-gutters': {
        color: DARK_TEXT,
        backgroundColor: DARK_GUTTER_BACKGROUND,
        borderRightColor: DARK_GUTTER_BORDER,
      },
    }),
  ];
}
