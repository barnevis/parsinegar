// Mindmap center-stage controller: MindElixir lifecycle in a host node.
//
// Plain controller factory (not a custom element), mirroring
// markdown-view.js: the page renders the host node and mounts the
// third-party view here. The library is lazy-imported on first mount so
// non-mindmap loads never fetch it. MindElixir owns its DOM until
// destroy() releases it; its stylesheet is fetched once and injected into
// the host's root (document styles never reach inside Shadow DOM).
import { buildMindmapTree, isListOnlyDocument, mindmapSignature, parseMindmap } from '../../components/workbench/mindmap.js';
import { generateSubBranch, lineOfNodeId, toMindElixirData } from '../../components/workbench/mindmap-adapter.js';

const MINDMAP_CSS_PATH = './node_modules/mind-elixir/dist/MindElixir.css';
const PERSIAN_FONT = "'Vazirmatn', Tahoma, sans-serif";
const FONT_OVERRIDE = `[data-mindmap-root],[data-mindmap-root] *{font-family:${PERSIAN_FONT};}[data-mindmap-root] .map-container .lhs me-tpc,[data-mindmap-root] .map-container .rhs me-tpc{direction:rtl;text-align:start;}`;

let cachedCss = null;

/**
 * Reads a MindElixir node id from the shapes the library hands out: plain
 * id strings, node objects, or element wrappers carrying `nodeObj`.
 * @param {unknown} node Bus payload, current node, or id.
 * @returns {string|null} Node id or null.
 */
function nodeIdOf(node) {
  if (typeof node === 'string') {
    return node;
  }
  if (node && typeof node === 'object') {
    if (typeof node.id === 'string') {
      return node.id;
    }
    const nested = node.nodeObj;
    if (nested && typeof nested === 'object' && typeof nested.id === 'string') {
      return nested.id;
    }
  }
  return null;
}

/**
 * Fetches the library stylesheet once for style injection.
 * @returns {Promise<string>} CSS text.
 */
async function mindmapCss() {
  if (cachedCss === null) {
    const response = await fetch(MINDMAP_CSS_PATH);
    if (!response.ok) {
      throw new Error(`mindmap stylesheet unavailable: ${MINDMAP_CSS_PATH}`);
    }
    cachedCss = await response.text();
  }
  return cachedCss;
}

/**
 * Creates a display-only mindmap in the given host element.
 * @param {HTMLElement} host Container rendered by the owning page.
 * @param {object} [options] View options.
 * @param {Function} options.getText Reads the current Markdown text.
 * @param {Function} [options.t] Translation function (falls back to identity).
 * @param {boolean} [options.dark] Renders the dark theme instead of light.
 * @param {Function} [options.onJump] Called with a 1-based line on node double-click.
 * @returns {object} Controller with `refresh()`, `destroy()`, `ready`.
 * @throws {Error} When host is not an element.
 */
