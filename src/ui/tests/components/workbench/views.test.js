// Verifies the side-panel view registry (metadata and references only).
import assert from 'node:assert/strict';
import test from 'node:test';
import { FILES_VIEW, OUTLINE_VIEW, getView, listViews } from '../../../components/workbench/views.js';
import { renderFilesView } from '../../../components/workbench/views-files.js';
import { renderOutlineView } from '../../../components/workbench/views-outline.js';

test('should_list_files_and_outline_when_listed', () => {
  const views = listViews();
  assert.deepEqual(views.map(({ id }) => id), [FILES_VIEW, OUTLINE_VIEW]);
  for (const view of views) {
    assert.equal(typeof view.icon, 'string');
    assert.equal(typeof view.labelKey, 'string');
    assert.equal(typeof view.render, 'function');
  }
});

test('should_reference_view_modules_when_render_is_read', () => {
  assert.equal(getView(FILES_VIEW).render, renderFilesView);
  assert.equal(getView(OUTLINE_VIEW).render, renderOutlineView);
});

test('should_return_null_when_id_is_unknown', () => {
  assert.equal(getView('nope'), null);
});
