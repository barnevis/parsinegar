# `parsi-page-home`

Workbench page: menu bar, activity rail, switchable side panel (files / outline), Markdown editor and live status bar. Mounted by the kit page host on `/`; the only page-level component besides not-found.

## Refs (from the Entry Point)

- `services['parsinegar.documents.service']` — document persistence (optional: without it the page edits the in-memory sample and never saves).
- `t`, `format` — translation and locale-aware formatting.
- `assetBaseUrl` — icon sprite resolution (rail icons degrade to text without it).
- `direction` — editor writing direction (`ltr`/`rtl`, default `rtl`).

## States

- **loading** — service present, documents not yet loaded (empty regions).
- **ready** — current document in the editor; list reflects the last fetch.
- No error state: load/save failures log to console and keep the last consistent state (single-user local app; see decisions #7).

## Public API

- `value` — current Markdown text.
- `setDocument(text)` — replaces content and schedules a save.

## Events

- `parsi-page-home:changed` (`{ value }`, bubbles + composed) on every edit.
