// Color-scheme colors for the CodeMirror editor.
//
// CodeMirror injects theme styles into the document head, where shell-scoped
// token overrides are invisible — so non-light values are literals mirroring
// the matching scopes in public/theme.css. Every color lives here, exactly
// once per scheme: base themes carry structure only, because same-selector
// ties across theme tags resolve against the scheme overrides (verified:
// the scheme tag mounts before the base tags, so duplicates would always
// lose). Highlight washes keep a fixed per-scheme ink because their
// background stays constant across schemes.
import { EditorView } from 'codemirror';
import { admonitionSchemeRules } from './admonition-view.js';

const DARK_TEXT = '#e8eaf0';
const DARK_SELECTION = '#26436e';
const DARK_CURSOR = '#e8eaf0';
const DARK_GUTTER_BACKGROUND = '#1a2029';
const DARK_GUTTER_BORDER = '#2e3642';
const DARK_HIGHLIGHT_BACKGROUND = '#a3e635';
const DARK_HIGHLIGHT_INK = '#1a1a1a';
const LIGHT_SEARCH_MATCH = '#fef08a';
const LIGHT_SEARCH_SELECTED = '#fbbf24';
const LIGHT_HIGHLIGHT_BACKGROUND = '#fff3b0';
const LIGHT_HIGHLIGHT_INK = '#1c2026';

const DARK_SEARCH_MATCH = '#7c5e10';
const DARK_SEARCH_SELECTED = '#a16207';
const SEPIA_SEARCH_MATCH = '#fde68a';
const SEPIA_SEARCH_SELECTED = '#f59e0b';

const SEPIA_TEXT = '#5f4b32';
const SEPIA_SELECTION = '#d3c4b3';
const SEPIA_CURSOR = '#5f4b32';
const SEPIA_HIGHLIGHT_BACKGROUND = '#fcd34d';
const SEPIA_HIGHLIGHT_INK = '#5f4b32';

const DARK_CODE_KEYWORD = '#c084fc';
const DARK_CODE_STRING = '#a3e635';
const DARK_CODE_COMMENT = '#7d8aa0';
const DARK_CODE_NUMBER = '#fbbf24';
const DARK_CODE_OPERATOR = '#94a3b8';
const DARK_CODE_TYPE = '#5eead4';
const DARK_CODE_PROPERTY = '#6ea8ff';

const SEPIA_CODE_KEYWORD = '#7c3aed';
const SEPIA_CODE_STRING = '#047857';
const SEPIA_CODE_COMMENT = '#8a7a5f';
const SEPIA_CODE_NUMBER = '#b45309';
const SEPIA_CODE_OPERATOR = '#8a7a5f';
const SEPIA_CODE_TYPE = '#0e7490';
const SEPIA_CODE_PROPERTY = '#1d4ed8';

/**
 * Returns the color-scheme theme for the given scheme name. Always returns
 * exactly one theme extension — including for light — so every color has a
 * single source and no selector collides across tags.
 * @param {string} colorScheme 'light', 'dark' or 'sepia' (anything else
 *   falls back to light).
 * @returns {Array} CodeMirror extensions with one theme.
 */
export function editorColorScheme(colorScheme) {
  const scheme = colorScheme === 'dark' ? 'dark' : colorScheme === 'sepia' ? 'sepia' : 'light';
  const dark = scheme === 'dark';
  const light = scheme === 'light';
  const searchMatch = light ? LIGHT_SEARCH_MATCH : dark ? DARK_SEARCH_MATCH : SEPIA_SEARCH_MATCH;
  const searchSelected = light ? LIGHT_SEARCH_SELECTED : dark ? DARK_SEARCH_SELECTED : SEPIA_SEARCH_SELECTED;
  const highlightBackground = light
    ? LIGHT_HIGHLIGHT_BACKGROUND
    : dark ? DARK_HIGHLIGHT_BACKGROUND : SEPIA_HIGHLIGHT_BACKGROUND;
  const highlightInk = light ? LIGHT_HIGHLIGHT_INK : dark ? DARK_HIGHLIGHT_INK : SEPIA_HIGHLIGHT_INK;
  const rules = {
    '& .cm-searchMatch': {
      backgroundColor: searchMatch,
      borderRadius: '2px',
    },
    '& .cm-searchMatch-selected': {
      backgroundColor: searchSelected,
    },
    '& .parsi-highlight': {
      backgroundColor: highlightBackground,
      color: highlightInk,
    },
    ...Object.fromEntries(
      admonitionSchemeRules(scheme).map((rule) => [rule.selector, rule.declarations]),
    ),
  };
  return [
    EditorView.theme({
      // Non-light schemes also take over text, selection and gutters; light
      // keeps the inherited defaults there as before.
      ...(!light && {
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
        // Same opaque-background fix as the `Highlight` rules in
        // `live-preview.js`, but with the scheme literals so selected code
        // matches the surrounding selected text exactly.
        '& .cm-line .parsi-code .parsi-selected': {
          backgroundColor: dark ? DARK_SELECTION : SEPIA_SELECTION,
        },
        '& .cm-line .parsi-selected .parsi-code': {
          backgroundColor: dark ? DARK_SELECTION : SEPIA_SELECTION,
        },
        '& .cm-line.parsi-code-line.parsi-selected': {
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
        '& .cm-line .parsi-code-keyword': { color: dark ? DARK_CODE_KEYWORD : SEPIA_CODE_KEYWORD },
        '& .cm-line .parsi-code-string': { color: dark ? DARK_CODE_STRING : SEPIA_CODE_STRING },
        '& .cm-line .parsi-code-comment': { color: dark ? DARK_CODE_COMMENT : SEPIA_CODE_COMMENT },
        '& .cm-line .parsi-code-number': { color: dark ? DARK_CODE_NUMBER : SEPIA_CODE_NUMBER },
        '& .cm-line .parsi-code-variable': { color: dark ? DARK_TEXT : SEPIA_TEXT },
        '& .cm-line .parsi-code-operator': { color: dark ? DARK_CODE_OPERATOR : SEPIA_CODE_OPERATOR },
        '& .cm-line .parsi-code-type': { color: dark ? DARK_CODE_TYPE : SEPIA_CODE_TYPE },
        '& .cm-line .parsi-code-property': { color: dark ? DARK_CODE_PROPERTY : SEPIA_CODE_PROPERTY },
      }),
      ...rules,
    }),
  ];
}