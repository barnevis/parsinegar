// Verifies fenced-code language mapping (pure, no DOM).
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarkdownView } from '../../../components/editor/markdown-view.js';
import { codeLanguageDescriptions, codeLanguageForInfo } from '../../../components/editor/code-highlight.js';

/**
 * Checks that an injected stylesheet rule targets a selector with a declaration.
 * @param {string} selector Fragment of the rule selector.
 * @param {string} property CSS property name.
 * @param {string} expected Substring of the declared value.
 * @returns {boolean} True when such a rule exists.
 */
function hasRule(selector, property, expected) {
  for (const sheet of document.styleSheets) {
    let rules = [];
    try {
      rules = [...sheet.cssRules];
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (rule.selectorText?.includes(selector) && rule.style?.getPropertyValue(property).includes(expected)) {
        return true;
      }
    }
  }
  return false;
}

test('should_resolve_common_info_strings_when_asked', () => {
  const cases = [
    ['js', 'javascript'],
    ['JavaScript', 'javascript'],
    ['tsx', 'tsx'],
    ['ts', 'typescript'],
    ['py', 'python'],
    ['sh', 'bash'],
    ['zsh', 'bash'],
    ['sql', 'sql'],
    ['json', 'json'],
    ['html', 'html'],
    ['xml', 'xml'],
    ['svg', 'xml'],
    ['css', 'css'],
    ['scss', 'css'],
    ['yaml', 'yaml'],
    ['yml', 'yaml'],
    ['java', 'java'],
    ['c', 'cpp'],
    ['hpp', 'cpp'],
    ['go', 'go'],
    ['rust', 'rust'],
    ['rs', 'rust'],
    ['php', 'php'],
  ];
  for (const [info, name] of cases) {
    const language = codeLanguageForInfo(info);
    assert.ok(language, `expected a language for ${info}`);
    assert.equal(language.name, name);
  }
});

test('should_reject_unknown_info_strings_when_asked', () => {
  assert.equal(codeLanguageForInfo(''), null);
  assert.equal(codeLanguageForInfo('  '), null);
  assert.equal(codeLanguageForInfo('cobol'), null);
  assert.equal(codeLanguageForInfo(null), null);
  assert.equal(codeLanguageForInfo(42), null);
});

test('should_cover_expected_languages_when_listed', () => {
  const names = codeLanguageDescriptions.map((language) => language.name);
  for (const name of ['javascript', 'typescript', 'tsx', 'python', 'bash', 'sql', 'json', 'html', 'xml', 'css', 'yaml', 'java', 'cpp', 'go', 'rust', 'php']) {
    assert.ok(names.includes(name), `expected language: ${name}`);
  }
});

test('should_paint_code_tokens_when_themed', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: '```js\nconst x = 1;\n```' });
  try {
    assert.ok(hasRule('.parsi-code-keyword', 'color', '#9333ea'));
    assert.ok(hasRule('.parsi-code-string', 'color', '#15803d'));
    assert.ok(hasRule('.parsi-code-comment', 'color', '#737373'));
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_paint_code_tokens_when_scheme_is_dark', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: '```js\nconst x = 1;\n```', colorScheme: 'dark' });
  try {
    assert.ok(hasRule('.parsi-code-keyword', 'color', '#c084fc'));
    assert.ok(hasRule('.parsi-code-string', 'color', '#a3e635'));
  } finally {
    editor.destroy();
  }
});
