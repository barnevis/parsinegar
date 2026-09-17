# UI User Flows

- **Boot → editor:** Core starts plugins → UI mounts shell → home lists documents (creates the welcome document on first launch) → editor shows the most recent document.
- **Edit → autosave:** typing updates the draft, stats and the change event; after 1s idle the document saves and the list refreshes.
- **Switch/create/delete:** pending save flushes first, then the target document loads; deleting the last document creates a fresh untitled one.
- **Outline jump:** rail → outline view → heading click moves the cursor (marks stay hidden except on the active line).
- **Settings:** rail gear → settings view → theme (light/dark/device), document direction (auto/rtl/ltr) or font-size stepper; each change validates in the settings service, persists, and applies (theme via the entry-point bridge, direction/font size via editor remount); everything survives reload.
- **Unknown route:** router redirects to `/not-found`; the return button navigates home through `RouterService`.
