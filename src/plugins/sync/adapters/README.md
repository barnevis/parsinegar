# sync-target backend contract (kind `sync-target`)

Every backend (git, WebDAV, Drive, …) implements exactly this method set —
nothing outside it may be relied upon. Extra helper methods are allowed on
the object but are invisible to the engine.

All methods are async. Paths are posix-style, relative to the backend root,
UTF-8 text throughout.

- `open(config) → { kind, ... }`
  Validates reachability and credentials (one cheap read). Returns the
  normalized config the engine stores (never secrets in echoes). Throws on
  unreachable/invalid. Persists nothing — the engine owns all state.
- `listDir(path) → [{ path, rev }]`
  Recursive file listing under path (directories are traversed, never
  listed). A missing root reads as empty, never an error — `open()` already
  validated the backend itself.
- `readFile(path) → { content, rev } | null`
  Missing files return null (never throw): absence is data, not failure.
- `writeFile(path, content, rev?) → { rev }`
  Creates when rev is absent, replaces when present. A stale rev must throw
  a rev-mismatch error (never silently overwrite) — the engine fails the run
  so the next fresh read plans correctly.
- `deleteFile(path, rev?) → { ok: true }`
  Missing files succeed silently (idempotent deletes keep retries safe).
  Resolves rev internally when absent.

Error rules: thrown errors are `Error` with a machine-readable `code`
property (backend-prefixed, e.g. `GIT_AUTH_FAILED`) and a safe message —
no secrets, no file contents. Network failures and rate limits get their
own codes, distinct from auth/data errors, so the engine maps them
correctly.
