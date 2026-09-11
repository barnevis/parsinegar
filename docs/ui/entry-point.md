# UI Entry Point

`src/ui/index.js` (adapted from the `pey.webui` application template) mounts the shell, builds the page-host with the `/` + `/not-found` catalog, and performs the initial route mount (route registration publishes before the UI subscribes — see `../decisions.md`).

Hands pages `{ services, t, format, assetBaseUrl, direction }` as refs. Cleanup is synchronous in `context.onShutdown` (dispose host, remove shell); `core:shutdown` is notification-only.
