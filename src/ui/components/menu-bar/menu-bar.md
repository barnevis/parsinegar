# `parsi-menu-bar`

Regular component: brand plus dropdown menus (file, edit, view) for the workbench. Mounted by `parsi-page-home`; see `../../pages/home/home.md` for the owning page.

## Purpose

Renders the menu structure from the pure `menu-model.js` data and owns its open-menu state locally, so menu interaction never re-renders the parent page (which would drop editor focus and undo history). Menu actions leave the element as `menu-action` `CustomEvent`s for the parent to map to behavior.

## Dependencies

Everything received through `connect(refs)`:

- **Services:** None.
- **Config values:** `t` (translation, required — falls back to identity), `hasDocument` (boolean, optional — defaults to `false`; enables document-dependent items such as delete).

## Public API

- `configure({ hasDocument })` — updates menu capabilities (e.g. after a document opens or closes) and re-renders. Example: `menu.configure({ hasDocument: true })`.

## Events

**Published:** `menu-action` with `detail: { action }`, `bubbles: true`, `composed: true`. Action ids are plain strings (`new-document`, `delete-document`, `undo`, `redo`, `toggle-side`, `toggle-status`) defined by `../workbench/menu-model.js`.

**Listened to:** `click` (declared in `eventTypes()`); plus document-level `click` (outside-close) and `keydown` (Escape closes) listeners registered in `connectedCallback` and removed in `disconnectedCallback`.

## Local State

- `#t` — translation function.
- `#hasDocument` — whether a document is open (drives item `disabled` flags).
- `#openMenu` — currently open menu id, or `null`.

## Config

Covered under Dependencies above (`t`, `hasDocument` with their fallbacks). No other config is read.

## Constraints

- Do not map actions to behavior here; the parent owns every behavior behind the string ids.
- Do not add menu domains here alone: new menus/items start in `../workbench/menu-model.js` (pure data, tested in isolation), this element only renders them.

## Related Decisions and Flows

- `../../../../docs/decisions.md` §8 (workbench composition), §11 (child-composition exception).
- `../workbench/workbench.md`: `menu-model.js` contract.
