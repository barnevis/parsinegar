# parsinegar.documents Reference

## Purpose

Application plugin for Parsinegar: multi-document management for Markdown records over `pey.storage.service`, with automatic `updatedAt` timestamps.

## Structure

- `manifest.json` — authoritative plugin contract.
- `index.js` — Bonyan `prepare` and `activate` entry points (wiring only).
- `lib/documents-service.js` — service implementation.
- `tests/` — plugin tests mirroring the source files.
- `docs/reference.md` — this file.
- `CHANGELOG.md` — version history of this plugin.

## Dependencies

- **Required:** `pey.storage.service` — record persistence; all methods fail clearly without it.
- **Optional:** none.

## Public API

**Service:** `parsinegar.documents.service`. Records are `{ id, title, content, createdAt, updatedAt }` stored in the `documents` collection.

### `listDocuments()`

Lists all documents ordered by most recently updated first (storage has no ordering, so the plugin sorts).

```js
const documents = await service.listDocuments();
// => [{ id: '...', title: '...', content: '...', updatedAt: 1700000000000 }]
```

### `openDocument(id)`

Reads one document by id, or `null` when it does not exist.

```js
const document = await service.openDocument('doc-id');
// => record or null
```

### `saveDocument(input)`

Creates or overwrites a document, stamps `updatedAt`, publishes `documents:changed`. Missing `id` generates one; missing/empty `title` becomes `بدون عنوان`; missing `content` becomes `''`. A title already carried by another record rejects with `DOCUMENT_TITLE_DUPLICATE`; the creation timestamp of an existing record is preserved.

```js
const saved = await service.saveDocument({ id: 'doc-id', title: 'یادداشت', content: '# سلام' });
```

### `createDocument(title)`

Creates a new empty document, suffixing the title (`title ۲`, …) until it is unique.

```js
const created = await service.createDocument('ایده‌ها');
```

### `renameDocument(id, title)`

Renames a document by id, stamps `updatedAt`, publishes `documents:changed`. Returns `null` when the id does not exist. Empty titles reject with `DOCUMENT_INVALID_TITLE`; taken titles with `DOCUMENT_TITLE_DUPLICATE`.

```js
const renamed = await service.renameDocument('doc-id', 'تازه');
```

### `deleteDocument(id)`

Deletes a document by id (no-op when absent), publishes `documents:changed`.

```js
await service.deleteDocument('doc-id');
```

## Events

| Event | When | Data |
|---|---|---|
| `documents:changed` | After a document is saved, renamed or deleted. | `{ id }` |

This plugin listens to no events.

## Errors Reference

Storage failures (e.g. `STORE_NOT_FOUND`, `QUOTA_EXCEEDED`) propagate unchanged from `pey.storage.service`. Calling any method before local activation throws a plain `Error` naming the missing service — unreachable in normal startup after settlement. Validation failures use the standard structure:

- `DOCUMENT_TITLE_DUPLICATE` (operational, `detail: { field: 'title' }`) — another record already carries the title.
- `DOCUMENT_INVALID_TITLE` (operational, `detail: { field: 'title' }`) — empty rename title.

## Config

No config keys. Store layout (`documents` collection with `keyPath: id`) is project configuration in `bootstrap.json`, not plugin config.

## Business Rules

- Every saved record carries `updatedAt` set at save time; callers cannot override it.
- Every record carries `createdAt`, set once at creation and preserved by later saves; records stored before it existed fall back to `updatedAt`.
- Titles are unique across records: saving or renaming onto a taken title rejects (the record itself is excluded when updating). `createDocument` suffixes with Persian digits until free.
- Listing order is always most-recently-updated first.
- `openDocument` never throws for a missing id — it returns `null`.
- `deleteDocument` never throws for a missing id — storage delete is a no-op then.
- Every save and every delete publishes exactly one `documents:changed` with the affected `id`.

## Constraints

- Do not bypass this plugin from the UI to call `pey.storage.service` directly; the store layout and timestamp policy belong here.
- Do not store anything but document records in the `documents` collection.
- `updatedAt` is set exclusively by `saveDocument`; do not accept caller timestamps.
