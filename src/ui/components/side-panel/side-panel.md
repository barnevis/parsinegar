# `parsi-side-panel`

Regular component: header plus the active side-panel view (files or outline). Mounted by `parsi-page-home`; see `../../pages/home/home.md` for the owning page.

## Purpose

Renders view markup through the `../workbench/views.js` registry, which holds only metadata and render references — each view owns its own markup. `configure()` re-renders only when the visible output would change (snapshot identity compare plus the outline signature), so per-keystroke updates from the parent stay cheap and never steal scroll or focus; the scrollable body additionally carries `data-pey-preserve`.

## Dependencies

Everything received through `connect(refs)`:

- **Services:** None.
- **Config values:** `t` (translation, required — falls back to identity), `assetBaseUrl` (icon sprite resolution, optional), `formatNumber` (number formatter for the settings view, optional — falls back to `String`), `activeView` (view id, optional — defaults to `files`), `items` (documents for the files view, optional), `currentId` (open document id, optional), `documentText` (current document text for text views, optional — defaults to `''`), `settings` (preferences snapshot for the settings view, optional).

## Public API

- `configure({ activeView, items, currentId, documentText, settings, activeLine })` — stores the snapshot and re-renders only on visible change; absent fields keep current values. Example: `side.configure({ items, currentId, documentText: page.value })`.

## Events

**Published** (all `bubbles: true`, `composed: true`):

- `side-close` — close-button request, no detail.
- `outline-jump` with `detail: { line }` — outline navigation target (1-based line number).
- `document-open` with `detail: { id }` — files-view open request.
- `document-create` — files-view create request, no detail.
- `document-delete` — files-view delete request, no detail.
- `settings-change` with `detail: { key, value }` — settings radio change (`key` is `theme` or `direction`); syntactic shape only, the parent and service validate.
- `settings-step` with `detail: { key, delta }` — font-size stepper intent (`key` is `fontSize`, `delta` is `+1`/`-1`); the parent computes and persists, the service clamps.

**Listened to:** `click` and `change` (declared in `eventTypes()`; `change` carries the radio-group selections).

## Local State

- `#t` — translation function.
- `#assetBaseUrl` — icon sprite base URL, or `null`.
- `#formatNumber` — number formatter for the settings view, or `null`.
- `#activeView`, `#items`, `#currentId`, `#documentText`, `#settings` — last applied panel data.
- `#activeLine` — highlighted outline heading line for scrollspy (compared by value in the snapshot).
- `#applied` — last rendered snapshot including the outline signature; the imminent first render paints exactly the `connect()` refs.

## Config

Covered under Dependencies above (`t`, `assetBaseUrl`, `activeView`, `items`, `currentId`, `documentText` with their fallbacks). No other config is read.

## Constraints

- Do not author view markup here; files/outline bodies belong to `../workbench/views-files.js` / `views-outline.js` and are reached only through the registry.
- An unknown `activeView` falls back to the files view rather than rendering nothing.
- Do not bypass the snapshot compare with unconditional re-renders; per-keystroke `configure()` calls must stay cheap.

## Related Decisions and Flows

- `../../../../docs/decisions.md` §8 (workbench composition), §9 (no business-data caching), §11 (child-composition exception).
- `../workbench/workbench.md`: `views.js`, `views-files.js`, `views-outline.js`, `outline.js` contracts.
