# parsinegar.documents

Application plugin for Parsinegar: multi-document management for Markdown records over `pey.storage.service`, with automatic `updatedAt` timestamps.

## Structure

- `manifest.json` — authoritative plugin contract.
- `index.js` — Bonyan `prepare` and `activate` entry points.

## Dependencies

- **Required:** `pey.storage.service` — record persistence; all methods fail clearly without it.
- **Optional:** none.

## See Also

See [`reference.md`](reference.md) for the full API/events/errors/config/business-rules/constraints reference.
