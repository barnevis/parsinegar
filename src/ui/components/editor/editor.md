# Editor helpers (`components/editor/`)

This folder owns everything that creates and styles the CodeMirror Markdown view. It contains no custom elements on purpose: a `PeyElement` child cannot be nested declaratively (connect-before-insertion plus the render-cycle rule forbid it), so the owning page renders the host node and mounts the view through the controller factory here.

## Modules

- `markdown-view.js` — `createMarkdownView(host, options)` controller factory (`getValue`, `setDocument`, `focus`, `undo`, `redo`, `gotoLine`, `visibleLine()`, `insertMark(kind)`, `destroy`); owns the extension list, the layout-independent select-all handler, the `direction` option (`rtl`/`ltr`/`auto`, default `rtl`; `auto` sets `dir="auto"` and detects per line while keeping an rtl base, so the caret stays right on empty lines), the `fontSize` option (integer pixels 12–24, default 16) and the `colorScheme` option (`light`/`dark`/`sepia`, default `light`). `insertMark` reuses the `toggle-mark.js` commands programmatically (unknown kinds fail safe with `false`). `visibleLine()` answers the first visible line at the editor top in viewport coordinates, so it works no matter which ancestor scrolls.
- `editor-theme.js` — `editorColorScheme(scheme)`: dark and sepia CodeMirror overrides (text, selection, cursor, active line, gutters, highlight wash). Values are literals mirroring `public/theme.css` because head-injected editor styles cannot resolve shell-scoped tokens; the light scheme needs no extension.
- `live-preview.js` — single-pane live preview: a private `HighlightStyle` with stable `parsi-*` classes (never the generated hashed classes), the hiding/styling theme, quote/list/code-fence line decorations, list-marker widgets and a mark-reveal plugin; `livePreviewExtensions()` composes them. Hidden marks reopen only where the cursor (or selection) overlaps them — everywhere else on the line they stay hidden.
- `task-list.js` — `- [ ]` / `- [x]` checkbox widgets with click-to-toggle (`ignoreEvent() === false` so the toggle handler runs; position carried on the widget, never measured), `TASK_LINE_PATTERN`, `toggledBox()`; `taskListExtensions()` composes them.
- `line-direction.js` — `isNeutralLine(text)` plus `lineDirectionExtensions(base)`: pins letter-less lines (empty, digits, bare marks) to the base direction through line decorations, because Chromium resolves `plaintext` lines without a strong character as left-to-right regardless of the base. Strong lines keep the `plaintext` handling untouched.
- `text-highlight.js` — `==highlight==` decorations (inner text plus hidden delimiters, revealed on the active line); the light wash is fixed yellow with pinned dark ink, while dark (lime) and sepia (amber) washes arrive through `editor-theme.js`; multiline spans are not supported.

## Contracts

- No module here touches services, the Core, or the Event Bus; options and callbacks arrive as explicit arguments.
- CodeMirror owns its own listeners until the controller's `destroy()` releases them.
- Marks hide with zero font size (never `display:none`) so cursor, selection and bidi ordering keep working at mark positions.
