// Pins the files-sort contract between the settings service and the files
// view: the service allowlist and the UI sort modes must stay identical.
// The literals are intentionally duplicated (plugins must not import UI
// code), so this test is the only thing keeping them in sync.
import assert from 'node:assert/strict';
import test from 'node:test';
import { FILES_SORTS } from '../lib/settings-service.js';
import { DEFAULT_FILES_SORT, FILES_SORT_MODES } from '../../../ui/components/workbench/views-files.js';

test('should_match_files_view_sort_modes_when_loaded', () => {
  assert.deepEqual([...FILES_SORTS], [...FILES_SORT_MODES]);
  assert.ok(FILES_SORTS.includes(DEFAULT_FILES_SORT), 'default must be a valid mode');
});
