// Mindmap center-stage controller: MindElixir lifecycle in a host node.
//
// Plain controller factory (not a custom element), mirroring
// markdown-view.js: the page renders the host node and mounts the
// third-party view here. The library is lazy-imported on first mount so
// non-mindmap loads never fetch it. MindElixir owns its canvas DOM until
// destroy() releases it; its stylesheet is fetched once and injected into
// the host's root (document styles never reach inside Shadow DOM).
//
// Editing always flows through the bus: every library mutation is
// translated to source text (single writer) and reported through onChange,
// then the map rebuilds so node ids stay fresh. Native gestures stay
// native (double-click/F2 edit, Tab/Enter/Delete, drag-move); the toolbar
// only triggers the same public methods in Persian.
import { buildMindmapTree, isListOnlyDocument, mindmapSignature, parseMindmap } from '../../components/workbench/mindmap.js';
import { renderInlineHtml } from '../../components/workbench/mindmap-inline.js';
import { applyMapOperation, MAP_NEW_TOPIC } from '../../components/workbench/mindmap-edit.js';
import { describeOperation, generateSubBranch, lineOfNodeId, toMindElixirData } from '../../components/workbench/mindmap-adapter.js';

const MINDMAP_CSS_PATH = './node_modules/mind-elixir/dist/MindElixir.css';
const PERSIAN_FONT = "'Vazirmatn', Tahoma, sans-serif";
const MONO_FONT = "'Vazirmatn', ui-monospace, monospace";
const MINDMAP_STYLE = `[data-mindmap-root],[data-mindmap-root] *{font-family:${PERSIAN_FONT};}[data-mindmap-root] .map-container{background-color:var(--pey-color-canvas,#ffffff);}`
  + `[data-mindmap-root] .map-container .lhs me-tpc,[data-mindmap-root] .map-container .rhs me-tpc{direction:rtl;text-align:start;}`
  + `[data-mindmap-root] .text strong{font-weight:700;}[data-mindmap-root] .text em{font-style:italic;}[data-mindmap-root] .text del{text-decoration:line-through;}`
  + `[data-mindmap-root] .text code{font-family:${MONO_FONT};background-color:var(--pey-color-surface,#f1f1f4);border-radius:4px;padding-inline:0.25em;}`
  + `[data-mindmap-root] .text a{color:var(--pey-color-accent,#5eead4);text-decoration:underline;}`;

let cachedCss = null;

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

const TOOLBAR_ACTIONS = ['addChild', 'addSibling', 'removeNode', 'jump'];

/**
 * Creates an editable mindmap in the given host element.
 * @param {HTMLElement} host Container rendered by the owning page.
 * @param {object} options View options.
 * @param {Function} options.getText Reads the current Markdown text.
 * @param {Function} [options.t] Translation function (falls back to identity).
 * @param {boolean} [options.dark] Renders the dark theme instead of light.
 * @param {Function} options.onChange Called with the new text on every
 *   committed map operation (required: without it the map would diverge
 *   from the text it edits).
 * @param {Function} [options.onJump] Called with a 1-based line when the
 *   jump action runs.
 * @returns {object} Controller with `refresh()`, `destroy()`, `ready`.
 * @throws {Error} When host is not an element or onChange is missing.
 */
