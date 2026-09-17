# UI Entry Point

`src/ui/index.js` (adapted from the `pey.webui` application template) mounts the shell, builds the page-host with the `/` + `/not-found` catalog, and performs the initial route mount (route registration publishes before the UI subscribes — see `../decisions.md`).

Hands pages `{ services, t, format, assetBaseUrl, direction }` as refs (`services` carries `pey.router.service`, `parsinegar.documents.service` and `parsinegar.settings.service`, all `required` in `src/ui/manifest.json`). Cleanup is synchronous in `context.onShutdown` (unsubscribe settings, clear the store, remove the document theme, dispose host, remove shell); `core:shutdown` is notification-only.

## Theme bridge

The Entry Point owns the runtime theme: it creates the kit's UI-local shared-state store (`createSharedState`), hands it to the shell (which reflects `theme` as `data-theme`), reads the stored theme once at startup, and re-applies it on every `settings:changed` domain event (serialized through a write chain so rapid saves converge in order). Each apply writes the same value to both the store and `document.documentElement.dataset.theme` — the document scope carries the dark token overrides in `public/theme.css`, which head-injected editor styles can also resolve. See `../decisions.md` §12.
