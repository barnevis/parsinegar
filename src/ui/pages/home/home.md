# `parsi-page-home`

Page-level component: the single workbench page, mounted by the kit page host on `/`. See `../../../docs/ui/user-flows.md` for the journeys it participates in. It owns the layout plus the CodeMirror editor, and mounts four child elements for the workbench regions (see `../../components/workbench/workbench.md`): `parsi-menu-bar`, `parsi-activity-rail`, `parsi-side-panel`, `parsi-status-bar`.

## Composition

`render()` outputs only `<div data-slot="…">` placeholders; `#attachChildren()` (scheduled after render lands via `utils/mount.js`) mounts or reconfigures each child through `mountComponent`, passing data snapshots through `onConnect({ infrastructure, refs })` plus `configure(snapshot)` on every update. Children talk back only through bubbled `CustomEvent`s handled declaratively here. The editor itself stays helper-mounted (third-party widget, not an element).

## Dependencies

Everything received through `connect(refs)`:

- **Services:** the full required-services map (currently `pey.router.service` + `parsinegar.documents.service`, both `required` in `src/ui/manifest.json`). This component uses only `parsinegar.documents.service` (list/open/save/create/delete); the router entry is present but unused. Without the documents service it degrades to in-memory editing of the sample (no save) — an explicit fallback, since the manifest still requires the service for the UI as a whole.
- **Config values:** `t` (translation, required — falls back to identity), `format` (locale-aware formatting, optional — falls back to `String`), `assetBaseUrl` (icon sprite resolution, optional — rail degrades to text labels), `direction` (`ltr`/`rtl`, optional — defaults to `rtl`).
- **Event Bus facade:** `events` (scoped `{ subscribe, publish }`, optional — forwarded to children as `infrastructure.events`; see `../../../docs/decisions.md` §11). Without it only the editor is available; editing never breaks.
- **Route params:** `routeParams`/`routeQuery` arrive via `defaultConnect` but are ignored; the page has no parameterized routes.

## Public API

- `value` — current Markdown text. Example: `page.value` returns the draft being edited (or the last saved content).
- `setDocument(text)` — replaces the editor content and schedules a save. Example: `page.setDocument('# سلام')`.

## Events

**Published (`ui:*`):** None — this component publishes nothing on the Event Bus.

**Listened to (domain events):** None — `subscriptions()` is not overridden.

Child-to-parent notification (plain bubbled DOM `CustomEvent`s, handled in `handleEvent`):

- `menu-action` with `detail: { action }` — string action ids (`new-document`, `delete-document`, `undo`, `redo`, `toggle-side`, `toggle-status`).
- `view-select` with `detail: { id }` — rail view switch.
- `side-close` — side panel close request.
- `outline-jump` with `detail: { line }` — outline navigation target.
- `document-open` with `detail: { id }`, `document-create`, `document-delete` — files-view management.

DOM page-level notification (not a bus event, declared nowhere because the manifest only governs `ui:*`): `parsi-page-home:changed` with `detail: { value }`, `bubbles: true`, `composed: true`, dispatched on every edit for future consumers.

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
- `#activeView`, `#sideOpen`, `#bottomOpen` — purely presentational (rail selection, panel visibility).
- `#menuEl`, `#railEl`, `#sideEl`, `#statusEl` — mounted child handles, refreshed by `#attachChildren()`; live stats/side content is pushed via `#pushLiveUpdates()` calling `configure()` (never a full re-render, so editor focus and undo history survive).
- `#confirmDeleteId` — pending delete-confirmation target rendered as a modal by the page itself.
- `#events` — scoped Event Bus facade forwarded to children (see Dependencies).

## Config

Covered under Dependencies above (`t`, `format`, `assetBaseUrl`, `direction` with their fallbacks). No other config is read.

## Constraints

- Do not mount this element directly or nest it; only the kit page host mounts it, after calling `connect()` with the Entry Point refs.
- Do not call `pey.storage.service` from here (or bypass `parsinegar.documents.service`); store layout and timestamp policy belong to that plugin.
- Do not re-render on keystrokes: stats and side content sync through child `configure()` outside `render()` (see `../../../docs/decisions.md` §8) so editor focus and undo history survive.
- Do not query inside children: each child owns its `shadowRoot`; the page only passes snapshots down and receives events up.

## Related Decisions and Flows

- `../../../docs/decisions.md` §5 (single-element workbench origin), §7 (storage split), §8 (workbench composition), §9 (audit hardening), §11 (child-composition exception).
- `../../../docs/ui/user-flows.md`: boot → editor, edit → autosave, switch/create/delete, outline jump.
