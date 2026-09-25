// Fenced code highlighting for the Persian Markdown editor.
//
// `codeLanguageDescriptions` feeds `markdown({ codeLanguages })` so fenced
// blocks parse with their own language; unknown or missing info strings
// stay plain. Lezer-based languages load lazily through dynamic imports
// (bare specifiers resolved by the importmap, like every static import),
// while shell parsing is synchronous: the legacy stream parser is tiny and
// importing it statically keeps the first paint deterministic. Token colors
// use stable `parsi-code-*` classes (never generated hashes): light values
// live in the theme below, dark and sepia overrides in `editor-theme.js`.
import { EditorView } from 'codemirror';
import {
  HighlightStyle,
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  syntaxHighlighting,
} from '@codemirror/language';
import { shell as shellParser } from '@codemirror/legacy-modes/mode/shell';
import { tags } from '@lezer/highlight';

const shellSupport = new LanguageSupport(
  StreamLanguage.define({
    ...shellParser,
    name: 'shell',
    tokenTable: {
      keyword: tags.keyword,
      builtin: tags.keyword,
      comment: tags.comment,
      meta: tags.comment,
      number: tags.number,
      atom: tags.atom,
      operator: tags.operator,
      def: tags.variableName,
      attribute: tags.propertyName,
    },
  }),
  [],
);

async function loadSupport(moduleName, factory) {
  const loaded = await import(moduleName);
  return loaded[factory]();
}

async function loadLanguage(moduleName, languageName) {
  const loaded = await import(moduleName);
  return new LanguageSupport(loaded[languageName]);
}

/**
 * Language descriptions for fenced code blocks, in matcher order.
 * `alias` covers the info-string variants; unmatched strings stay plain.
 */
export const codeLanguageDescriptions = [
  LanguageDescription.of({
    name: 'javascript',
    alias: ['js', 'jsx', 'mjs', 'cjs'],
    load: () => loadSupport('@codemirror/lang-javascript', 'javascript'),
  }),
  LanguageDescription.of({
    name: 'typescript',
    alias: ['ts', 'mts', 'cts'],
    load: () => loadLanguage('@codemirror/lang-javascript', 'typescriptLanguage'),
  }),
  LanguageDescription.of({
    name: 'tsx',
    load: () => loadLanguage('@codemirror/lang-javascript', 'tsxLanguage'),
  }),
  LanguageDescription.of({
    name: 'python',
    alias: ['py'],
    load: () => loadSupport('@codemirror/lang-python', 'python'),
  }),
  LanguageDescription.of({
    name: 'bash',
    alias: ['sh', 'shell', 'zsh'],
    support: shellSupport,
  }),
  LanguageDescription.of({
    name: 'sql',
    load: () => loadSupport('@codemirror/lang-sql', 'sql'),
  }),
  LanguageDescription.of({
    name: 'json',
    load: () => loadSupport('@codemirror/lang-json', 'json'),
  }),
  LanguageDescription.of({
    name: 'html',
    alias: ['vue'],
    load: () => loadSupport('@codemirror/lang-html', 'html'),
  }),
  LanguageDescription.of({
    name: 'xml',
    alias: ['svg'],
    load: () => loadSupport('@codemirror/lang-xml', 'xml'),
  }),
  LanguageDescription.of({
    name: 'css',
    alias: ['scss', 'less'],
    load: () => loadSupport('@codemirror/lang-css', 'css'),
  }),
  LanguageDescription.of({
    name: 'yaml',
    alias: ['yml'],
    load: () => loadSupport('@codemirror/lang-yaml', 'yaml'),
  }),
  LanguageDescription.of({
    name: 'java',
    load: () => loadSupport('@codemirror/lang-java', 'java'),
  }),
  LanguageDescription.of({
    name: 'cpp',
    alias: ['c', 'h', 'hpp', 'cc'],
    load: () => loadSupport('@codemirror/lang-cpp', 'cpp'),
  }),
  LanguageDescription.of({
    name: 'go',
    load: () => loadSupport('@codemirror/lang-go', 'go'),
  }),
  LanguageDescription.of({
    name: 'rust',
    alias: ['rs'],
    load: () => loadSupport('@codemirror/lang-rust', 'rust'),
  }),
  LanguageDescription.of({
    name: 'php',
    load: () => loadSupport('@codemirror/lang-php', 'php'),
  }),
];

/**
 * Resolves a fence info string to its language description, if any.
 * Matching is case-insensitive on the trimmed string.
 * @param {unknown} info Fence info string.
 * @returns {object|null} Language description or null when unknown.
 */
export function codeLanguageForInfo(info) {
  if (typeof info !== 'string') {
    return null;
  }
  const name = info.trim().toLowerCase();
  if (name.length === 0) {
    return null;
  }
  return codeLanguageDescriptions.find((language) => language.name === name
    || (language.alias ?? []).some((alias) => alias === name)) ?? null;
}

/**
 * Stable highlight classes for code tokens. Applied alongside the default
 * highlight style; only `parsi-code-*` classes are targeted by the themes.
 */
const codeTokenHighlight = HighlightStyle.define([
  { tag: tags.keyword, class: 'parsi-code-keyword' },
  { tag: tags.string, class: 'parsi-code-string' },
  { tag: tags.comment, class: 'parsi-code-comment' },
  { tag: tags.number, class: 'parsi-code-number' },
  { tag: tags.variableName, class: 'parsi-code-variable' },
  { tag: tags.operator, class: 'parsi-code-operator' },
  { tag: tags.typeName, class: 'parsi-code-type' },
  { tag: tags.propertyName, class: 'parsi-code-property' },
]);

const codeTokenTheme = EditorView.theme({
  '& .cm-line .parsi-code-keyword': { color: '#9333ea' },
  '& .cm-line .parsi-code-string': { color: '#15803d' },
  '& .cm-line .parsi-code-comment': { color: '#737373' },
  '& .cm-line .parsi-code-number': { color: '#b45309' },
  '& .cm-line .parsi-code-variable': { color: 'inherit' },
  '& .cm-line .parsi-code-operator': { color: '#525252' },
  '& .cm-line .parsi-code-type': { color: '#0e7490' },
  '& .cm-line .parsi-code-property': { color: '#1d4ed8' },
});

/**
 * Returns the fenced-code highlighting extensions (token style plus the
 * light-scheme colors; dark and sepia arrive through `editor-theme.js`).
 * @returns {Array} CodeMirror extensions.
 */
export function codeHighlightExtensions() {
  return [syntaxHighlighting(codeTokenHighlight), codeTokenTheme];
}
