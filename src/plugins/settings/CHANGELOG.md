# Changelog — parsinegar.settings

## [0.3.0]

### Added

- Accepted `filesSort` preference (one of the six files-view sort orders,
  defaulting to `updated-desc`); unknown values reject, old records backfill.

## [0.2.0]

### Added

- Accepted `sepia` theme value (validated like the other themes).

## [0.1.0]

### Added

- Validated user preferences over `pey.storage.service`: `getSettings`,
  `saveSettings` with defaults (`device` theme, `auto` direction, `16`px)
  and per-field validation.
- `settings:changed` event published on save.
- Runtime loss of `pey.storage.service` is reported as a critical error.
- Service implementation lives in `lib/settings-service.js`; `index.js`
  only wires `prepare`/`activate`.
