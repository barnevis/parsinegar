// Verifies the side-panel view registry (metadata and references only).
import assert from 'node:assert/strict';
import test from 'node:test';
import { ABOUT_VIEW, FILES_VIEW, HELP_VIEW, MINDMAP_VIEW, OUTLINE_VIEW, SETTINGS_VIEW, SYNC_VIEW, getView, listViews } from '../../../components/workbench/views.js';
import { renderAboutView } from '../../../components/workbench/views-about.js';
import { renderFilesView } from '../../../components/workbench/views-files.js';
import { renderHelpView } from '../../../components/workbench/views-help.js';
import { renderOutlineView } from '../../../components/workbench/views-outline.js';
import { renderSettingsView } from '../../../components/workbench/views-settings.js';
import { renderSyncView } from '../../../components/workbench/views-sync.js';

test('should_list_files_outline_and_settings_when_listed', () => {
  const views = listViews();
  assert.deepEqual(views.map(({ id }) => id), [FILES_VIEW, OUTLINE_VIEW, MINDMAP_VIEW, SYNC_VIEW, ABOUT_VIEW, HELP_VIEW, SETTINGS_VIEW]);
  for (const view of views) {
    assert.equal(typeof view.icon, 'string');
    assert.equal(typeof view.labelKey, 'string');
    if (view.area !== 'center') {
      assert.equal(typeof view.render, 'function');
    }
  }
  assert.equal(getView(SETTINGS_VIEW).align, 'end');
  assert.equal(getView(HELP_VIEW).align, 'end');
  assert.notEqual(getView(SYNC_VIEW).align, 'end');
  assert.notEqual(getView(FILES_VIEW).align, 'end');
  assert.notEqual(getView(OUTLINE_VIEW).align, 'end');
  assert.equal(getView(MINDMAP_VIEW), null);
});

test('should_reference_view_modules_when_render_is_read', () => {
  assert.equal(getView(FILES_VIEW).render, renderFilesView);
  assert.equal(getView(OUTLINE_VIEW).render, renderOutlineView);
  assert.equal(getView(SETTINGS_VIEW).render, renderSettingsView);
  assert.equal(getView(SYNC_VIEW).render, renderSyncView);
  assert.equal(getView(ABOUT_VIEW).render, renderAboutView);
  assert.equal(getView(HELP_VIEW).render, renderHelpView);
});

test('should_hide_about_from_rail_when_listed', () => {
  const views = listViews();
  assert.ok(views.some(({ id }) => id === ABOUT_VIEW), 'expected the about view registered');
  const rail = views.filter(({ rail }) => rail !== false);
  assert.ok(!rail.some(({ id }) => id === ABOUT_VIEW), 'expected no rail button for about');
  assert.deepEqual(rail.map(({ id }) => id), [FILES_VIEW, OUTLINE_VIEW, MINDMAP_VIEW, SYNC_VIEW, HELP_VIEW, SETTINGS_VIEW]);
});

test('should_return_null_when_id_is_unknown', () => {
  assert.equal(getView('nope'), null);
});
