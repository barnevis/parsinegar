# `parsi-status-bar`

Regular component: live document statistics display (characters, words, lines). Mounted by `parsi-page-home`; see `../../pages/home/home.md` for the owning page.

## Purpose

Pure display driven entirely by `configure()`; emits nothing. Number formatting is injected by the parent, so locale digits (e.g. Persian) are the parent's decision, not this element's.

## Dependencies

Everything received through `connect(refs)` plus `configure()`:

- **Services:** None.
- **Config values:** `t` (translation, required — falls back to identity), `stats` (`{ chars, words, lines }`, via `configure()` — defaults to zeros), `formatNumber` (number formatter, via `configure()` — falls back to `String`).

## Public API

- `configure({ stats, formatNumber })` — replaces the displayed statistics and re-renders. Example: `status.configure({ stats: countStats(text), formatNumber: (n) => format(n) })`.

## Events

**Published:** None — this component dispatches nothing.

**Listened to:** None — no `eventTypes()` override, no `handleEvent()`.

## Local State

- `#t` — translation function.
- `#stats` — last received `{ chars, words, lines }` (never computed here).
- `#formatNumber` — last received formatter, or `null`.

## Config

Covered under Dependencies above (`t`, `stats`, `formatNumber` with their fallbacks). No other config is read.

## Constraints

- Display-only: do not compute statistics here (counting lives in `../workbench/stats.js`) and do not emit events.
- Do not format numbers locally; every value passes through the injected `formatNumber`.

## Related Decisions and Flows

- `../../../../docs/decisions.md` §8 (workbench composition), §9 (no business-data caching), §11 (child-composition exception).
- `../workbench/workbench.md`: `stats.js` contract.
