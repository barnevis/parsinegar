# Workbench helpers (`components/workbench/`)

This folder owns the side-panel regions of the workbench page that are not services-backed views with their own lifecycle: the view registry, the region renderers, the menu model, pure text analytics and shared markup helpers. Everything here is a pure function of explicit arguments — no services, no DOM access, no component state.

## Modules

- `views.js` — side-panel registry: metadata plus render references only (`listViews()`, `getView(id)`); holds no view logic itself, so a future view is one module plus one entry here.
- `views-files.js` — `renderFilesView({ t, items, currentId })`: document list with management actions.
- `views-outline.js` — `renderOutlineView({ t, documentText })`: heading outline with navigation targets.
- `regions.js` — region renderers (`renderRail`, `renderSide`, `renderMenubar`, `renderStatusbar`) composing registry output, menu model and stats into page regions.
- `menubar.js` — `buildMenuModel({ t, hasDocument })`: menu bar as pure data with string action ids the page maps to behavior.
- `stats.js` — `countStats(text)`: characters (with spaces), whitespace-split words (half-space safe), lines.
- `outline.js` — `parseOutline(text)`: ATX headings as `[{ level, text, line }]` with 1-based lines.
- `html.js` — `escapeHtml(value)` shared by every template that interpolates user content.

## Contracts

- Render functions return HTML strings; the owning page inserts them and wires every behavior through its own declarative handlers.
- User content must pass through `escapeHtml` before interpolation, without exception.
