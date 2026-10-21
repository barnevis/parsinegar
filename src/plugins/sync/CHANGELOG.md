# Changelog — pey.sync

## [0.4.0] - 2026-10-21

### Added

- `syncNow({ scope, message })` accepts an optional `message`: it is applied verbatim (trimmed, max 200 chars) as the commit subject of every write and delete this round performs. Absent or blank keeps the automatic per-path messages. Conflict-resolution writes and legacy-artifact cleanup always keep the automatic messages.

### Changed

- Sync-target contract (`adapters/README.md`): `writeFile` and `deleteFile` gained an optional `options` bag with `options.message`; skipping it or leaving `message` empty falls back to each backend's automatic default.

## [0.3.0] - 2026-10-19

### Changed

- Sync identity is now the remote path itself: `sync-manifest.json` is written no more, the git repository only sees real documents. Collections of files in `folders/` from 0.2.0 stay invisible until migrated (one round sweeps them).
- The snapshot (`sync_state`) moved to version 2 — path-keyed `{collection, id, path, hash, rev}` — with an automatic in-place migration that seeds hashes from a still-valid legacy manifest in the same round.
- Folder records are never synced as data; a pulled document's directory chain is rebuilt locally from its path (empty folders do not resurrect on a fresh device, and a folder rename with no documents leaves no remote trace).
- Conflict previews are content-only: the remote side no longer carries a timestamp (git does not expose one).

### Added

- `SYNC_PATH_COLLISION`: two local records claiming the same remote path error out with both ids before any remote write, instead of silently overwriting.
- Revision shortcut: paths whose listing revision matches the snapshot skip content reads entirely, so a clean round costs one tree listing.

### Fixed

- First pull of a remote text document into an empty library minted no record id, and a null storage key was rejected by `pey.storage` (IndexedDB `keyPath: 'id'`) — the round died mid-pull under `SYNC_STORAGE_UNAVAILABLE` («Sync storage unreachable») after the pushes: files landed on the remote while the pulled document never reached Parsinegar. Text pulls mint their id at apply time now.

### Removed

- `SYNC_CORRUPT_MANIFEST` and the adapter-descriptor `manifestPath` field: no remote metadata exists to corrupt.

## [0.2.0] - 2026-10-16

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
