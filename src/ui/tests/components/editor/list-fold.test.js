// Verifies collapsible nested lists (real CodeMirror in jsdom).
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarkdownView } from '../../../components/editor/markdown-view.js';

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

test('should_align_plain_markers_with_gutter_when_rendered', () => {
  const mounted = createEditor('متن\n\n- تنها\n');
  try {
    const marker = mounted.host.querySelector('.parsi-list-marker');
    assert.ok(marker.querySelector('.parsi-list-gutter'), 'expected the gutter column');
    assert.equal(marker.querySelector('.parsi-list-chevron'), null, 'expected no chevron without children');
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
    assert.ok(has('.parsi-list-triangle', 'transform', 'rotate(45deg)'), 'expected the expanded chevron down');
    assert.ok(has('.parsi-list-collapsed .parsi-list-triangle', 'transform', 'rotate(135deg)'), 'expected the collapsed chevron sideways');
    assert.ok(has('.cm-foldPlaceholder', 'background-color', 'transparent'), 'expected the invisible fold placeholder');
  } finally {
    destroy(mounted);
  }
});
