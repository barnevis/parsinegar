// Verifies collapsible nested lists (real CodeMirror in jsdom).
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { createMarkdownView } from '../../../components/editor/markdown-view.js';
import { flipFold, parentFoldAt } from '../../../components/editor/list-fold.js';

function createTreeView(documentText) {
  const host = document.createElement('div');
  document.body.append(host);
  const view = new EditorView({
    doc: documentText,
    parent: host,
    extensions: [markdown({ base: markdownLanguage })],
  });
  return { host, view };
}

function destroyView({ host, view }) {
  view.destroy();
  host.remove();
}

function createEditor(documentText) {
  const host = document.createElement('div');
  document.body.append(host);
  return { host, editor: createMarkdownView(host, { document: documentText }) };
}

function destroy({ host, editor }) {
  editor.destroy();
  host.remove();
}

function lineCount(host) {
  return host.querySelectorAll('.cm-line').length;
}

function click(node) {
  node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
}

test('should_fold_children_when_parent_marker_is_clicked', () => {
  const mounted = createEditor('متن\n\n- الف\n  - ب');
  try {
    assert.equal(lineCount(mounted.host), 4);
    const markers = [...mounted.host.querySelectorAll('.parsi-list-marker')];
    assert.equal(markers.length, 2);
    click(markers[0]);
    const folded = mounted.host.querySelector('.parsi-list-marker.parsi-list-collapsed');
    assert.ok(folded, 'expected the collapsed marker color');
    assert.equal(lineCount(mounted.host), 3, 'expected the child line folded away');
  } finally {
    destroy(mounted);
  }
});

test('should_unfold_children_when_collapsed_marker_is_clicked', () => {
  const mounted = createEditor('متن\n\n- الف\n  - ب\n');
  try {
    const markers = [...mounted.host.querySelectorAll('.parsi-list-marker')];
    click(markers[0]);
    assert.equal(lineCount(mounted.host), 4);
    click(mounted.host.querySelector('.parsi-list-marker.parsi-list-collapsed'));
    assert.equal(mounted.host.querySelector('.parsi-list-marker.parsi-list-collapsed'), null);
    assert.equal(lineCount(mounted.host), 5, 'expected the child line back');
  } finally {
    destroy(mounted);
  }
});

test('should_ignore_clicks_on_plain_markers_when_toggling', () => {
  const mounted = createEditor('متن\n\n- تنها\n');
  try {
    const marker = mounted.host.querySelector('.parsi-list-marker');
    assert.ok(marker, 'expected a marker');
    assert.equal(marker.classList.contains('parsi-list-collapsed'), false);
    click(marker);
    assert.equal(mounted.host.querySelector('.parsi-list-marker.parsi-list-collapsed'), null);
    assert.equal(lineCount(mounted.host), 4);
  } finally {
    destroy(mounted);
  }
});

test('should_fold_ordered_children_when_number_is_clicked', () => {
  const mounted = createEditor('متن\n\n1. اول\n   1. دوم\n');
  try {
    const markers = [...mounted.host.querySelectorAll('.parsi-list-marker')];
    assert.equal(markers.length, 2);
    click(markers[0]);
    assert.ok(mounted.host.querySelector('.parsi-list-marker.parsi-list-collapsed'), 'expected the collapsed number');
    assert.equal(lineCount(mounted.host), 4);
  } finally {
    destroy(mounted);
  }
});

test('should_render_chevron_for_parents_when_cursor_is_elsewhere', () => {
  const mounted = createEditor('متن\n\n- الف\n  - ب\n');
  try {
    const toggles = [...mounted.host.querySelectorAll('.parsi-list-chevron')];
    assert.equal(toggles.length, 1, 'expected one chevron for the parent only');
    click(toggles[0]);
    assert.ok(mounted.host.querySelector('.parsi-list-marker.parsi-list-collapsed'), 'expected the fold through the chevron');
  } finally {
    destroy(mounted);
  }
});

test('should_mark_active_row_when_cursor_is_on_parent', () => {
  const mounted = createEditor('- الف\n  - ب\n');
  try {
    mounted.editor.focus();
    assert.ok(mounted.host.querySelector('.cm-line.parsi-list-active'), 'expected the active parent row');
  } finally {
    destroy(mounted);
  }
});

test('should_leave_rows_unmarked_when_cursor_is_elsewhere', () => {
  const mounted = createEditor('متن\n\n- الف\n  - ب\n');
  try {
    assert.equal(mounted.host.querySelector('.cm-line.parsi-list-active'), null);
  } finally {
    destroy(mounted);
  }
});

test('should_fold_task_children_through_chevron_when_clicked', () => {
  const mounted = createEditor('متن\n\n- [ ] کار\n  - زیری\n');
  try {
    const toggle = mounted.host.querySelector('.parsi-list-chevron');
    assert.ok(toggle, 'expected a chevron for the task parent');
    click(toggle);
    assert.ok(mounted.host.querySelector('.parsi-task-marker.parsi-list-collapsed'), 'expected the collapsed task box');
    assert.equal(lineCount(mounted.host), 4);
  } finally {
    destroy(mounted);
  }
});

