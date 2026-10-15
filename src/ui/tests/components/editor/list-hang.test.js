// Verifies hanging-indent decorations for wrapped list lines (real
// CodeMirror in jsdom; widths read zero without layout, so these pin the
// mechanism while the headless probe pins real measurements).
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

function hangLines(host) {
  return [...host.querySelectorAll('.cm-line.parsi-hang')];
}

test('should_hang_unordered_ordered_and_task_lines_when_listed', () => {
  const mounted = createEditor('- الف\n1. اول\n  - [ ] کار');
  try {
    mounted.editor.gotoLine(3);
    const hung = hangLines(mounted.host);
    assert.equal(hung.length, 3);
    for (const line of hung) {
      assert.ok(line.getAttribute('style')?.includes('--hang:'), 'expected a measured gap');
      assert.ok(line.getAttribute('style')?.includes('--hang: 0px'), 'graceful zero without layout');
    }
  } finally {
    destroy(mounted);
  }
});

test('should_skip_plain_lines_when_hanging', () => {
  const mounted = createEditor('متن ساده\n- الف');
  try {
    assert.equal(hangLines(mounted.host).length, 1);
  } finally {
    destroy(mounted);
  }
});

test('should_skip_fenced_code_when_hanging', () => {
  const mounted = createEditor('```\n- کد\n```\n- الف');
  try {
    const hung = hangLines(mounted.host);
    assert.equal(hung.length, 1);
    assert.ok(hung[0].textContent.includes('الف'));
  } finally {
    destroy(mounted);
  }
});

test('should_survive_select_all_delete_all_when_hung', () => {
  // The reported crash: a stale hang set met the next empty-changes update
  // (selection/blur) in findChangedDeco and threw `RangeError: Position N
  // is out of range for changeset of length 0` (browser-proven with list
  // lines deep in the document). Here the stale range maps onto the empty
  // line, so the regression shows as a ghost hang line instead.
  const mounted = createEditor('1. الف\n2. ب\n3. ج');
  try {
    const content = mounted.host.querySelector('.cm-content');
    const key = (init) => content.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    key({ key: 'a', code: 'KeyA', ctrlKey: true });
    assert.equal(mounted.editor.getValue(), '1. الف\n2. ب\n3. ج');
    key({ key: 'Backspace', code: 'Backspace' });
    assert.equal(mounted.editor.getValue(), '');
    key({ key: 'a', code: 'KeyA', ctrlKey: true });
    assert.equal(mounted.editor.getValue(), '');
    assert.equal(hangLines(mounted.host).length, 0);
  } finally {
    destroy(mounted);
  }
});

test('should_clear_hang_when_lists_are_replaced', () => {
  const mounted = createEditor('1. a\nplain text');
  try {
    assert.equal(hangLines(mounted.host).length, 1);
    mounted.editor.setDocument('plain text');
    assert.equal(mounted.editor.getValue(), 'plain text');
    assert.equal(hangLines(mounted.host).length, 0);
  } finally {
    destroy(mounted);
  }
});
