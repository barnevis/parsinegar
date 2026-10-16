// Verifies the help view renderer (pure function, no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderHelpView } from '../../../components/workbench/views-help.js';

test('should_render_cheatsheet_shortcuts_and_mindmap_when_rendered', () => {
  const markup = renderHelpView({ t: (key) => key });
  for (const key of [
    'parsinegar.help.marks-title',
    'parsinegar.help.heading-one',
    'parsinegar.help.heading-two',
    'parsinegar.help.ordered-list',
    'parsinegar.help.unordered-list',
    'parsinegar.help.shortcuts-title',
    'parsinegar.help.shortcut-bold',
    'parsinegar.help.shortcut-search',
    'parsinegar.help.mindmap-title',
    'parsinegar.help.mindmap-body',
    'parsinegar.help.full-guide',
  ]) {
    assert.ok(markup.includes(key), `missing: ${key}`);
  }
  for (const sample of ['#', '##', '1.', '-', 'Ctrl+B', 'Ctrl+F', 'Tab', 'Enter']) {
    assert.ok(markup.includes(sample), `missing sample: ${sample}`);
  }
  assert.ok(markup.includes('data-help-full'), 'expected the full-guide action');
});
