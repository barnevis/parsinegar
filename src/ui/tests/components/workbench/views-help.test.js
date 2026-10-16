// Verifies the help view renderer (pure function, no DOM): completeness
// against the menu shortcuts is pinned mechanically below, so a new
// shortcut without a help row fails here, not in a user report.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMenuModel } from '../../../components/workbench/menu-model.js';
import { renderHelpView } from '../../../components/workbench/views-help.js';

const MARK_SAMPLES = [
  '#', '**متن**', '*متن*', '~~متن~~', '&gt; ', '[متن]()', '![](src)',
  '`متن`', '```', '- ', '1. ', '- [ ] ', '==متن==', '---', '| |',
  '...هشدار', '...احتیاط', '...مهم', '...راهنما', '...نکته', '...شعر',
];

const MINDMAP_SAMPLES = ['دابل‌کلیک', 'Tab', 'Enter', 'Shift+Enter', 'Delete', 'درگ', 'دایره کنار گره'];

test('should_render_every_supported_mark_when_rendered', () => {
  const markup = renderHelpView({ t: (key) => key });
  for (const sample of MARK_SAMPLES) {
    assert.ok(markup.includes(sample), `missing mark sample: ${sample}`);
  }
  for (const key of [
    'parsinegar.help.marks-title',
    'parsinegar.help.mark-heading',
    'parsinegar.help.shortcuts-title',
    'parsinegar.help.mindmap-title',
    'parsinegar.help.full-guide',
  ]) {
    assert.ok(markup.includes(key), `missing: ${key}`);
  }
  assert.ok(markup.includes('data-help-full'), 'expected the full-guide action');
});

test('should_cover_every_menu_shortcut_when_rendered', () => {
  const markup = renderHelpView({ t: (key) => key });
  const menus = buildMenuModel({ t: (key) => key, hasDocument: true });
  const shortcuts = [];
  for (const menu of menus) {
    const walk = (items) => {
      for (const item of items ?? []) {
        if (typeof item.shortcut === 'string' && item.shortcut.length > 0) {
          shortcuts.push(item.shortcut);
        }
        walk(item.items);
      }
    };
    walk(menu.items);
  }
  assert.ok(shortcuts.length > 0, 'expected menu shortcuts');
  for (const shortcut of new Set(shortcuts)) {
    assert.ok(markup.includes(shortcut), `missing shortcut: ${shortcut}`);
  }
});

test('should_render_every_mindmap_gesture_when_rendered', () => {
  const markup = renderHelpView({ t: (key) => key });
  for (const sample of MINDMAP_SAMPLES) {
    assert.ok(markup.includes(sample), `missing mindmap sample: ${sample}`);
  }
});
