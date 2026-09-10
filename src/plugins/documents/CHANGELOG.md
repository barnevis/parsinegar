# Changelog — parsinegar.documents

## [0.1.0]

### Added

- Multi-document management over `pey.storage.service`: `listDocuments`,
  `openDocument`, `saveDocument`, `createDocument`, `deleteDocument` with
  automatic `updatedAt` timestamps.
- `documents:changed` event published on save and delete.
- Service implementation lives in `lib/documents-service.js`; `index.js`
  only wires `prepare`/`activate`.
