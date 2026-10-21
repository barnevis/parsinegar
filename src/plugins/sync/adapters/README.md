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
- `writeFile(path, content, rev?, options?) → { rev }`
  Creates when rev is absent, replaces when present. A stale rev must throw
  a rev-mismatch error (never silently overwrite) — the engine fails the run
  so the next fresh read plans correctly. `options.message` (optional,
  engine-supplied custom commit text) is backend-appropriate to use as the
  commit message of this write when the backend builds commits; absent or
  empty means the backend's own automatic message (`pey.sync write ${path}`).
- `deleteFile(path, rev?, options?) → { ok: true }`
  Missing files succeed silently (idempotent deletes keep retries safe).
  Resolves rev internally when absent. `options.message` follows the same
  rule with `pey.sync delete ${path}` as the automatic fallback.

Error rules: thrown errors are `Error` with a machine-readable `code`
property (backend-prefixed, e.g. `GIT_AUTH_FAILED`) and a safe message —
no secrets, no file contents. Network failures and rate limits get their
own codes, distinct from auth/data errors, so the engine maps them
correctly.

## Registering a kind

Backends register through a descriptor — no engine edit needed:

```js
export const webdavAdapterDescriptor = {
  kind: 'webdav',
  create: (params, fetchFn) => createWebdavAdapter({ ...params, fetchFn }),
  errorMap: { DAV_AUTH_FAILED: 'SYNC_AUTH_FAILED' /* … */ },
  revMismatchCode: 'DAV_REV_MISMATCH', // optional; without it every
                                       // failure maps through errorMap
  // optional: normalizes config params before open() — the service then
  // persists and echoes exactly what the backend will use (gitlab uses it
  // to normalize baseUrl and reject a bad URL before the first request)
  normalizeParams: (params) => params,
};
```

Pass `{ webdav: webdavAdapterDescriptor }` (plus `git` and `gitlab`) as
`adapters` on the service state from the host entry point. `errorMap`
translates every adapter code the backend throws; unmapped codes become
`SYNC_NETWORK_FAILED` with the adapter code preserved in
`detail.adapterCode`. `revMismatchCode` names the concurrent-write signal
the engine turns into `SYNC_CONCURRENT_CHANGE`. The remote side holds no
engine metadata: any file placed by the engine is a host-collection
document, so backends must not reserve or create extra files.
