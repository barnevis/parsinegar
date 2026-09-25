// Scoped search over a CodeMirror state with @codemirror/search queries.
//
// Pure helpers around SearchQuery: normalize the form spec, build a validated
// query, and collect precise matches inside a scope. The editor controller
// owns the view and dispatches; this module never touches a view, so it stays
// unit-testable with a bare EditorState.
import { SearchQuery } from '@codemirror/search';

/**
 * Normalizes a search form spec into explicit values.
 * @param {object} [spec] Raw spec from the search form.
 * @returns {object} Normalized `{ query, replace, caseSensitive, wholeWord, regexp, inSelection }`.
 */
export function normalizeSearchSpec(spec = {}) {
  const source = spec !== null && typeof spec === 'object' ? spec : {};
  return {
    query: typeof source.query === 'string' ? source.query : '',
    replace: typeof source.replace === 'string' ? source.replace : '',
    caseSensitive: source.caseSensitive === true,
    wholeWord: source.wholeWord === true,
    regexp: source.regexp === true,
    inSelection: source.inSelection === true,
  };
}

/**
 * Builds a validated SearchQuery from a form spec.
 * @param {object} [spec] Raw spec from the search form.
 * @returns {object} `{ query }` with a SearchQuery, `{ query: null }` for an
 *   empty query (clear), or `{ error: 'invalid-regexp' }` for a bad pattern.
 */
export function createSearchQuery(spec = {}) {
  const normalized = normalizeSearchSpec(spec);
  if (normalized.query === '') {
    return { query: null };
  }
  let query = null;
  try {
    query = new SearchQuery({
      search: normalized.query,
      replace: normalized.replace,
      caseSensitive: normalized.caseSensitive,
      wholeWord: normalized.wholeWord,
      regexp: normalized.regexp,
    });
  } catch {
    return { error: 'invalid-regexp' };
  }
  if (!query.valid) {
    return { error: 'invalid-regexp' };
  }
  return { query };
}

/**
 * Resolves the search scope: the main selection when `inSelection` is set
 * and non-empty, otherwise the whole document.
 * @param {object} state Editor state.
 * @param {object} spec Normalized spec.
 * @returns {object} `{ from, to }` scope range.
 */
export function resolveSearchScope(state, spec) {
  if (spec.inSelection) {
    const main = state.selection?.main;
    if (main && !main.empty) {
      return { from: main.from, to: main.to };
    }
  }
  return { from: 0, to: state.doc.length };
}

/**
 * Expands `$` references in a regexp replacement using the cursor match.
 * Mirrors the expansion rule of the search library (`$&`, `$$`, `$n`).
 * @param {string} template Unquoted replacement template.
 * @param {Array|null} match RegExp match array, or null when unavailable.
 * @returns {string} Expanded replacement text.
 */
function expandRegexpReplacement(template, match) {
  if (!Array.isArray(match)) {
    return template;
  }
  return template.replace(/\$([$&]|\d+)/g, (found, token) => {
    if (token === '&') {
      return match[0];
    }
    if (token === '$') {
      return '$';
    }
    for (let length = token.length; length > 0; length -= 1) {
      const group = Number(token.slice(0, length));
      if (group > 0 && group < match.length) {
        return match[group] + token.slice(length);
      }
    }
    return found;
  });
}

/**
 * Reads the replacement text for a collected match. String queries use the
 * literal replacement (with `\n` escapes resolved); regexp queries additionally
 * expand `$` group references from the cursor match.
 * @param {SearchQuery} query Validated search query.
 * @param {object} found Cursor match value with optional `match` groups.
 * @returns {string} Replacement text.
 */
function replacementFor(query, found) {
  const template = typeof query.unquote === 'function' ? query.unquote(query.replace) : query.replace;
  if (!query.regexp) {
    return template;
  }
  return expandRegexpReplacement(template, found?.match ?? null);
}

/**
 * Collects precise matches of the query inside the scope, ascending.
 * @param {object} state Editor state.
 * @param {SearchQuery} query Validated search query.
 * @param {object} scope `{ from, to }` scope range.
 * @returns {Array} Matches as `{ from, to, replacement }`.
 */
export function collectSearchMatches(state, query, scope) {
  const from = Math.max(0, Math.min(scope.from, state.doc.length));
  const to = Math.max(from, Math.min(scope.to, state.doc.length));
  const matches = [];
  const cursor = query.getCursor(state, from, to);
  for (;;) {
    const step = cursor.next();
    if (step.done) {
      break;
    }
    const found = step.value;
    if (!found || found.precise === false || found.from < from || found.to > to) {
      continue;
    }
    matches.push({ from: found.from, to: found.to, replacement: replacementFor(query, found) });
  }
  return matches;
}

/**
 * Finds the match containing the position, if any.
 * @param {Array} matches Collected matches, ascending.
 * @param {number} pos Document position.
 * @returns {number} Match index, or -1 when the position is on no match.
 */
export function indexOfMatchAt(matches, pos) {
  for (let index = 0; index < matches.length; index += 1) {
    if (matches[index].from <= pos && pos <= matches[index].to) {
      return index;
    }
  }
  return -1;
}
