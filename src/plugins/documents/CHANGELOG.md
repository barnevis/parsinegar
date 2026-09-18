# Changelog — parsinegar.documents

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
