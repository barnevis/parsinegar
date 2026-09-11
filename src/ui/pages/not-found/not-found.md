# `parsi-page-not-found`

Fallback page for unknown routes and the `/not-found` path. Renders a translated message with a return button that navigates home through `pey.router.service` (from refs) — never through the History API directly.

## Refs

- `services['pey.router.service']` — navigation.
- `t` — translation.
