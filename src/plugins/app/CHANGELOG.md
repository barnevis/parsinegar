# Changelog — parsinegar.app

## [0.2.0]

### Added

- First service, `parsinegar.app.service`: `wipeAllData()` wipes every
  bootstrapped collection (documents, folders, settings, disk drafts, sync
  backend and state) in one atomic cross-collection storage transaction and
  returns per-collection record counts; publishes no event (the UI reset
  flow reloads the page right after). Requires `pey.storage.service`;
  subscribes to `core:service-unavailable` for it (critical
  `REQUIRED_DEPENDENCY_LOST`).

## [0.1.0]

### Added

- Route catalog ownership for version 1 (`/` and `/not-found`) with
  registration in `pey.router.service` during `activate`.
