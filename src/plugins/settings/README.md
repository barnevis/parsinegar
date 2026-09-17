# parsinegar.settings

Application plugin for Parsinegar: validated user preferences (theme, document direction, editor font size) over `pey.storage.service`, with defaults.

## Structure

- `manifest.json` — authoritative plugin contract.
- `index.js` — Bonyan `prepare` and `activate` entry points (wiring only).
- `lib/settings-service.js` — service implementation with defaults and validation.
- `tests/settings.test.js` + `tests/settings-service.test.js` — plugin tests.
- `docs/reference.md` — complete self-contained reference.
- `CHANGELOG.md` — version history of this plugin.

## Dependencies

- **Required:** `pey.storage.service` — record persistence; all methods fail clearly without it. Runtime loss is reported as a critical error.
- **Optional:** none.

## See Also

- `docs/reference.md` for the full service and event contract.
- `parsinegar.documents` for the sibling storage-backed plugin pattern.
