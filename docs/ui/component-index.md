# UI Component Index

Single-page application (`fa`, `rtl`).

| Tag | File | Role |
|---|---|---|
| `parsi-page-home` | `src/ui/pages/home/home.js` (+ `home.css`, [doc](../../src/ui/pages/home/home.md)) | Workbench shell: mounts four child elements plus the CodeMirror editor |
| `parsi-menu-bar` | `src/ui/components/workbench/menu-bar.js` | Menu bar; emits `menu-action` |
| `parsi-activity-rail` | `src/ui/components/workbench/activity-rail.js` | View-switch rail; emits `view-select` |
| `parsi-side-panel` | `src/ui/components/workbench/side-panel.js` | Files/outline side panel; emits `document-*`, `outline-jump`, `side-close` |
| `parsi-status-bar` | `src/ui/components/workbench/status-bar.js` | Live stats bar (display-only) |
| `parsi-page-not-found` | `src/ui/pages/not-found/not-found.js` ([doc](../../src/ui/pages/not-found/not-found.md)) | Fallback page |

Helper modules (not elements): `components/editor/` ([doc](../../src/ui/components/editor/editor.md): CodeMirror view controller, live preview, task list, text highlight), `components/workbench/` ([doc](../../src/ui/components/workbench/workbench.md): view registry, view-body renderers, menu model, stats, outline, html, modal), `utils/mount.js` (child-composition mount helper).

| Route | Page | Owner |
|---|---|---|
| `/` | `parsi-page-home` | `parsinegar.app` registers it |
| `/not-found` | `parsi-page-not-found` | `parsinegar.app` registers it |
