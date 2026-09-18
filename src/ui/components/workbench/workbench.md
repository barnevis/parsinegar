# Workbench helpers (`components/workbench/`)

This folder owns the pure helper modules behind the workbench page: no services, no DOM access, no component state. The four child elements live in their own folders — `../menu-bar/` ([doc](../menu-bar/menu-bar.md)), `../activity-rail/` ([doc](../activity-rail/activity-rail.md)), `../side-panel/` ([doc](../side-panel/side-panel.md)), `../status-bar/` ([doc](../status-bar/status-bar.md)) — and are mounted by `parsi-page-home` (see `../../pages/home/home.md`). Children talk back only through bubbled `CustomEvent`s the page handles declaratively.

## Pure helper modules

- `views.js` — side-panel registry: metadata plus render references only (`listViews()`, `getView(id)`); holds no view logic itself, so a future view is one module plus one entry here. Order is rail order: files, outline, settings; an entry with `align: 'end'` pins its rail button to the far end.
- `views-files.js` — `renderFilesView({ t, items, currentId, openMenuId, editing, assetBaseUrl })`: document list with management actions; each row carries a menu button opening the per-file menu (rename, download, properties, delete), and the editing row renders an inline rename input with an optional error.
- `views-outline.js` — `renderOutlineView({ t, documentText, activeLine })`: heading outline with navigation targets; the heading on `activeLine` renders with `aria-current` (scrollspy highlight).
- `views-settings.js` — `renderSettingsView({ t, settings, formatNumber })`: theme/direction radio groups plus the font-size stepper. Pure display; controls report through `settings-change` (`{ key, value }`) and `settings-step` (`{ key, delta }`) events that `parsi-side-panel` forwards to the page. Validation and persistence live in the settings service, never here; out-of-range steps simply reject there and change nothing.
- `menu-model.js` — `buildMenuModel({ t, hasDocument })`: menu bar as pure data consumed by `parsi-menu-bar`.
- `stats.js` — `countStats(text)`: characters (with spaces), Unicode letters (no whitespace, digits, punctuation or half-space joiners), whitespace-split words (half-space safe), lines, UTF-8 bytes; `formatFileSize(bytes, formatNumber, t)`: bytes or kilobytes with one decimal.
- `outline.js` — `parseOutline(text)`: ATX headings as `[{ level, text, line }]` with 1-based lines; `outlineSignature(value)` for cheap change detection.
- `html.js` — `escapeHtml(value)` shared by every template that interpolates user content; `iconMarkup(base, name)` for sprite icons.
- `modal.js` — `renderConfirmModal({ t, title, assetBaseUrl })`: delete-confirmation dialog rendered by the page itself; `renderPropertiesModal({ t, title, createdText, updatedText, sizeText, assetBaseUrl })`: document properties dialog with preformatted values.

## Contracts

- Child elements receive data only through `onConnect({ infrastructure, refs })` plus `configure(snapshot)`; they never query outside their own `shadowRoot`.
- Children keep no service references; the one Event Bus crossing is the facade the page passes down as `infrastructure.events`.
- Render helpers return HTML strings; user content must pass through `escapeHtml` before interpolation, without exception.
