// Installs the shared jsdom environment for Web Component tests.
import { JSDOM, VirtualConsole } from 'jsdom';

const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', () => {});

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/ui/index.html',
  pretendToBeVisual: true,
  virtualConsole,
});

for (const [name, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  customElements: dom.window.customElements,
  HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  HTMLSelectElement: dom.window.HTMLSelectElement,
  Node: dom.window.Node,
  Event: dom.window.Event,
  CustomEvent: dom.window.CustomEvent,
  KeyboardEvent: dom.window.KeyboardEvent,
  MouseEvent: dom.window.MouseEvent,
  MutationObserver: dom.window.MutationObserver,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
})) {
  globalThis[name] = value;
}

globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.HTMLCollection = dom.window.HTMLCollection;
globalThis.NodeList = dom.window.NodeList;

// jsdom has no matchMedia; mind-elixir (the map library) reads it on init.
dom.window.matchMedia = (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
});

export { dom };
