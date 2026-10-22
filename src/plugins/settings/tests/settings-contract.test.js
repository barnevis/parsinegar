// Pins the mirrored allowlists between the settings service and the UI:
// the files view sort modes and the mindmap host layout keys are duplicated
// literals on purpose (plugins must not import UI code), so this test is
// the only thing keeping them in sync.
import assert from 'node:assert/strict';
import test from 'node:test';
import { FILES_SORTS, MINDMAP_LAYOUTS } from '../lib/settings-service.js';
import { DEFAULT_FILES_SORT, FILES_SORT_MODES } from '../../../ui/components/workbench/views-files.js';
import { LAYOUT_DEFAULT, LAYOUT_OPTIONS } from '../../../ui/pages/home/mindmap-host.js';

test('should_match_files_view_sort_modes_when_loaded', () => {
  assert.deepEqual([...FILES_SORTS], [...FILES_SORT_MODES]);
  assert.ok(FILES_SORTS.includes(DEFAULT_FILES_SORT), 'default must be a valid mode');
});

test('should_match_mindmap_host_layout_keys_when_loaded', () => {
  assert.deepEqual([...MINDMAP_LAYOUTS], [...LAYOUT_OPTIONS]);
  assert.ok(MINDMAP_LAYOUTS.includes(LAYOUT_DEFAULT), 'default must be a valid layout');
});
