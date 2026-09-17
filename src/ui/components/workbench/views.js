// Side-panel view registry: metadata plus render references only.
//
// Holds no view logic itself — each view module owns its rendering; adding a
// view means writing its module and appending one entry here. Entries listed
// first render first; an entry with `align: 'end'` renders pinned to the far
// end of the rail (e.g. settings below the document views).
import { renderFilesView } from './views-files.js';
import { renderOutlineView } from './views-outline.js';
import { renderSettingsView } from './views-settings.js';

const FILES_VIEW = 'files';
const OUTLINE_VIEW = 'outline';
const SETTINGS_VIEW = 'settings';

const registry = [
  { id: FILES_VIEW, icon: 'files', labelKey: 'parsinegar.views.files', render: renderFilesView },
  { id: OUTLINE_VIEW, icon: 'outline', labelKey: 'parsinegar.views.outline', render: renderOutlineView },
  { id: SETTINGS_VIEW, icon: 'gear', labelKey: 'parsinegar.views.settings', render: renderSettingsView, align: 'end' },
];

/**
 * Lists all registered views in rail order.
 * @returns {Array<object>} View entries (copies).
 */
export function listViews() {
  return [...registry];
}

/**
 * Finds a view by id.
 * @param {string} id View id.
 * @returns {object|null} View entry or null.
 */
export function getView(id) {
  return registry.find((view) => view.id === id) ?? null;
}

export { FILES_VIEW, OUTLINE_VIEW, SETTINGS_VIEW };
