# Changelog — pey.sync

## [0.1.0] - 2026-10-15

### Added

- `configureBackend({ kind, params })` validates (live check) and stores one backend (git over GitHub Contents API in this version); secrets never leave the adapter boundary.
- `syncNow({ scope })` pushes local news, pulls remote news, propagates both-side deletions and stops on conflicts with both versions attached; snapshot advances only on clean completion, so partial runs simply retry.
- `resolveConflict({ collection, id, choice })` applies one side and advances the clock when none remain.
- `getStatus()` (redacted, with last sync time and last error) and `removeBackend()` (clears credentials and state, keeps local data).
- Pure decision engine (`snapshotDiff`, `planSync`, manifest build/parse, FNV content hashing that ignores volatile stamps) and content codecs (stable-key JSON, verbatim Markdown, file-name sanitizing).
- Structured errors (`SYNC_*`) and `sync:changed` / `sync:conflicts` events.
