# Workbench (`components/workbench/`)

This folder owns the workbench regions of the home page in two layers: pure
helper modules (no services, no DOM access, no component state) and four child
elements mounted by the page through the shared mount helper. Children talk
back only through bubbled `CustomEvent`s the page handles declaratively.

## Child elements (mounted by `parsi-page-home`)

- `menu-bar.js` — `parsi-menu-bar` with `configure({ hasDocument })`; emits `menu-action` with string action ids the page maps to behavior.
- `activity-rail.js` — `parsi-activity-rail` with `configure({ views, activeView })`; emits `view-select` with the view id.
- `side-panel.js` — `parsi-side-panel` with `configure({ activeView, items, currentId, documentText })`; emits `document-open`, `document-create`, `document-delete`, `outline-jump` and `side-close`.
- `status-bar.js` — `parsi-status-bar` with `configure({ stats, formatNumber })`; display-only, emits nothing.

## Pure helper modules

- `views.js` — side-panel registry: metadata plus render references only (`listViews()`, `getView(id)`); holds no view logic itself, so a future view is one module plus one entry here.
- `views-files.js` — `renderFilesView({ t, items, currentId })`: document list with management actions.
- `views-outline.js` — `renderOutlineView({ t, documentText })`: heading outline with navigation targets.
- `menu-model.js` — `buildMenuModel({ t, hasDocument })`: menu bar as pure data consumed by `parsi-menu-bar`.
- `stats.js` — `countStats(text)`: characters (with spaces), whitespace-split words (half-space safe), lines.
- `outline.js` — `parseOutline(text)`: ATX headings as `[{ level, text, line }]` with 1-based lines; `outlineSignature(value)` for cheap change detection.
- `html.js` — `escapeHtml(value)` shared by every template that interpolates user content; `iconMarkup(base, name)` for sprite icons.
- `modal.js` — `renderConfirmModal({ t, title, assetBaseUrl })`: delete-confirmation dialog rendered by the page itself.

## Contracts

- Child elements receive data only through `onConnect({ infrastructure, refs })` plus `configure(snapshot)`; they never query outside their own `shadowRoot`.
- Children keep no service references; the one Event Bus crossing is the facade the page passes down as `infrastructure.events`.
- Render helpers return HTML strings; user content must pass through `escapeHtml` before interpolation, without exception.
