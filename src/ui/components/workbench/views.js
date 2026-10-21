// Side-panel view registry: metadata plus render references only.
//
// Holds no view logic itself — each view module owns its rendering; adding a
// view means writing its module and appending one entry here. Entries listed
// first render first; an entry with `align: 'end'` renders pinned to the far
// end of the rail (e.g. settings below the document views). An entry with
// `area: 'center'` is a rail button switching the center stage instead of
// the side panel (today only the mindmap); it never becomes `activeView`.
import { renderFilesView } from './views-files.js';
import { renderOutlineView } from './views-outline.js';
import { renderSettingsView } from './views-settings.js';
import { renderSyncView } from './views-sync.js';
import { renderAboutView } from './views-about.js';
import { renderHelpView } from './views-help.js';

const FILES_VIEW = 'files';
const OUTLINE_VIEW = 'outline';
const SYNC_VIEW = 'sync';
const ABOUT_VIEW = 'about';
const HELP_VIEW = 'help';
const SETTINGS_VIEW = 'settings';
const MINDMAP_VIEW = 'mindmap';

const registry = [
  { id: FILES_VIEW, icon: 'file-copy', labelKey: 'parsinegar.views.files', render: renderFilesView },
  { id: OUTLINE_VIEW, icon: 'toc', labelKey: 'parsinegar.views.outline', render: renderOutlineView },
  { id: MINDMAP_VIEW, icon: 'account-tree', labelKey: 'parsinegar.views.mindmap', area: 'center' },
  { id: SYNC_VIEW, icon: 'sync', labelKey: 'parsinegar.views.sync', render: renderSyncView },
  { id: ABOUT_VIEW, icon: 'logo', labelKey: 'parsinegar.about.title', render: renderAboutView, rail: false },
  { id: HELP_VIEW, icon: 'help', labelKey: 'parsinegar.views.help', render: renderHelpView, align: 'end' },
  { id: SETTINGS_VIEW, icon: 'settings', labelKey: 'parsinegar.views.settings', render: renderSettingsView, align: 'end' },
];

/**
 * Lists all registered views in rail order.
 * @returns {Array<object>} View entries (copies).
 */
export function listViews() {
  return [...registry];
}

/**
 * Finds a side-panel view by id (center-area entries never resolve here).
 * @param {string} id View id.
 * @returns {object|null} View entry or null.
 */
export function getView(id) {
  return registry.find((view) => view.id === id && view.area !== 'center') ?? null;
}

export { ABOUT_VIEW, FILES_VIEW, HELP_VIEW, MINDMAP_VIEW, OUTLINE_VIEW, SETTINGS_VIEW, SYNC_VIEW };
