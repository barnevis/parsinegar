# `parsi-page-home`

Page-level component: the single workbench page, mounted by the kit page host on `/`. See `../../../docs/ui/user-flows.md` for the journeys it participates in. It owns the layout plus the CodeMirror editor, and mounts five child elements for the workbench regions and overlays: `parsi-menu-bar` ([doc](../../components/menu-bar/menu-bar.md)), `parsi-activity-rail` ([doc](../../components/activity-rail/activity-rail.md)), `parsi-side-panel` ([doc](../../components/side-panel/side-panel.md)), `parsi-status-bar` ([doc](../../components/status-bar/status-bar.md)) and `parsi-modal-dialog` ([doc](../../components/modal-dialog/modal-dialog.md)). Pure helpers behind them are documented in `../../components/workbench/workbench.md`. Stateful orchestration lives in plain companion modules below (not in the element): `document-controller.js`, `settings-applier.js` and `scroll-spy.js`.

## Companion modules

- `document-controller.js` — `createDocumentController({ documents, t, format, isLive, readEditorContent })`: the document working set (list snapshot, open id/title/draft, autosave timer, delete-confirmation target, properties record). Answers with plain data (`{ apply, items }`, outcome strings); the page adopts records after unmounting the editor (unmount parks old content into the draft, so adopting earlier would be overwritten) and owns every child handle and DOM effect. No DOM, no elements, no events.
- `settings-applier.js` — `createSettingsApplier({ settingsApi, isLive })`: preferences snapshot plus applied editor traits (direction, font size), serialized writes, and the OS color-scheme watcher. Answers `'applied'`/`'ignored'`/`'failed'`; the page remounts the editor on `applied`.
- `scroll-spy.js` — `createScrollSpy({ getVisibleLine, getText, onActiveLine, isLive })`: watches the scrolling center column, maps the first visible editor line to its heading and pushes changes (rAF-collapsed, never steals focus).
- `../utils/format.js` — shared locale-aware `formatNumber`/`formatDate` with plain fallbacks.

## Composition

`render()` outputs only `<div data-slot="…">` placeholders (including `modal`); `#attachChildren()` (scheduled after render lands via `utils/mount.js`) mounts or reconfigures each child through `mountComponent`, passing data snapshots through `onConnect({ infrastructure, refs })` plus `configure(snapshot)` on every update. Children talk back only through bubbled `CustomEvent`s handled declaratively here. The editor itself stays helper-mounted (third-party widget, not an element).

## Dependencies

Everything received through `connect(refs)`:

- **Services:** the full required-services map (`pey.router.service` + `parsinegar.documents.service` + `parsinegar.settings.service`, all `required` in `src/ui/manifest.json`). This component uses documents (list/open/save/create/delete) and settings (`getSettings`/`saveSettings`); the router entry is present but unused. Without the documents service it degrades to in-memory editing of the sample (no save) — an explicit fallback, since the manifest still requires the service for the UI as a whole. Without the settings service, direction and font size stay on built-in fallbacks (`rtl`, `16px`) and settings events are ignored; editing never breaks.
- **Config values:** `t` (translation, required — falls back to identity), `format` (locale-aware formatting, optional — falls back to `String`), `assetBaseUrl` (icon sprite resolution, optional — rail degrades to text labels). `direction` arrives but is intentionally ignored: the shell owns app-chrome direction while the edited document follows stored settings (see `../../../docs/decisions.md` §12).
- **Config values:** `t` (translation, required — falls back to identity), `format` (locale-aware formatting, optional — falls back to `String`), `assetBaseUrl` (icon sprite resolution, optional — rail degrades to text labels). `direction` arrives but is intentionally ignored (see above).
- **Event Bus facade:** `events` (scoped `{ subscribe, publish }`, optional — forwarded to children as `infrastructure.events`; see `../../../docs/decisions.md` §11). Without it only the editor is available; editing never breaks.
- **Route params:** `routeParams`/`routeQuery` arrive via `defaultConnect` but are ignored; the page has no parameterized routes.

## Public API

- `value` — current Markdown text. Example: `page.value` returns the draft being edited (or the last saved content).
- `setDocument(text)` — replaces the editor content and schedules a save. Example: `page.setDocument('# سلام')`.

## Events

**Published (`ui:*`):** None — this component publishes nothing on the Event Bus.

**Listened to (domain events):** None — `subscriptions()` is not overridden.

Child-to-parent notification (plain bubbled DOM `CustomEvent`s, handled in `handleEvent`):

