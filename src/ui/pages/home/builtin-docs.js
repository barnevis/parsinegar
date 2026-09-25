// Built-in project docs: static Markdown fetched once and cached.
//
// The guide, changelog and about page live as repository files outside the
// documents service (no save, delete, rename or autosave applies to them).
// The page opens them through the same editor, locked for reading. Fetch is
// injected so tests never touch the network.
export const BUILTIN_DOCS = [
  { id: 'help', titleKey: 'parsinegar.builtin.help', url: './README.md' },
  { id: 'changelog', titleKey: 'parsinegar.builtin.changelog', url: './CHANGELOG.md' },
  { id: 'about', titleKey: 'parsinegar.builtin.about', url: './ABOUT.md' },
];

/**
 * Creates the built-in docs companion.
 * @param {object} [options] Companion options.
 * @param {Function} [options.fetchImpl] Fetch implementation (defaults to the
 *   global fetch, guarded for non-browser runtimes).
 * @param {Function} [options.t] Translation function for titles.
 * @param {Function} [options.isLive] Whether the owning page is still connected.
 * @returns {object} Companion with list() and open(id).
 */
export function createBuiltinDocs({ fetchImpl, t = (key) => key, isLive = () => true } = {}) {
  const fetchMarkdown = typeof fetchImpl === 'function'
    ? fetchImpl
    : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const translate = typeof t === 'function' ? t : (key) => key;
  const live = typeof isLive === 'function' ? isLive : () => true;
  const cache = new Map();

  return {
    /**
     * Lists the available built-in docs.
     * @returns {Array} `{ id, title }` entries in menu order.
     */
    list() {
      return BUILTIN_DOCS.map(({ id, titleKey }) => ({ id, title: translate(titleKey) }));
    },
    /**
     * Loads a built-in doc by id, from the session cache when present.
     * @param {unknown} id Built-in doc id.
     * @returns {Promise<object|null>} `{ id, title, content }`, or null for
     *   unknown ids, dead pages and failed loads.
     */
    async open(id) {
      const entry = BUILTIN_DOCS.find((candidate) => candidate.id === id);
      if (!entry || !fetchMarkdown) {
        return null;
      }
      try {
        if (!cache.has(entry.id)) {
          const response = await fetchMarkdown(entry.url);
          if (!live() || !response || response.ok !== true) {
            return null;
          }
          cache.set(entry.id, await response.text());
        }
        if (!live()) {
          return null;
        }
        return { id: entry.id, title: translate(entry.titleKey), content: cache.get(entry.id) ?? '' };
      } catch (error) {
        console.error('[parsi-builtin-docs] built-in doc load failed');
        return null;
      }
    },
  };
}
