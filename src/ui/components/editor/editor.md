# Editor helpers (`components/editor/`)

This folder owns everything that creates and styles the CodeMirror Markdown view. It contains no custom elements on purpose: a `PeyElement` child cannot be nested declaratively (connect-before-insertion plus the render-cycle rule forbid it), so the owning page renders the host node and mounts the view through the controller factory here.

## Modules

- `markdown-view.js` — `createMarkdownView(host, options)` controller factory (`getValue`, `setDocument`, `focus`, `undo`, `redo`, `gotoLine`, `destroy`); owns the extension list, the layout-independent select-all handler and the `direction` option (`ltr`/`rtl`, default `rtl`).
- `live-preview.js` — single-pane live preview: a private `HighlightStyle` with stable `parsi-*` classes (never the generated hashed classes), the hiding/styling theme, quote/list/code-fence line decorations and list-marker widgets; `livePreviewExtensions()` composes them.
- `task-list.js` — `- [ ]` / `- [x]` checkbox widgets with click-to-toggle (`ignoreEvent() === false` so the toggle handler runs; position carried on the widget, never measured), `TASK_LINE_PATTERN`, `toggledBox()`; `taskListExtensions()` composes them.
- `text-highlight.js` — `==highlight==` decorations (inner text plus hidden delimiters, revealed on the active line); multiline spans are not supported.

## Contracts

- No module here touches services, the Core, or the Event Bus; options and callbacks arrive as explicit arguments.
- CodeMirror owns its own listeners until the controller's `destroy()` releases them.
- Marks hide with zero font size (never `display:none`) so cursor, selection and bidi ordering keep working at mark positions.