- `menu-action` with `detail: { action }` — string action ids (`new-document`, `import-document`, `delete-document`, `about` (swaps the center column to the static about pane; the editor stays mounted underneath), `undo`, `redo`, `toggle-side`, `toggle-status`, plus `insert-<kind>` for the nine supported marks, inserted through the editor controller and refocused).
- `view-select` with `detail: { id }` — rail view switch.
- `files-sort` with `detail: { mode }` — files-view ordering (validated against `FILES_SORT_MODES`); owned here so it survives panel remounts.
- `side-close` — side panel close request.
- `outline-jump` with `detail: { line }` — outline navigation target.
- `document-open` with `detail: { id }`, `document-create`, `document-import`, `document-delete` — files-view management (delete carries the file-menu target id and arms the confirmation modal for that document, falling back to the open document when no id travels, e.g. the top menu-bar action; import opens the system file picker and imports the chosen Markdown file as a new document).
- `modal-confirm` with `detail: { accepted }` — yes/no buttons of the delete confirmation (from `parsi-modal-dialog`).
- `modal-dismiss` — properties close button or backdrop click (from `parsi-modal-dialog`; Escape stays a page-level keydown).
- `document-rename` with `detail: { id, title }` — inline rename commit; empty titles cancel, taken titles keep the editor open with an inline error, success refreshes the list.
- `document-download` with `detail: { id }` — downloads the document as Markdown through a temporary anchor (no-op where object URLs are unavailable).
- `document-properties` with `detail: { id }` — opens the properties modal (name, creation/last-edit dates, size).
- `settings-change` with `detail: { key, value }` — persisted through the settings service (whitelisted to `theme`/`direction` with non-empty strings); the saved snapshot replaces `#settings` and remounts the editor. Theme itself reaches the shell through the `settings:changed` domain event handled by the entry point.
- `settings-step` with `detail: { key, delta }` — persisted as a single font-size step (`fontSize` key, `±1` delta); out-of-range steps reject in the service and change nothing.

Rapid settings events serialize through a write chain (`#chainSettingWrite`) so back-to-back changes apply in order instead of racing on stale reads.

DOM page-level notification (not a bus event, declared nowhere because the manifest only governs `ui:*`): `parsi-page-home:changed` with `detail: { value }`, `bubbles: true`, `composed: true`, dispatched on every edit for future consumers.

## Local State

- `#docs` — document controller (working set, autosave timer, overlay targets; see Companion modules). Snapshots, never edited in place.
- `#prefs` — settings applier (preferences snapshot, applied direction/font size, OS scheme watcher).
- `#spy` — outline scrollspy (watched column, pending frame, active heading line).
- `#editor` — CodeMirror controller handle (released on disconnect).
- `#editorHost` — host node identity the editor is mounted into; a full
  re-render detaches the view while the handle stays set, so mounting tracks
  the node, not the handle.
- `#renderObserver` — render-completion observer that mounts the editor (the
  first render may wait behind the stylesheet gate, so microtask order cannot
  be relied on); disconnected on disconnect.
- `#activeView`, `#sideOpen`, `#bottomOpen` — purely presentational (rail selection, panel visibility).
- `#centerView` — center column mode (`editor`/`about`). The swap is imperative (hidden attributes plus pane insertion, no render): a full render replaces the shadow DOM, which would destroy the editor-host node and force an editor remount losing undo. `render()` already reflects the mode, so any later render reconciles the same state; opening any document resets it to `editor`.
- `#filesSort` — files-view ordering (default `updated-desc`); presentational like the view switch, so it lives here rather than in the panel, whose fields reset on every page render.
- `#menuEl`, `#railEl`, `#sideEl`, `#statusEl`, `#modalEl` — mounted child handles, refreshed by `#attachChildren()`; live stats/side content is pushed via `#pushLiveUpdates()` calling `configure()` (never a full re-render, so editor focus and undo history survive).
- `#events` — scoped Event Bus facade forwarded to children (see Dependencies).

## Config

Covered under Dependencies above (`t`, `format`, `assetBaseUrl`, `direction` with their fallbacks). No other config is read.

## Constraints

- Do not mount this element directly or nest it; only the kit page host mounts it, after calling `connect()` with the Entry Point refs.
- Do not call `pey.storage.service` from here (or bypass `parsinegar.documents.service`); store layout and timestamp policy belong to that plugin.
- Do not re-render on keystrokes: stats and side content sync through child `configure()` outside `render()` (see `../../../docs/decisions.md` §8) so editor focus and undo history survive.
- Do not query inside children: each child owns its `shadowRoot`; the page only passes snapshots down and receives events up.

## Related Decisions and Flows

- `../../../docs/decisions.md` §5 (single-element workbench origin), §7 (storage split), §8 (workbench composition), §9 (audit hardening), §11 (child-composition exception), §12 (settings).
- `../../../docs/ui/user-flows.md`: boot → editor, edit → autosave, switch/create/delete, outline jump.
