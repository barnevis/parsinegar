# UI Component Index

Single-page application (`fa`, `rtl`).

| Tag | File | Role |
|---|---|---|
| `parsi-page-home` | `src/ui/pages/home/home.js` (+ `home-styles.js`, [doc](../../src/ui/pages/home/home.md)) | Workbench: menu bar, rail, side panel, editor, status bar |
| `parsi-page-not-found` | `src/ui/pages/not-found/not-found.js` ([doc](../../src/ui/pages/not-found/not-found.md)) | Fallback page |

Helper modules (not elements): `components/editor/` ([doc](../../src/ui/components/editor/editor.md): CodeMirror view controller, live preview, task list, text highlight), `components/workbench/` ([doc](../../src/ui/components/workbench/workbench.md): view registry, region renderers, menu model, stats, outline, html).

| Route | Page | Owner |
|---|---|---|
| `/` | `parsi-page-home` | `parsinegar.app` registers it |
| `/not-found` | `parsi-page-not-found` | `parsinegar.app` registers it |
