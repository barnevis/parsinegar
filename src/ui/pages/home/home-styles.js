// Home page styles as an inline module (not a separate stylesheet).
//
// Kept as a plain string on purpose: the kit's external-stylesheet mechanism
// (stylesheetHref) gates the first render on an async fetch, which makes
// jsdom tests non-deterministic, while our renders are infrequent enough
// that re-parsing is negligible. Revisit if render frequency grows.
const HOME_CSS = `/* Home page stylesheet, attached through PeyElement.stylesheetHref().
   Surfaces map to --pey-* design tokens with fallbacks so the page follows
   the kit theme when tokens are overridden. */

:host {
  display: block;
  padding: 1rem 1rem 2rem;
}

[part="title"] {
  font-size: 1.5rem;
  margin: 0 0 0.25rem;
}

[part="subtitle"] {
  margin: 0 0 1rem;
  color: var(--pey-color-text-muted, #55555f);
}

[part="workbench"] {
  display: grid;
  grid-template-columns: auto minmax(12rem, 17rem) minmax(0, 1fr);
  grid-template-areas:
    "menubar menubar menubar"
    "rail side center"
    "status status status";
  gap: 0.75rem;
  align-items: start;
}

[part="menubar"] {
  grid-area: menubar;
  display: flex;
  gap: 0.25rem;
}

[part="menu"] {
  position: relative;
}

[part="menu-button"] {
  font: inherit;
  border: 1px solid transparent;
  border-radius: 8px;
  background-color: transparent;
  padding: 0.35rem 0.8rem;
  cursor: pointer;
  color: inherit;
}

[part="menu-button"][aria-expanded="true"] {
  border-color: var(--pey-color-border, #c8c8d2);
  background-color: var(--pey-color-canvas, #ffffff);
}

[part="menu-dropdown"] {
  position: absolute;
  inset-block-start: calc(100% + 0.25rem);
  inset-inline-start: 0;
  min-inline-size: 11rem;
  z-index: 10;
  display: flex;
  flex-direction: column;
  padding: 0.3rem;
  border: 1px solid var(--pey-color-border, #e2e2e8);
  border-radius: 10px;
  background-color: var(--pey-color-canvas, #ffffff);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.1);
}

[part="menu-dropdown"][hidden] {
  display: none;
}

[part="menu-item"] {
  font: inherit;
  text-align: start;
  border: 0;
  border-radius: 6px;
  background-color: transparent;
  padding: 0.4rem 0.6rem;
  cursor: pointer;
  color: inherit;
}

[part="menu-item"]:hover {
  background-color: var(--pey-color-surface, #f1f1f5);
}

[part="menu-item"][disabled] {
  opacity: 0.45;
  cursor: default;
}

[part="rail"] {
  grid-area: rail;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

[part="rail-button"] {
  font: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  inline-size: 2.75rem;
  block-size: 2.75rem;
  border: 1px solid transparent;
  border-radius: 8px;
  background-color: transparent;
  cursor: pointer;
  color: inherit;
}

[part="rail-button"] svg {
  inline-size: 1.4rem;
  block-size: 1.4rem;
}

[part="rail-fallback"] {
  display: none;
}

[part="rail-button"][aria-pressed="true"] {
  border-color: var(--pey-color-border, #c8c8d2);
  background-color: var(--pey-color-canvas, #ffffff);
}

[part="side"] {
  grid-area: side;
  border: 1px solid var(--pey-color-border, #e2e2e8);
  border-radius: 12px;
  background-color: var(--pey-color-canvas, #ffffff);
  overflow: hidden;
}

[part="side-header"] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 0.8rem;
  border-block-end: 1px solid var(--pey-color-border, #ececf1);
}

[part="side-title"] {
  font-size: 1rem;
  margin: 0;
}

[part="side-body"] {
  padding: 0.6rem 0.8rem;
  max-block-size: 60vh;
  overflow: auto;
}

[part="center"] {
  grid-area: center;
  min-inline-size: 0;
}

[part="doc-title"] {
  inline-size: 100%;
  box-sizing: border-box;
  font: inherit;
  font-weight: 700;
  padding: 0.4rem 0.6rem;
  margin-block-end: 0.75rem;
  border: 1px solid var(--pey-color-border, #d8d8de);
  border-radius: 8px;
  background-color: var(--pey-color-canvas, #ffffff);
  color: inherit;
}

[part="editor-host"] {
  overflow: hidden;
  background-color: var(--pey-color-canvas, #ffffff);
  border: 1px solid var(--pey-color-border, #e2e2e8);
  border-radius: 12px;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px rgb(0 0 0 / 0.07);
  padding: 2rem 2.25rem;
  cursor: text;
}

[part="editor-host"] .cm-editor {
  min-block-size: 65vh;
}

[part="statusbar"] {
  grid-area: status;
  display: flex;
  gap: 1.25rem;
  padding: 0.45rem 0.9rem;
  border: 1px solid var(--pey-color-border, #e2e2e8);
  border-radius: 10px;
  background-color: var(--pey-color-canvas, #ffffff);
  font-size: 0.85rem;
}

[part="stat-value"] {
  font-weight: 700;
}

[part="menu-button"]:focus-visible,
[part="menu-item"]:focus-visible,
[part="rail-button"]:focus-visible,
[part="doc-title"]:focus-visible,
[part="docs-open"]:focus-visible,
[part="outline-jump"]:focus-visible {
  outline: 2px solid var(--pey-color-focus-ring, #0b5bd3);
  outline-offset: 2px;
}

@media (max-width: 56rem) {
  [part="workbench"] {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "menubar"
      "rail"
      "center"
      "side"
      "status";
  }

  [part="rail"] {
    flex-direction: row;
  }

  [part="editor-host"] {
    padding: 1.25rem 1rem;
  }
}
`;
export { HOME_CSS };
