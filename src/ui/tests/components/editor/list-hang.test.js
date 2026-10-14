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