export function createMindmapHost(host, options = {}) {
  const isElement = host !== null && typeof host === 'object' && typeof host.appendChild === 'function';
  if (!isElement) {
    throw new Error('createMindmapHost requires an element host');
  }
  const getText = typeof options.getText === 'function' ? options.getText : () => '';
  const translate = typeof options.t === 'function' ? options.t : (key) => key;
  const onJump = typeof options.onJump === 'function' ? options.onJump : null;
  const dark = options.dark === true;
  let mind = null;
  let destroyed = false;
  let signature = null;
  let selectedId = null;
  let lastData = null;

  const showGuidance = () => {
    host.setAttribute('data-mindmap-root', '');
    host.textContent = '';
    const note = document.createElement('p');
    note.setAttribute('part', 'mindmap-empty');
    note.textContent = translate('parsinegar.views.mindmap-empty');
    host.append(note);
  };

  const releaseInstance = () => {
    if (mind) {
      host.removeEventListener('dblclick', handleDoubleClick);
      try {
        mind.destroy();
      } catch {
        // Detached instances release with their node; never break teardown.
      }
      mind = null;
    }
    lastData = null;
  };

  // Node boxes are measured at layout time: a late webfont arrival resizes
  // them while link paths stay stale, so every finished font load replays
  // the last render. The listener lives on the global set and is removed
  // on destroy.
  const healFonts = () => {
    if (destroyed || !mind || !lastData) {
      return;
    }
    try {
      mind.refresh(lastData);
      selectedId = null;
    } catch {
      // A later refresh heals; never break on a background relayout.
    }
  };
  const fontSet = typeof document !== 'undefined' ? document.fonts : null;
  if (fontSet && typeof fontSet.addEventListener === 'function') {
    fontSet.addEventListener('loadingdone', healFonts);
  }

  function handleDoubleClick() {
    if (destroyed || !mind) {
      return;
    }
    const line = lineOfNodeId(nodeIdOf(selectedId) ?? nodeIdOf(mind.currentNode));
    if (line !== null) {
      onJump?.(line);
    }
  }

  const handleSelect = (node) => {
    const single = Array.isArray(node) ? node[0] : node;
    const id = nodeIdOf(single);
    if (id !== null) {
      selectedId = id;
    }
  };

  async function ensureInstance(text) {
    if (mind) {
      return true;
    }
    const { default: MindElixir } = await import('mind-elixir');
    if (mind) {
      return true;
    }
    if (destroyed) {
      return false;
    }
    const root = host.getRootNode();
    const styleScope = root && root.nodeType === 9 ? root.head ?? root : root;
    if (styleScope && typeof styleScope.querySelector === 'function' && !styleScope.querySelector('style[data-mindmap-css]')) {
      let css = '';
      try {
        css = await mindmapCss();
      } catch {
        console.error('[mindmap-host] stylesheet unavailable');
      }
      const style = document.createElement('style');
      style.setAttribute('data-mindmap-css', '');
      style.textContent = css === '' ? FONT_OVERRIDE : `${css}\n${FONT_OVERRIDE}`;
      styleScope.append(style);
    }
    host.setAttribute('data-mindmap-root', '');
    host.textContent = '';
    // The constructor option alone does not survive: changeTheme() during
    // init re-reads the generator off the theme, so it rides along here.
    const theme = { ...(dark ? MindElixir.DARK_THEME : MindElixir.THEME), generateSubBranch };
    mind = new MindElixir({
      el: host,
      direction: MindElixir.RIGHT,
      editable: false,
      draggable: false,
      contextMenu: false,
      toolBar: false,
      nodeMenu: false,
      keypress: false,
      theme,
    });
    mind.bus.addListener('selectNodes', handleSelect);
    mind.bus.addListener('unselectNodes', () => {
      selectedId = null;
    });
    host.addEventListener('dblclick', handleDoubleClick);
    lastData = toMindElixirData(buildMindmapTree(parseMindmap(text)));
    mind.init(lastData);
    return true;
  }

  async function boot() {
    if (destroyed) {
      return;
    }
    try {
      const text = getText() ?? '';
      signature = mindmapSignature(text);
      if (!isListOnlyDocument(text)) {
        showGuidance();
        return;
      }
      if (await ensureInstance(text)) {
        selectedId = null;
      }
    } catch {
      if (!destroyed) {
        showGuidance();
      }
    }
  }

  const ready = boot();

  return {
    /**
     * Rebuilds the map when the text signature changed; shows guidance for
     * non-list documents. No-op after destroy.
     * @returns {Promise<void>}
     */
    async refresh() {
      if (destroyed) {
        return;
      }
      await ready;
      if (destroyed) {
        return;
      }
      try {
        const text = getText() ?? '';
        const next = mindmapSignature(text);
        if (next === signature && mind) {
          return;
        }
        signature = next;
        if (!isListOnlyDocument(text)) {
          releaseInstance();
          showGuidance();
          return;
        }
        if (await ensureInstance(text)) {
          lastData = toMindElixirData(buildMindmapTree(parseMindmap(text)));
          mind.refresh(lastData);
          selectedId = null;
        }
      } catch {
        if (!destroyed) {
          releaseInstance();
          showGuidance();
        }
      }
    },
    /**
     * Destroys the instance and releases its listeners. Keeps working after
     * boot races: a late boot bails out on the destroyed flag.
     * @returns {void}
     */
    destroy() {
      destroyed = true;
      if (fontSet && typeof fontSet.removeEventListener === 'function') {
        fontSet.removeEventListener('loadingdone', healFonts);
      }
      releaseInstance();
      host.textContent = '';
    },
    ready,
  };
}
