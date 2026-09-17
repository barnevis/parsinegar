# Changelog — parsinegar.settings

## [0.1.0]

### Added

- Validated user preferences over `pey.storage.service`: `getSettings`,
  `saveSettings` with defaults (`device` theme, `auto` direction, `16`px)
  and per-field validation.
- `settings:changed` event published on save.
- Runtime loss of `pey.storage.service` is reported as a critical error.
- Service implementation lives in `lib/settings-service.js`; `index.js`
  only wires `prepare`/`activate`.
