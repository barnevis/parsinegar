# AGENTS.md — Parsinegar

Parsinegar is a Persian (RTL) Markdown editor built on the Pey plugin architecture. Single-page workbench, live CodeMirror 6 editing, local persistence. **No bundler**: native ESM + importmap, served statically.

## Commands

```sh
npm install
npm start     # static server on the repo root (serves node_modules/ for the importmap)
npm test      # node:test + jsdom: "tests/**/*.test.js" "src/**/*.test.js"
```

Requirements: Node >= 20. The server must serve the repo root so that `node_modules/` and `bootstrap.json` resolve. `npm start` uses `--single` so SPA routes fall back to `index.html`.

## Architecture (Bonyan 0.11)

- Domain logic lives in **plugins** (`src/plugins/`); the UI (`src/ui/` on `pey.webui`) talks to them **only through services** —   never around them.
- `bootstrap.json` (schemaVersion 2) is the only place adapters, plugins and UI routes are declared. `index.html` owns the importmap.
- Pey packages and `parsneshan` are installed straight from GitHub and
  **pinned** — do not upgrade them casually:
  `@pey/core#v0.2.2`, `pey.webui#v1.0.0`, `pey.router#v1.0.0`,
  `pey.storage#v0.4.0`, `pey.markdown#v1.0.0`, `parsneshan#v0.2.0`.
  Exception: `pey.filesystem` incubates locally in `src/plugins/filesystem/`
  (future independent Pey plugin; see `docs/decisions.md` §24) — it is
  versioned and bootstrap-registered like the other local plugins.
- Sources of truth: `docs/architecture.md` (boundaries), `docs/decisions.md` (recorded decisions, referenced as §N).
  **Record every new architectural decision there (in Persian)** before or with the code — do not let behavior live only in chat history.

## Code conventions

- ESM throughout, kebab-case file/variable names.
- No decorative comments. Comments explain *why*, concisely.
- UI strings are Persian (say «سند», never file/document in user-facing text); code identifiers stay English.
- Icons: Google Material Symbols via `src/ui/assets/icons.svg`, `currentColor` only.
- UI contract (`pey.webui`): `connect({infrastructure,refs})` once before insertion; parents render only `<div data-slot>`; mount children with `scheduleAttachments` + `mountComponent`; children report upward only via bubbling `CustomEvent`s.

## Testing

- `node:test` + `jsdom`. Every behavior gets a test; the suite must be green before finishing (pre-existing skips stay skipped).
- jsdom cannot do layout: coordinate/visual behavior (click mapping, caret placement, floats, wrapping) is verified with throwaway headless-Chromium probes against a local static server — then **delete the probe files and kill the servers**.
- Prefer position-free assertions (ranges, classes, decoration sets) over DOM measurement; never assert on hashed/generated class names (use the stable `parsi-*` classes).

## Docs to keep in sync

- `CHANGELOG.md` — user-visible changes, newest on top.
- Co-located `*.md` next to the code they describe (e.g. `src/ui/components/editor/editor.md`, `menu-bar.md`).
- `docs/userGuide.md` — end-user behavior (Persian, read-only in-app).
- `README.md` — feature list, repo map, plugin table. Keep its version pins and structure accurate when they change.

## Working habits

- Verify through execution (run tests, probe visuals); do not claim fixes from reading code alone.
- Keep diffs minimal and scoped; prefer editing existing files over creating new ones.
- The agent proposes a **one-line commit message**; it never commits, pushes, or opens PRs unless explicitly asked.
- Never commit secrets; check `git status`/`git diff` before proposing a message so only intended files are included.