test('should_keep_checkbox_when_task_box_is_clicked', () => {
  const mounted = createEditor('متن\n\n- [ ] کار\n  - زیری\n');
  try {
    const box = mounted.host.querySelector('.parsi-task-marker');
    assert.ok(box, 'expected the checkbox');
    click(box);
    assert.equal(mounted.host.querySelector('.parsi-task-marker.parsi-list-collapsed'), null, 'expected no fold from the checkbox');
    assert.equal(lineCount(mounted.host), 5, 'expected no fold from the checkbox');
  } finally {
    destroy(mounted);
  }
});

test('should_ignore_fenced_lists_when_collecting', () => {
  const mounted = createEditor('متن\n\n```\n- الف\n  - ب\n```\n');
  try {
    assert.equal(mounted.host.querySelector('.parsi-list-chevron'), null, 'expected no chevron inside fences');
  } finally {
    destroy(mounted);
  }
});

test('should_leave_plain_markers_bare_when_rendered', () => {
  const mounted = createEditor('متن\n\n- تنها\n');
  try {
    const marker = mounted.host.querySelector('.parsi-list-marker');
    assert.ok(marker, 'expected a marker');
    assert.equal(marker.querySelector('span'), null, 'expected no adornment spans on plain markers');
  } finally {
    destroy(mounted);
  }
});

test('should_flag_parent_markers_when_rendered', () => {
  const mounted = createEditor('متن\n\n- والد\n\t- بچه');
  try {
    const markers = [...mounted.host.querySelectorAll('.parsi-list-marker')];
    assert.equal(markers.length, 2);
    assert.ok(markers[0].classList.contains('parsi-list-parent'), 'expected the toggle hint on parents');
    assert.ok(markers[0].classList.contains('parsi-list-bullet'));
    assert.ok(!markers[1].classList.contains('parsi-list-parent'), 'expected no hint on leaves');
  } finally {
    destroy(mounted);
  }
});

test('should_point_chevron_by_state_when_themed', () => {
  const mounted = createEditor('- الف\n  - ب\n');
  try {
    // Injected themes leave with the last editor, so assert while mounted.
    const sheets = [...document.styleSheets];
    const has = (selector, property, expected) => sheets.some((sheet) => {
      try {
        return [...sheet.cssRules].some((rule) => rule.selectorText?.includes(selector) && (rule.style?.getPropertyValue(property).includes(expected) || rule.style?.cssText.includes(expected)));
      } catch {
        return false;
      }
    });
    assert.ok(has('.parsi-list-marker .parsi-list-chevron', 'position', 'absolute'), 'expected the overlay chevron');
    assert.ok(has('.parsi-list-marker.parsi-list-parent', 'cursor', 'pointer'), 'expected the pointer on parents');
    assert.ok(has('.parsi-list-marker.parsi-list-parent::after', 'content', '""'), 'expected the gap hit pad');
    assert.ok(has('.parsi-list-marker .parsi-list-chevron', 'transform', 'rotate(45deg)'), 'expected the expanded chevron down');
    assert.ok(has('.parsi-list-collapsed .parsi-list-chevron', 'transform', 'rotate(135deg)'), 'expected the collapsed chevron sideways');
    assert.ok(has('.cm-foldPlaceholder', 'background-color', 'transparent'), 'expected the invisible fold placeholder');
  } finally {
    destroy(mounted);
  }
});

test('should_find_parent_fold_when_position_is_in_head_zone', () => {
  const mounted = createTreeView('- والد\n\t- بچه\n- ساده');
  try {
    assert.deepEqual(parentFoldAt(mounted.view, 0), { from: 6, to: 13 });
    assert.equal(parentFoldAt(mounted.view, 1), null);
    assert.equal(parentFoldAt(mounted.view, 7), null);
    assert.equal(parentFoldAt(mounted.view, 8), null);
    assert.equal(parentFoldAt(mounted.view, 14), null);
    assert.equal(parentFoldAt(mounted.view, -1), null);
    assert.equal(parentFoldAt(mounted.view, 26), null);
    assert.equal(parentFoldAt(mounted.view, Number.NaN), null);
  } finally {
    destroyView(mounted);
  }
});

test('should_cover_ordered_markers_when_position_is_in_head_zone', () => {
  const mounted = createTreeView('1. اول\n   1. دوم');
  try {
    assert.deepEqual(parentFoldAt(mounted.view, 0), { from: 6, to: 16 });
    assert.deepEqual(parentFoldAt(mounted.view, 1), { from: 6, to: 16 });
    assert.equal(parentFoldAt(mounted.view, 2), null);
  } finally {
    destroyView(mounted);
  }
});

test('should_skip_task_lines_when_position_is_in_head_zone', () => {
  const mounted = createTreeView('- [ ] والد\n\t- [ ] بچه');
  try {
    assert.equal(parentFoldAt(mounted.view, 0), null);
    assert.equal(parentFoldAt(mounted.view, 2), null);
  } finally {
    destroyView(mounted);
  }
});

test('should_return_null_when_no_parent_covers_position', () => {
  const mounted = createTreeView('متن ساده');
  try {
    assert.equal(parentFoldAt(mounted.view, 0), null);
    assert.equal(parentFoldAt(mounted.view, 3), null);
  } finally {
    destroyView(mounted);
  }
});
