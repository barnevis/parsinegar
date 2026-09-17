# `parsi-activity-rail`

Regular component: icon buttons switching the side-panel view. Mounted by `parsi-page-home`; see `../../pages/home/home.md` for the owning page.

## Purpose

Stateless display of the available side-panel views, driven entirely by `configure()`. Views with `align: 'end'` in their registry entry render pinned to the far end of the rail (below the document views); all others stack from the start. Selection changes leave as `view-select` `CustomEvent`s; the parent owns the active view and toggles panel visibility, so this element never stores selection authoritatively.

## Dependencies

Everything received through `connect(refs)`:

- **Services:** None.
- **Config values:** `t` (translation, required — falls back to identity), `assetBaseUrl` (icon sprite resolution, optional — without it buttons degrade to text labels via `rail-fallback`), `views` (array of `{ id, icon, labelKey }` entries with optional `align: 'end'` pinning, optional — defaults to `[]`), `activeView` (active view id, optional).

## Public API

- `configure({ views, activeView })` — replaces the rail content and re-renders. Example: `rail.configure({ views: listViews(), activeView: 'files' })`.

## Events

**Published:** `view-select` with `detail: { id }`, `bubbles: true`, `composed: true`, on every view-button click (including clicking the already-active view — the parent decides whether that toggles the panel).

**Listened to:** `click` (declared in `eventTypes()`).

## Local State

- `#t` — translation function.
- `#assetBaseUrl` — icon sprite base URL, or `null`.
- `#views` — last received view entries (only replaced when an array arrives).
- `#activeView` — last received active view id, reflected as `aria-pressed`.

## Config

Covered under Dependencies above (`t`, `assetBaseUrl`, `views`, `activeView` with their fallbacks). No other config is read.

## Constraints

- Do not toggle selection internally; `aria-pressed` only mirrors what the parent passes down.
- Do not hardcode the view list; entries (id, icon, label key) arrive from the parent, sourced from the `../workbench/views.js` registry.

## Related Decisions and Flows

- `../../../../docs/decisions.md` §8 (workbench composition), §11 (child-composition exception).
- `../workbench/workbench.md`: `views.js` registry contract.
