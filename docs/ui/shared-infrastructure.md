# UI Shared Infrastructure

- **Base class:** kit `PeyElement` (tested by the kit; not duplicated here).
- **Refs:** `services` (router + documents), `t`/`format` (fa catalog), `assetBaseUrl` (icon sprite), `direction` (editor direction).
- **Tokens:** surfaces map to `--pey-*` (`canvas`, `border`, `surface`, `text-muted`, `accent`, `focus-ring`) with fallbacks; see `home-styles.js`.
- **Icons:** app-owned `src/ui/assets/icons.svg` via kit `icon-sprite` helpers.
- **Fonts:** local Vazirmatn (`public/fonts/`), Persian digits via `format`.
- No shared-state store (single owner component), no UI Bus events published (only the `ui:component-error` declaration the base class needs).
