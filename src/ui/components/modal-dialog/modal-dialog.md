# `parsi-modal-dialog`

Page overlay element: renders the pending modal snapshot (delete confirmation or document properties) and reports gestures back as events. Markup comes from the pure renderers in `../workbench/modal.js`; this element only owns the shadow host, the stylesheet gate and the gesture mapping.

## Refs

Everything received through `connect(refs)`:

- `t` (translation, required — falls back to identity).
- `assetBaseUrl` (icon sprite resolution, optional).

## Config

`configure({ modal })` — `null` (closed), `{ kind: 'confirm', title }` or `{ kind: 'properties', title, createdText, updatedText, sizeText }` (values preformatted by the document controller). Re-renders on every call.

## Events

Bubbled `CustomEvent`s (composed):

- `modal-confirm` with `detail: { accepted }` — yes/no buttons of the delete confirmation.
- `modal-dismiss` — properties close button or backdrop click. Escape stays with the owning page.

## Constraints

- Emits nothing else; overlay dismissal state lives in the document controller, not here.
- Styling arrives only through `stylesheetHref()` (`modal-dialog.css`); the page must not reach into this shadow root.
