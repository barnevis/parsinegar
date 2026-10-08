# Changelog — parsinegar.documents

## [0.5.0]

### Added

- Disk origin tracking: `saveDocument`/`createDocument` carry an optional `origin` filename (preserved across overwrites like the lock); folder re-imports match on it so in-app renames survive.

## [0.4.0]

### Added

- Nested browser folders: `listFolders`, `createFolder(name, parentId?)`, `renameFolder`, cascade `deleteFolder`, `moveDocument(id, folderId?)`; `folders:changed` event; `folderId` on records (older records backfill to the root).
- `createDocument` accepts an optional `folderId`; `saveDocument` preserves the stored folder unless the input states it explicitly.

## [0.3.0]

### Added

- `readOnly` flag on records (defaults to `false`, backfilled for older records).
- `setReadOnly(id, readOnly)` to lock/unlock a document for reading, publishing `documents:changed`.
- `saveDocument` preserves the stored lock unless `input.readOnly` states it explicitly.

## [0.2.0] - 1405-06-27

### Added

- `renameDocument(id, title)` with duplicate and empty-title rejection.
- `createdAt` timestamp on records (preserved by saves, backfilled from `updatedAt`).
- Unique titles enforced on save; `createDocument` suffixes with Persian digits until free.
- `DOCUMENT_TITLE_DUPLICATE` and `DOCUMENT_INVALID_TITLE` structured errors.

## [0.1.0]

### Added

- Multi-document management over `pey.storage.service`: `listDocuments`, `openDocument`, `saveDocument`, `createDocument`, `deleteDocument` with automatic `updatedAt` timestamps.
- `documents:changed` event published on save and delete.
- Service implementation lives in `lib/documents-service.js`; `index.js` only wires `prepare`/`activate`.
