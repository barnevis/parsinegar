# Changelog — parsinegar.export

## [0.2.0]

### Added

- `exportZip({ documents })` packs `{ markdown, title?, path? }` records into one Markdown zip archive (`{ blob, filename: 'parsinegar-documents.zip', mime: 'application/zip' }`) via `@zip.js/zip.js` (native CompressionStream, no workers). Folder paths survive per-segment sanitizing, `..` segments collapse, repeat full paths take a ` (2)` suffix. Structured errors `EXPORT_INVALID_INPUT` and `EXPORT_ZIP_FAILED`.
- Shared `lib/file-names.js` for the file-name rule (used by both exports).

## [0.1.0]

### Added

- `exportHtml({ markdown, title?, theme? })` renders Markdown with Persian extensions over `pey.markdown.service` and assembles a standalone RTL document (`lang="fa" dir="rtl"`) with minimal inline light/dark/sepia CSS.
- Local `==highlight==` micromark extension to `<mark>` (attention-based, nested formatting kept).
- Structured errors (`EXPORT_INVALID_THEME`, `EXPORT_MARKDOWN_UNAVAILABLE`, `EXPORT_RENDER_FAILED`) and `core:service-unavailable` reporting.
