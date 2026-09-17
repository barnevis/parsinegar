# parsinegar.settings Reference

## Purpose

Application plugin for Parsinegar: validated user preferences over `pey.storage.service`. A single `preferences` record in the `settings` collection holds the whole set; readers always receive a complete object merged over defaults.

## Structure

- `manifest.json` — authoritative plugin contract.
- `index.js` — Bonyan `prepare` and `activate` entry points (wiring only).
- `lib/settings-service.js` — service implementation.
- `tests/` — plugin tests mirroring the source files.
- `docs/reference.md` — this file.
- `CHANGELOG.md` — version history of this plugin.

## Dependencies

- **Required:** `pey.storage.service` — record persistence; all methods fail clearly without it. If the service disappears at runtime after activation, the plugin reports a critical error.
- **Optional:** none.

## Public API

**Service:** `parsinegar.settings.service`. Settings are `{ theme, direction, fontSize }`:

- `theme`: `'light'`, `'dark'`, `'device'` (follow the operating system) or `'sepia'`.
- `direction`: `'auto'`, `'rtl'` or `'ltr'` — base direction of the edited document.
- `fontSize`: integer editor font size in pixels, `12`–`24`.

Defaults are `{ theme: 'device', direction: 'auto', fontSize: 16 }`.

### `getSettings()`

Reads the stored preferences merged over defaults; a missing record returns defaults, and invalid stored values fall back per field.

```js
const settings = await service.getSettings();
// => { theme: 'device', direction: 'auto', fontSize: 16 }
```

### `saveSettings(patch)`

Validates the patch, merges it over current settings, stores the result and publishes `settings:changed`. Unknown fields are ignored; known fields with invalid values reject with `SETTINGS_INVALID_VALUE` naming the field, and nothing is stored or published.

```js
const settings = await service.saveSettings({ theme: 'dark' });
// => { theme: 'dark', direction: 'auto', fontSize: 16 }
```

## Events

- `settings:changed` with `{ id: 'preferences' }` — published after preferences are saved. Listeners re-read through `getSettings()`.

## Errors

Boundary errors use the standard structure (`code`, `message`, `source`, `type`, `timestamp`, `detail`):

- `SETTINGS_INVALID_VALUE` (operational) — a known patch field failed validation; `detail.field` names it.
- `SETTINGS_STORAGE_UNAVAILABLE` (operational) — called before activation or after deactivation.
- `REQUIRED_DEPENDENCY_LOST` (critical) — reported to the Core when `pey.storage.service` disappears at runtime.
