# parsinegar.documents

Application plugin for Parsinegar: multi-document management for Markdown records over `pey.storage.service`, with automatic `updatedAt` timestamps.

## Structure

- `manifest.json` — authoritative plugin contract.
- `index.js` — Bonyan `prepare` and `activate` entry points (wiring only).
- `lib/documents-service.js` — service implementation.
- `tests/documents.test.js` + `tests/documents-service.test.js` — plugin tests.
- `docs/reference.md` — complete self-contained reference.
- `CHANGELOG.md` — version history of this plugin.

## Dependencies

- **Required:** `pey.storage.service` — record persistence; all methods fail clearly without it.
- **Optional:** none.

## See Also

See [`docs/reference.md`](docs/reference.md) for the full API/events/errors/config/business-rules/constraints reference.
