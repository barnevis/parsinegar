# `parsi-menu-bar`

Regular component: dropdown menus (file, edit, insert, view) plus the find/replace dropdown for the workbench. Mounted by `parsi-page-home`; see `../../pages/home/home.md` for the owning page.

## Purpose

Renders the menu structure from the pure `menu-model.js` data and owns its open-menu state locally, so menu interaction never re-renders the parent page (which would drop editor focus and undo history). Menu actions leave the element as `menu-action` `CustomEvent`s for the parent to map to behavior. The search form (pure `../workbench/search-form.js`) lives in a second dropdown pinned to the bar end (visual left in RTL): it owns the transient form values locally, reports every keystroke and action as `search-*` events, and displays the result the parent echoes back through `configure()`. Typing state survives those re-renders through `data-pey-preserve` on the inputs (value, selection, focus) and action buttons (focus).

## Dependencies

Everything received through `connect(refs)`:

- **Services:** None.
- **Config values:** `t` (translation, required — falls back to identity), `hasDocument` (boolean, optional — defaults to `false`; enables document-dependent items such as delete, and the search toggle), `formatNumber` (optional — counter digits, falls back to `String`), `assetBaseUrl` (optional — search-toggle icon, degrades to an empty button without it).

## Public API

- `configure({ hasDocument })` — updates menu capabilities (e.g. after a document opens or closes) and re-renders. Example: `menu.configure({ hasDocument: true })`.
- `configure({ searchOpen, search, searchFocus })` — drives the search dropdown: `searchOpen` shows/hides it (opening focuses the query input, or the replace input with `searchFocus: 'replace'`), `search` replaces the displayed form state (`{ query, replace, caseSensitive, wholeWord, regexp, inSelection, count, invalidRegexp, replaced }`), and `search: null` resets the form to defaults. Example: `menu.configure({ searchOpen: true, search: { query: 'a', count: { current: 1, total: 2 } } })`.

## Events

**Published:** `menu-action` with `detail: { action }`, `bubbles: true`, `composed: true`. Action ids are plain strings (`new-document`, `delete-document`, `undo`, `redo`, `toggle-side`, `toggle-status`) defined by `../workbench/menu-model.js`.

Search events (all `bubbles: true`, `composed: true`, with the form spec as detail) for the parent to run against the editor:

- `search-query` — query/replace/flag changed (per keystroke / per toggle).
- `search-next`, `search-previous`, `search-replace-one`, `search-replace-all` — action buttons (and Enter in the inputs steps next).
- `search-close` — explicit close (toggle or Escape inside/outside the form): the parent clears the editor highlight and resets the form. Outside clicks only hide the dropdown visually (no event, highlight stays).

**Listened to:** `click`, `input`, `change`, `keydown` (declared in `eventTypes()`); plus document-level `click` (outside-hide) and `keydown` (Escape closes) listeners registered in `connectedCallback` and removed in `disconnectedCallback`. The in-form Escape handler stops propagation so the document-level one does not emit `search-close` twice.

## Local State

- `#t` — translation function.
- `#hasDocument` — whether a document is open (drives item `disabled` flags).
- `#openMenu` — currently open menu id, or `null`.
- `#searchOpen` — whether the search dropdown is shown.
- `#search` — displayed form state (values plus the last echoed `count` / `invalidRegexp` / `replaced`).
- `#formatNumber`, `#assetBaseUrl` — counter digits and toggle icon (see Dependencies).

## Config

Covered under Dependencies above (`t`, `hasDocument` with their fallbacks). No other config is read.

## Constraints

- Do not map actions to behavior here; the parent owns every behavior behind the string ids.
- Do not add menu domains here alone: new menus/items start in `../workbench/menu-model.js` (pure data, tested in isolation), this element only renders them.

## Related Decisions and Flows

- `../../../../docs/decisions.md` §8 (workbench composition), §11 (child-composition exception), §15 (in-document search).
- `../workbench/workbench.md`: `menu-model.js` contract.
