# `parsi-page-home`

Page-level component: the single workbench page (menu bar, activity rail, switchable side panel, editor, status bar), mounted by the kit page host on `/`. See `../../../docs/ui/user-flows.md` for the journeys it participates in.

## Dependencies

Everything received through `connect(refs)`:

- **Services:** the full required-services map (currently `pey.router.service` + `parsinegar.documents.service`, both `required` in `src/ui/manifest.json`). This component uses only `parsinegar.documents.service` (list/open/save/create/delete); the router entry is present but unused. Without the documents service it degrades to in-memory editing of the sample (no save) — an explicit fallback, since the manifest still requires the service for the UI as a whole.
- **Config values:** `t` (translation, required — falls back to identity), `format` (locale-aware formatting, optional — falls back to `String`), `assetBaseUrl` (icon sprite resolution, optional — rail degrades to text labels), `direction` (`ltr`/`rtl`, optional — defaults to `rtl`).
- **Route params:** `routeParams`/`routeQuery` arrive via `defaultConnect` but are ignored; the page has no parameterized routes.

## Public API

- `value` — current Markdown text. Example: `page.value` returns the draft being edited (or the last saved content).
- `setDocument(text)` — replaces the editor content and schedules a save. Example: `page.setDocument('# سلام')`.

## Events

**Published (`ui:*`):** None — this component publishes nothing on the Event Bus.

**Listened to (domain events):** None — `subscriptions()` is not overridden.

DOM child-to-parent notification (not a bus event, declared nowhere because the manifest only governs `ui:*`): `parsi-page-home:changed` with `detail: { value }`, `bubbles: true`, `composed: true`, dispatched on every edit for future consumers.

## Local State

- `#items` — last fetched document list. Looks like business data, but it is only ever a render snapshot: refreshed from the service before every render and re-read after every save (see `../../../docs/decisions.md` §9). Never edited in place as a source of truth.
- `#currentId`, `#docTitle`, `#draft` — open-document working set, rewritten on every document switch.
- `#editor` — CodeMirror controller handle (released on disconnect).
- `#editorHost` — host node identity the editor is mounted into; a full
  re-render detaches the view while the handle stays set, so mounting tracks
  the node, not the handle.
- `#renderObserver` — render-completion observer that mounts the editor (the
  first render may wait behind the stylesheet gate, so microtask order cannot
  be relied on); disconnected on disconnect.
- `#saveTimer` — pending autosave handle (cleared on disconnect).
- `#activeView`, `#sideOpen`, `#bottomOpen`, `#openMenu` — purely presentational (rail selection, panel visibility, open menu).

## Config

Covered under Dependencies above (`t`, `format`, `assetBaseUrl`, `direction` with their fallbacks). No other config is read.

## Constraints

- Do not mount this element directly or nest it; only the kit page host mounts it, after calling `connect()` with the Entry Point refs.
- Do not call `pey.storage.service` from here (or bypass `parsinegar.documents.service`); store layout and timestamp policy belong to that plugin.
- Do not re-render on keystrokes: stats and menu visibility sync outside `render()` (see `../../../docs/decisions.md` §8) so editor focus and undo history survive.

## Related Decisions and Flows

- `../../../docs/decisions.md` §5 (single-element workbench), §7 (storage split), §8 (render exceptions), §9 (audit hardening).
- `../../../docs/ui/user-flows.md`: boot → editor, edit → autosave, switch/create/delete, outline jump.
