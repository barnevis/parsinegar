// Verifies workbench region renderers (pure, no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMenubar, renderRail, renderSide, renderStatusbar } from '../../../components/workbench/regions.js';

function translate(key) {
  const labels = {
    'parsinegar.app.title': 'پارسی‌نگار',
    'parsinegar.menu.file': 'پرونده',
    'parsinegar.views.files': 'فایل‌ها',
    'parsinegar.views.close': 'بستن',
    'parsinegar.stats.words': 'واژه',
  };
  return labels[key] ?? key;
}

test('should_render_rail_from_registry_when_called', () => {
  const html = renderRail({ t: translate, assetBaseUrl: null, activeView: 'files' });
  assert.ok(html.includes('data-view="files"'));
  assert.ok(html.includes('data-view="outline"'));
  assert.ok(html.includes('aria-pressed="true"'));
});

test('should_render_open_view_when_side_is_open', () => {
  const html = renderSide({
    t: translate,
    activeView: 'outline',
    sideOpen: true,
    items: [],
    currentId: null,
    documentText: '# الف',
  });
  assert.ok(html.includes('part="side"'));
  assert.ok(html.includes('data-line="1"'));
});

test('should_render_empty_when_side_is_closed', () => {
  assert.equal(renderSide({ t: translate, activeView: 'files', sideOpen: false, items: [], currentId: null, documentText: '' }), '');
});

test('should_mark_open_menu_when_menubar_is_rendered', () => {
  const html = renderMenubar({ t: translate, openMenu: 'file', hasDocument: true });
  assert.ok(html.includes('data-menu="file"'));
  assert.ok(html.includes('aria-expanded="true"'));
  assert.equal((html.match(/aria-expanded="true"/g) ?? []).length, 1);
});

test('should_render_brand_when_menubar_is_rendered', () => {
  const html = renderMenubar({ t: translate, openMenu: null, hasDocument: false });
  assert.ok(html.includes('part="brand"'));
  assert.ok(html.includes('پارسی‌نگار'));
});

test('should_render_stats_when_status_is_open', () => {
  const html = renderStatusbar({
    t: translate,
    bottomOpen: true,
    stats: { chars: 10, words: 2, lines: 1 },
    formatNumber: (value) => `#${value}`,
  });
  assert.ok(html.includes('data-stat="words"'));
  assert.ok(html.includes('#2'));
  assert.ok(html.includes('واژه'));
});

test('should_render_empty_when_status_is_closed', () => {
  assert.equal(renderStatusbar({ t: translate, bottomOpen: false, stats: null, formatNumber: null }), '');
});