export function createMindmapHost(host, options = {}) {
  const isElement = host !== null && typeof host === 'object' && typeof host.appendChild === 'function';
  if (!isElement) {
    throw new Error('createMindmapHost requires an element host');
  }
  const getText = typeof options.getText === 'function' ? options.getText : () => '';
  const translate = typeof options.t === 'function' ? options.t : (key) => key;
  const onChange = typeof options.onChange === 'function' ? options.onChange : null;
  if (!onChange) {
    throw new Error('createMindmapHost requires an onChange callback');
  }
  const onJump = typeof options.onJump === 'function' ? options.onJump : null;
  const dark = options.dark === true;
  let mind = null;
  let destroyed = false;
  let signature = null;
  let selectedId = null;
  let lastData = null;
  let canvas = null;
  let bar = null;
  const pendingFresh = new Map();

  const labelFor = (action) => translate(`parsinegar.mindmap.${action}`);

  const buildBar = () => {
    const element = document.createElement('div');
    element.setAttribute('data-mindmap-bar', '');
    element.hidden = true;
    for (const action of TOOLBAR_ACTIONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-mind-btn', action);
      button.textContent = labelFor(action);
      element.append(button);
    }
    return element;
  };

  const showGuidance = () => {
    if (bar) {
      bar.hidden = true;
    }
    if (!canvas) {
      return;
    }
    canvas.textContent = '';
    const note = document.createElement('p');
    note.setAttribute('part', 'mindmap-empty');
    note.textContent = translate('parsinegar.views.mindmap-empty');
    canvas.append(note);
  };

  const releaseInstance = () => {
    if (mind) {
      try {
        mind.destroy();
      } catch {
        // Detached instances release with their node; never break teardown.
      }
      mind = null;
    }
  };

  const resolveLine = (id) => lineOfNodeId(id) ?? pendingFresh.get(id) ?? null;

  const currentElement = () => {
    if (!mind) {
      return null;
    }
    const id = nodeIdOf(selectedId) ?? nodeIdOf(mind.currentNode);
    if (id === null) {
      return null;
    }
    try {
      return mind.findEle(id);
    } catch {
      return null;
    }
  };

  const runToolbarAction = (action) => {
    if (destroyed || !mind) {
      return;
    }
    if (action === 'jump') {
      const id = nodeIdOf(selectedId) ?? nodeIdOf(mind.currentNode);
      const line = id === null ? null : resolveLine(id);
      if (line !== null) {
        onJump?.(line);
      }
      return;
    }
    const element = currentElement();
    if (!element) {
      return;
    }
    try {
      if (action === 'addChild') {
        mind.addChild(element);
      } else if (action === 'addSibling') {
        mind.insertSibling('after', element);
      } else if (action === 'removeNode') {
        mind.removeNodes([element]);
      }
    } catch {
      // Library refusals (root guards) stay silent; the map is untouched.
    }
  };

  const handleBarClick = (event) => {
    const button = event.target?.closest?.('[data-mind-btn]');
    if (!button || !host.contains(button)) {
      return;
    }
    runToolbarAction(button.getAttribute('data-mind-btn') ?? '');
  };

  const handleSelect = (node) => {
    const single = Array.isArray(node) ? node[0] : node;
    const id = nodeIdOf(single);
    if (id !== null) {
      selectedId = id;
    }
  };

  const healRefresh = async () => {
    if (destroyed) {
      return;
    }
    try {
      await refresh();
    } catch {
      // Refresh heals through guidance; never break on it.
    }
  };

  // Zooms the map down only when it overflows the visible stage, so the
  // map's start (the root) stays fully on screen beside the side panel.
  // jsdom reports zero layout, which guards the call instead of scaling
  // through NaN. The library's own scaleFit never zooms in past 1.
  const fitMap = () => {
    if (destroyed || !mind || canvas === null) {
      return;
    }
    if (canvas.offsetWidth <= 0 || canvas.offsetHeight <= 0) {
      return;
    }
    try {
      mind.scaleFit();
    } catch {
      // A stale measurement heals on the next resize/refresh; never break.
    }
  };

  let resizeObserver = null;
  const observeSize = () => {
    if (typeof ResizeObserver === 'function' && resizeObserver === null) {
      resizeObserver = new ResizeObserver(fitMap);
      resizeObserver.observe(canvas);
    }
  };

  async function applyDescribed(described) {
    if (destroyed) {
      return;
    }
    try {
      const current = getText() ?? '';
      if (described.kind === 'paste' && described.targetLine === undefined) {
        const targetId = nodeIdOf(selectedId) ?? nodeIdOf(mind?.currentNode);
        described.targetLine = targetId === null ? null : resolveLine(targetId);
      }
      const outcome = applyMapOperation(current, described, resolveLine, pendingFresh);
      if (outcome === null || outcome.text === null) {
        await healRefresh();
        return;
      }
      if (outcome.text !== current) {
        try {
          onChange(outcome.text);
        } catch (error) {
          console.error('[mindmap-host] map change failed');
          await healRefresh();
          return;
        }
      }
      if (outcome.refresh) {
        await refresh();
      }
    } catch {
      if (!destroyed) {
        await healRefresh();
      }
    }
  }

  const handleOperation = (event) => {
    if (destroyed || !mind) {
      return;
    }
    const described = describeOperation(event);
    if (!described) {
      console.error('[mindmap-host] unsupported map operation', event?.name);
      void healRefresh();
      return;
    }
    if (described.kind === 'ignore') {
      return;
    }
    void applyDescribed(described);
  }

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
      style.textContent = css === '' ? MINDMAP_STYLE : `${css}\n${MINDMAP_STYLE}`;
      styleScope.append(style);
    }
    host.setAttribute('data-mindmap-root', '');
    if (bar) {
      bar.hidden = false;
    }
    canvas.textContent = '';
    mind = new MindElixir({
      el: canvas,
      direction: MindElixir.RIGHT,
      editable: true,
      keypress: true,
      draggable: true,
      allowUndo: false,
      contextMenu: false,
      toolBar: false,
      nodeMenu: false,
      newTopicName: MAP_NEW_TOPIC,
      markdown: renderInlineHtml,
      theme: { ...(dark ? MindElixir.DARK_THEME : MindElixir.THEME), generateSubBranch },
    });
    mind.bus.addListener('operation', handleOperation);
    mind.bus.addListener('selectNodes', handleSelect);
    mind.bus.addListener('unselectNodes', () => {
      selectedId = null;
    });
    mind.init(toMindElixirData(buildMindmapTree(parseMindmap(text))));
    fitMap();
    observeSize();
    return true;
  }

  // Node boxes are measured at layout time: a late webfont arrival resizes
  // them while link paths stay stale, so every finished font load replays
  // the current text. Skipped while an edit box is open (a rebuild would
  // discard the text under edit). The listener lives on the global set and
  // is removed on destroy.
  const healFonts = () => {
    if (destroyed || !mind || (canvas && canvas.querySelector('#input-box'))) {
      return;
    }
    try {
      const text = getText() ?? '';
      if (!isListOnlyDocument(text)) {
        return;
      }
      signature = mindmapSignature(text);
      lastData = toMindElixirData(buildMindmapTree(parseMindmap(text)));
      mind.refresh(lastData);
      selectedId = null;
      pendingFresh.clear();
      fitMap();
    } catch {
      // A later refresh heals; never break on a background relayout.
    }
  };
  const fontSet = typeof document !== 'undefined' ? document.fonts : null;
  if (fontSet && typeof fontSet.addEventListener === 'function') {
    fontSet.addEventListener('loadingdone', healFonts);
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
        lastData = toMindElixirData(buildMindmapTree(parseMindmap(getText() ?? '')));
        selectedId = null;
      }
    } catch {
      if (!destroyed) {
        showGuidance();
      }
    }
  }

  bar = buildBar();
  canvas = document.createElement('div');
  canvas.setAttribute('data-mindmap-canvas', '');
  host.append(bar, canvas);
  const ready = boot();
  host.addEventListener('click', handleBarClick);

  return {
    /**
     * Rebuilds the map when the text signature changed; shows guidance for
     * non-list documents. Also clears the fresh-id table: rebuilt nodes
     * carry source lines again. No-op after destroy.
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
          fitMap();
          selectedId = null;
          pendingFresh.clear();
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
      host.removeEventListener('click', handleBarClick);
      if (fontSet && typeof fontSet.removeEventListener === 'function') {
        fontSet.removeEventListener('loadingdone', healFonts);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      releaseInstance();
      pendingFresh.clear();
      host.textContent = '';
      bar = null;
      canvas = null;
    },
    ready,
  };
}
