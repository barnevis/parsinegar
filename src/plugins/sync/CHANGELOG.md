# Changelog — pey.sync

## [Unreleased] — 0.2.0

### Added

- `hasPendingChanges({ scope })` reports local news against the last snapshot without any network (drives dirty indicators).
- Per-collection `ignore` scope field with gitignore-style matching (extension-free, no negation); ignored records skip push, pull, both-way deletes and conflicts.
- Typed error builders (`syncStartupError`, `syncCriticalError`) alongside `syncError`; adapter provenance rides `detail.adapterCode`.

### Changed

- Errors are plain Bonyan objects (`detail: null` by default) instead of `Error` instances, matching the Pey family shape.
- A 403 permission-denied maps to `SYNC_AUTH_FAILED` (rate limits still map by header); every request carries a 30-second deadline mapping hangs to `SYNC_NETWORK_FAILED`.
- Non-`SYNC_` failures inside `syncNow` are recorded and rethrown mapped instead of leaking raw.
- Backends register through a descriptor (`create`, `errorMap`, `manifestPath`, `revMismatchCode`); new kinds need no engine edit. Scope gains `contentField`; file extensions come from serializers.
- `syncNow` split into plan/apply/finalize phases; manifest `errors` matrices completed; the service-unavailable subscription unsubscribes on shutdown.

## [0.1.0] - 2026-10-15

### Added

- `configureBackend({ kind, params })` validates (live check) and stores one backend (git over GitHub Contents API in this version); secrets never leave the adapter boundary.
- `syncNow({ scope })` pushes local news, pulls remote news, propagates both-side deletions and stops on conflicts with both versions attached; snapshot advances only on clean completion, so partial runs simply retry.
- `resolveConflict({ collection, id, choice })` applies one side and advances the clock when none remain.
- `getStatus()` (redacted, with last sync time and last error) and `removeBackend()` (clears credentials and state, keeps local data).
- Pure decision engine (`snapshotDiff`, `planSync`, manifest build/parse, FNV content hashing that ignores volatile stamps) and content codecs (stable-key JSON, verbatim Markdown, file-name sanitizing).
- Structured errors (`SYNC_*`) and `sync:changed` / `sync:conflicts` events.
