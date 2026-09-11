# `parsi-page-not-found`

Page-level component: fallback page for unknown routes and the `/not-found` path. Mounted by the kit page host (regular and `notFound` slot).

## Dependencies

Everything received through `connect(refs)`:

- **Services:** the full required-services map; this component uses only `pey.router.service` (`navigate`), declared `required` in
  `src/ui/manifest.json`.
- **Config values:** `t` (translation, required — falls back to identity).
- **Route params:** none expected (ignored if present).

## Public API

None beyond `connect()`.

## Events

**Published (`ui:*`):** None.

**Listened to (domain events):** None.

## Local State

None. The page is fully static after render.

## Config

`t` only (see Dependencies).

## Constraints

- Do not manipulate browser history directly; all navigation goes through `RouterService`.
- Do not mount this element directly; only the kit page host mounts it.

## Related Decisions and Flows

- `../../../docs/ui/user-flows.md`: unknown route flow.
