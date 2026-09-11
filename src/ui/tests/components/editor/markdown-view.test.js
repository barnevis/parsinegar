// Verifies the Markdown view controller (real CodeMirror in jsdom).
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createMarkdownView } from '../../../components/editor/markdown-view.js';
import SAMPLE_DOCUMENT from '../../../sample-document.js';

test('should_show_document_when_created_with_text', () => {
  const host = document.createElement('div');
  const editor = createMarkdownView(host, { document: SAMPLE_DOCUMENT });
  try {
    assert.equal(editor.getValue(), SAMPLE_DOCUMENT);
    assert.ok(host.querySelector('.cm-editor'));
    assert.equal(host.querySelector('.cm-editor').getAttribute('dir'), 'rtl');
  } finally {
    editor.destroy();
  }
});

test('should_replace_content_when_set_document_is_called', () => {
  const host = document.createElement('div');
  const editor = createMarkdownView(host, { document: 'before' });
  try {
    editor.setDocument('# سلام دنیا');
    assert.equal(editor.getValue(), '# سلام دنیا');
  } finally {
    editor.destroy();
  }
});

test('should_report_change_when_user_edits', () => {
  const host = document.createElement('div');
  const seen = [];
  const editor = createMarkdownView(host, {
    document: 'before',
    onChange: (value) => seen.push(value),
  });
  try {
    editor.setDocument('متن تازه');
    assert.deepEqual(seen, ['متن تازه']);
  } finally {
    editor.destroy();
  }
});

test('should_keep_last_value_when_destroyed', () => {
  const host = document.createElement('div');
  const editor = createMarkdownView(host, { document: 'before' });
  editor.setDocument('پیش از نابودی');
  editor.destroy();
  assert.equal(editor.getValue(), 'پیش از نابودی');
});

test('should_ignore_non_string_when_set_document_receives_invalid_input', () => {
  const host = document.createElement('div');
  const editor = createMarkdownView(host, { document: 'before' });
  try {
    editor.setDocument(null);
    assert.equal(editor.getValue(), 'before');
  } finally {
    editor.destroy();
  }
});

test('should_focus_editor_when_focus_is_called', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: 'before' });
  try {
    editor.focus();
    assert.ok(host.contains(document.activeElement), 'expected focus inside the editor');
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_ignore_focus_when_destroyed', () => {
  const host = document.createElement('div');
  const editor = createMarkdownView(host, { document: 'before' });
  editor.destroy();
  assert.doesNotThrow(() => editor.focus());
});

test('should_select_all_when_ctrl_a_pressed_on_persian_layout', () => {
  const text = 'متن ساده بدون هیچ نشانه‌ای';
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: text });
  try {
    const content = host.querySelector('.cm-content');
    content.focus();
    content.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ش', code: 'KeyA', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    assert.equal(document.getSelection()?.toString(), text);
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_select_all_when_ctrl_a_pressed_on_latin_layout', () => {
  const text = 'متن ساده بدون هیچ نشانه‌ای';
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: text });
  try {
    const content = host.querySelector('.cm-content');
    content.focus();
    content.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    assert.equal(document.getSelection()?.toString(), text);
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_fail_clearly_when_host_is_not_an_element', () => {
  assert.throws(() => createMarkdownView(null), /element host/);
});

function selectionLine(host) {
  const anchor = document.getSelection()?.anchorNode ?? null;
  const line = anchor?.parentElement?.closest?.('.cm-line') ?? null;
  return line ? line.textContent : null;
}

test('should_undo_and_redo_when_called', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: 'اول' });
  try {
    editor.setDocument('دوم');
    editor.undo();
    assert.equal(editor.getValue(), 'اول');
    editor.redo();
    assert.equal(editor.getValue(), 'دوم');
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_move_cursor_when_goto_line_is_called', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: 'یک\nدو\nسه' });
  try {
    editor.gotoLine(3);
    const line = selectionLine(host);
    assert.ok(line && line.includes('سه'), `expected cursor on third line, got: ${line}`);
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_clamp_line_when_goto_line_is_out_of_range', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: 'یک\nدو' });
  try {
    editor.gotoLine(99);
    assert.ok((selectionLine(host) ?? '').includes('دو'));
    editor.gotoLine(0);
    assert.ok((selectionLine(host) ?? '').includes('یک'));
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_set_relaxed_line_height_when_themed', async () => {
  const source = await readFile(new URL('../../../components/editor/markdown-view.js', import.meta.url), 'utf8');
  assert.ok(source.includes('lineHeight'));
  assert.ok(source.includes("'1.5'"));
});
