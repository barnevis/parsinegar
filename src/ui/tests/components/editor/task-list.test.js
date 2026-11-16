// Verifies task-list rendering and toggling (real CodeMirror in jsdom).
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarkdownView } from '../../../components/editor/markdown-view.js';
import { TASK_LINE_PATTERN, toggledBox } from '../../../components/editor/task-list.js';

function createEditor(documentText) {
  const host = document.createElement('div');
  document.body.append(host);
  return { host, editor: createMarkdownView(host, { document: documentText }) };
}

function destroy({ host, editor }) {
  editor.destroy();
  host.remove();
}

test('should_match_task_lines_when_pattern_is_checked', () => {
  assert.ok(TASK_LINE_PATTERN.test('- [ ] کار'));
  assert.ok(TASK_LINE_PATTERN.test('- [x] کار'));
  assert.ok(TASK_LINE_PATTERN.test('1. [X] کار'));
  assert.ok(!TASK_LINE_PATTERN.test('- کار ساده'));
});

test('should_toggle_box_when_toggled_box_is_called', () => {
  assert.equal(toggledBox(' '), 'x');
  assert.equal(toggledBox('x'), ' ');
  assert.equal(toggledBox('X'), ' ');
});

test('should_render_checkbox_when_task_is_open', () => {
  const mounted = createEditor('متن\n\n- [ ] خرید');
  try {
    const box = mounted.host.querySelector('.parsi-task-marker');
    assert.ok(box, 'expected a checkbox widget');
    assert.equal(box.getAttribute('aria-checked'), 'false');
    assert.ok(box.querySelector('.parsi-task-box'), 'expected the drawn square');
    assert.equal(box.querySelector('.parsi-task-box.parsi-task-checked'), null, 'expected an open box unfilled');
    assert.equal(box.querySelector('.parsi-task-check'), null, 'expected no mark in an open box');
  } finally {
    destroy(mounted);
  }
});

test('should_render_checked_box_when_task_is_done', () => {
  const mounted = createEditor('متن\n\n- [x] خرید');
  try {
    const box = mounted.host.querySelector('.parsi-task-marker');
    assert.ok(box, 'expected a checkbox widget');
    assert.equal(box.getAttribute('aria-checked'), 'true');
    assert.ok(box.querySelector('.parsi-task-box.parsi-task-checked'), 'expected the filled box');
    assert.ok(box.querySelector('.parsi-task-check'), 'expected the drawn check inside the box');
  } finally {
    destroy(mounted);
  }
});

test('should_show_widget_when_cursor_is_elsewhere_on_task_line', () => {
  const mounted = createEditor('- [ ] خرید');
  try {
    mounted.editor.focus();
    const box = mounted.host.querySelector('.parsi-task-marker');
    assert.ok(box, 'expected a checkbox widget when the cursor is not on the box');
    assert.equal(box.getAttribute('aria-checked'), 'false');
  } finally {
    destroy(mounted);
  }
});

test('should_toggle_task_when_checkbox_is_clicked', () => {
  const mounted = createEditor('متن\n\n- [ ] خرید');
  try {
    const box = mounted.host.querySelector('.parsi-task-marker');
    assert.ok(box, 'expected a checkbox widget');
    box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    assert.ok(mounted.editor.getValue().includes('- [x] خرید'));
  } finally {
    destroy(mounted);
  }
});

test('should_freeze_task_when_editor_is_locked', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: 'متن\n\n- [ ] خرید', readOnly: true });
  try {
    const box = host.querySelector('.parsi-task-marker');
    assert.ok(box, 'expected a checkbox widget while locked');
    box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    assert.ok(editor.getValue().includes('- [ ] خرید'));
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_lead_box_when_parent_task_carries_chevron', () => {
  const mounted = createEditor('متن\n\n- [ ] والد\n\t- [ ] فرزند');
  try {
    const parent = mounted.host.querySelector('.parsi-task-marker[data-fold-from]');
    assert.ok(parent, 'expected the parent box to carry fold data');
    assert.equal(parent.firstElementChild?.className, 'parsi-list-chevron');
    assert.equal(parent.getAttribute('aria-checked'), 'false');
    assert.ok(parent.querySelector('.parsi-task-box'), 'expected the drawn square after the chevron');
  } finally {
    destroy(mounted);
  }
});

test('should_hide_chevron_on_child_tasks_when_nested_under_parent', () => {
  const mounted = createEditor('متن\n\n- [ ] والد\n\t- [ ] فرزند');
  try {
    const boxes = [...mounted.host.querySelectorAll('.parsi-task-marker')];
    assert.equal(boxes.length, 2);
    assert.equal(boxes[1].querySelector('.parsi-list-chevron'), null);
    assert.equal(boxes[1].hasAttribute('data-fold-from'), false);
  } finally {
    destroy(mounted);
  }
});

test('should_fold_children_when_parent_task_chevron_is_clicked', () => {
  const mounted = createEditor('متن\n\n- [ ] والد\n\t- [ ] فرزند');
  try {
    const linesBefore = mounted.host.querySelectorAll('.cm-line').length;
    assert.equal(linesBefore, 4);
    const parent = mounted.host.querySelector('.parsi-task-marker[data-fold-from]');
    parent.querySelector('.parsi-list-chevron').dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }),
    );
    assert.ok(
      mounted.host.querySelector('.parsi-task-marker.parsi-list-collapsed'),
      'expected the collapsed task color',
    );
    assert.equal(mounted.host.querySelectorAll('.cm-line').length, 3);
    assert.equal(parent.getAttribute('aria-checked'), 'false', 'expected no checkbox toggle on chevron click');
  } finally {
    destroy(mounted);
  }
});

test('should_strike_text_of_completed_task_only', () => {
  const mounted = createEditor('- [x] انجام‌شده\n- [ ] باز');
  try {
    const struck = [...mounted.host.querySelectorAll('.parsi-task-done')];
    assert.equal(struck.length, 1, 'expected exactly the done item struck');
    assert.ok(struck[0].textContent.includes('انجام‌شده'));
    assert.ok(!struck[0].textContent.includes('باز'), 'expected the open item untouched');
  } finally {
    destroy(mounted);
  }
});

test('should_strike_task_text_after_toggling_the_box', () => {
  const mounted = createEditor('- [ ] خرید');
  try {
    assert.equal(mounted.host.querySelector('.parsi-task-done'), null);
    mounted.host.querySelector('.parsi-task-marker').dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );
    assert.ok(mounted.host.querySelector('.parsi-task-done'), 'expected the strike after completing');
    assert.equal(mounted.host.querySelector('.parsi-task-done').textContent, 'خرید');
  } finally {
    destroy(mounted);
  }
});
