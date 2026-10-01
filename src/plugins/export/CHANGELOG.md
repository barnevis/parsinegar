# Changelog — parsinegar.export

## [0.1.0]

### Added

- `exportHtml({ markdown, title?, theme? })` renders Markdown with Persian extensions over `pey.markdown.service` and assembles a standalone RTL document (`lang="fa" dir="rtl"`) with minimal inline light/dark/sepia CSS.
- Local `==highlight==` micromark extension to `<mark>` (attention-based, nested formatting kept).
- Structured errors (`EXPORT_INVALID_THEME`, `EXPORT_MARKDOWN_UNAVAILABLE`, `EXPORT_RENDER_FAILED`) and `core:service-unavailable` reporting.
