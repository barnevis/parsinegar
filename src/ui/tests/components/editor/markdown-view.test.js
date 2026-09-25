// Verifies the Markdown view controller (real CodeMirror in jsdom).
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createMarkdownView } from '../../../components/editor/markdown-view.js';
import SAMPLE_DOCUMENT from '../../../sample-document.js';

/**
 * Checks that an injected stylesheet rule targets a selector with a declaration.
 * @param {string} selector Fragment of the rule selector (e.g. '.cm-line').
 * @param {string} property CSS property name.
 * @param {string} expected Substring of the declared value.
 * @returns {boolean} True when such a rule exists.
 */
function hasRule(selector, property, expected) {
  for (const sheet of document.styleSheets) {
    let rules = [];
    try {
      rules = [...sheet.cssRules];
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (rule.selectorText?.includes(selector) && rule.style?.getPropertyValue(property).includes(expected)) {
        return true;
      }
    }
  }
  return false;
}

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

test('should_toggle_bold_when_ctrl_b_pressed_on_persian_layout', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: 'متن' });
  try {
    const content = host.querySelector('.cm-content');
    content.focus();
    content.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ش', code: 'KeyA', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    content.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ذ', code: 'KeyB', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    assert.equal(editor.getValue(), '**متن**');
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_toggle_italic_when_ctrl_i_pressed_on_persian_layout', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: 'متن' });
  try {
    const content = host.querySelector('.cm-content');
    content.focus();
    content.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ش', code: 'KeyA', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    // The default keymap claims Mod-i for selectParentSyntax; our shortcut
    // must win through higher precedence (Persian key 'ه' on the I position).
    content.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ه', code: 'KeyI', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    assert.equal(editor.getValue(), '*متن*');
  } finally {
    editor.destroy();
    host.remove();
  }
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

test('should_detect_line_direction_when_themed', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: 'سلام\nHello' });
  try {
    assert.ok(host.querySelectorAll('.cm-line').length >= 2);
    // jsdom does not do layout or bidi; the injected rules are authoritative.
    assert.ok(hasRule('.cm-line.parsi-dir-rtl', 'text-align', 'right'));
    assert.ok(hasRule('.cm-line.parsi-dir-ltr', 'text-align', 'left'));
    assert.ok(hasRule('.cm-line.parsi-base-rtl', 'text-align', 'right'));
    assert.ok(hasRule('.cm-line.parsi-base-ltr', 'text-align', 'left'));
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_use_auto_direction_when_requested', () => {
  const host = document.createElement('div');
  const editor = createMarkdownView(host, { document: 'x', direction: 'auto' });
  try {
    assert.equal(host.querySelector('.cm-editor').getAttribute('dir'), 'auto');
  } finally {
    editor.destroy();
  }
});

test('should_keep_rtl_base_when_direction_is_auto_or_rtl', () => {
  for (const direction of ['auto', 'rtl']) {
    const host = document.createElement('div');
    document.body.append(host);
    const editor = createMarkdownView(host, { document: 'x', direction });
    try {
      const base = globalThis.getComputedStyle(host.querySelector('.cm-editor')).direction;
      assert.equal(base, 'rtl');
    } finally {
      editor.destroy();
      host.remove();
    }
  }
});

test('should_use_ltr_base_when_direction_is_ltr', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: 'x', direction: 'ltr' });
  try {
    const base = globalThis.getComputedStyle(host.querySelector('.cm-editor')).direction;
    assert.equal(base, 'ltr');
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_apply_font_size_when_given', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: 'x', fontSize: 20 });
  try {
    const size = globalThis.getComputedStyle(host.querySelector('.cm-editor')).fontSize;
    assert.equal(size, '20px');
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_fall_back_to_default_font_size_when_out_of_range', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: 'x', fontSize: 99 });
  try {
    const size = globalThis.getComputedStyle(host.querySelector('.cm-editor')).fontSize;
    assert.equal(size, '16px');
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_apply_dark_selection_when_color_scheme_is_dark', () => {
  const host = document.createElement('div');
  const editor = createMarkdownView(host, { document: 'x', colorScheme: 'dark' });
  try {
    assert.ok(hasRule('cm-selectionBackground', 'background-color', '#26436e'));
  } finally {
    editor.destroy();
  }
});

test('should_apply_sepia_selection_when_color_scheme_is_sepia', () => {
  const host = document.createElement('div');
  const editor = createMarkdownView(host, { document: 'x', colorScheme: 'sepia' });
  try {
    assert.ok(hasRule('cm-selectionBackground', 'background-color', '#d3c4b3'));
  } finally {
    editor.destroy();
  }
});

test('should_paint_code_selection_when_color_scheme_is_dark', () => {
  const host = document.createElement('div');
  const editor = createMarkdownView(host, { document: '`x`', colorScheme: 'dark' });
  try {
    assert.ok(hasRule('.parsi-code .parsi-selected', 'background-color', '#26436e'));
    assert.ok(hasRule('.parsi-selected .parsi-code', 'background-color', '#26436e'));
    assert.ok(hasRule('.parsi-code-line.parsi-selected', 'background-color', '#26436e'));
  } finally {
    editor.destroy();
  }
});

test('should_paint_code_selection_when_color_scheme_is_sepia', () => {
  const host = document.createElement('div');
  const editor = createMarkdownView(host, { document: '`x`', colorScheme: 'sepia' });
  try {
    assert.ok(hasRule('.parsi-code .parsi-selected', 'background-color', '#d3c4b3'));
  } finally {
    editor.destroy();
  }
});

test('should_track_platform_selection_when_color_scheme_is_light', () => {
  const host = document.createElement('div');
  const editor = createMarkdownView(host, { document: '`x`' });
  try {
    assert.ok(hasRule('.parsi-code .parsi-selected', 'background-color', 'Highlight'));
  } finally {
    editor.destroy();
  }
});

test('should_insert_bold_marks_when_insert_mark_is_called', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: '' });
  try {
    assert.equal(editor.insertMark('bold'), true);
    assert.equal(editor.getValue(), '****');
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_insert_mark_pair_when_selection_is_empty', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: '' });
  try {
    assert.equal(editor.insertMark('italic'), true);
    assert.equal(editor.getValue(), '**');
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_reject_unknown_kind_when_insert_mark_is_called', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: 'متن' });
  try {
    assert.equal(editor.insertMark('mermaid'), false);
    assert.equal(editor.getValue(), 'متن');
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_report_first_line_when_visible_line_is_read', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: 'a\nb' });
  try {
    // jsdom has no layout, so the viewport always resolves to line 1.
    assert.equal(editor.visibleLine(), 1);
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_fall_back_to_first_line_when_destroyed', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: 'a\nb' });
  try {
    editor.destroy();
    assert.equal(editor.visibleLine(), 1);
  } finally {
    host.remove();
  }
});

function createImageEditor(documentText) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: documentText });
  return { host, editor };
}

test('should_render_picture_when_remote_image_is_present', () => {
  const { host, editor } = createImageEditor('متن ![alt text](https://example.com/a.png) بعد');
  try {
    const picture = host.querySelector('.parsi-image');
    assert.ok(picture, 'expected a picture widget');
    assert.equal(picture.getAttribute('src'), 'https://example.com/a.png');
    assert.equal(picture.getAttribute('alt'), 'alt text');
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_keep_source_when_cursor_touches_image', () => {
  // Fresh cursor at 0 touches the leading image span, like link reveal.
  const { host, editor } = createImageEditor('![alt](https://example.com/a.png) بعد');
  try {
    assert.equal(host.querySelector('.parsi-image'), null);
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_keep_alt_text_when_image_is_local', () => {
  const { host, editor } = createImageEditor('متن ![alt](./x.png) بعد');
  try {
    assert.equal(host.querySelector('.parsi-image'), null);
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_link_picture_when_image_is_nested_in_link', () => {
  const { host, editor } = createImageEditor('متن [![badge](https://img.shields.io/x)](#) بعد');
  try {
    const link = host.querySelector('.parsi-image-link');
    assert.ok(link, 'expected a linked picture');
    assert.equal(link.getAttribute('href'), '#');
    assert.equal(link.getAttribute('target'), '_blank');
    assert.equal(link.getAttribute('rel'), 'noopener');
    assert.ok(link.querySelector('.parsi-image'));
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_fall_back_to_alt_when_picture_fails', () => {
  const { host, editor } = createImageEditor('متن ![alt text](https://example.com/a.png) بعد');
  try {
    const picture = host.querySelector('.parsi-image');
    assert.ok(picture, 'expected a picture widget');
    picture.dispatchEvent(new Event('error'));
    const fallback = host.querySelector('.parsi-image-fallback');
    assert.ok(fallback, 'expected an alt fallback');
    assert.equal(fallback.textContent, 'alt text');
    assert.equal(host.querySelector('.parsi-image'), null);
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_size_pictures_when_theme_is_loaded', () => {
  const { host, editor } = createImageEditor('متن ![alt](https://example.com/a.png) بعد');
  try {
    assert.ok(hasRule('.parsi-image', 'max-width', '100%'));
    assert.ok(hasRule('.parsi-image', 'max-height', '16rem'));
  } finally {
    editor.destroy();
    host.remove();
  }
});

function createSearchEditor(documentText) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: documentText });
  return { host, editor };
}

test('should_count_matches_when_search_is_set', () => {
  const { host, editor } = createSearchEditor('یک دو یک');
  try {
    // Fresh cursor at 0 sits inside the first match, hence current 1.
    assert.deepEqual(editor.setSearch({ query: 'یک' }), { invalidRegexp: false, current: 1, total: 2 });
    assert.deepEqual(editor.setSearch({ query: '' }), { invalidRegexp: false, current: 0, total: 0 });
    assert.deepEqual(editor.setSearch({ query: '([', regexp: true }), { invalidRegexp: true, current: 0, total: 0 });
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_step_and_wrap_when_search_step_is_called', () => {
  const { host, editor } = createSearchEditor('یک دو یک');
  try {
    // Fresh cursor at 0 sits inside the first match, so next lands on 2.
    assert.deepEqual(editor.searchStep({ query: 'یک' }, 1), { invalidRegexp: false, current: 2, total: 2 });
    assert.deepEqual(editor.searchStep({ query: 'یک' }, 1), { invalidRegexp: false, current: 1, total: 2 });
    assert.deepEqual(editor.searchStep({ query: 'یک' }, 1), { invalidRegexp: false, current: 2, total: 2 });
    assert.deepEqual(editor.searchStep({ query: 'یک' }, -1), { invalidRegexp: false, current: 1, total: 2 });
    assert.deepEqual(editor.searchStep({ query: 'نبود' }, 1), { invalidRegexp: false, current: 0, total: 0 });
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_replace_one_and_recount_when_search_replace_one_is_called', () => {
  const { host, editor } = createSearchEditor('یک دو یک');
  try {
    // Fresh cursor at 0 sits inside the first match, so it replaces at once.
    assert.deepEqual(editor.searchReplaceOne({ query: 'یک', replace: '۱' }), {
      invalidRegexp: false, current: 0, total: 1, replaced: 1,
    });
    assert.equal(editor.getValue(), '۱ دو یک');
    // Cursor between matches advances to the next match without replacing.
    assert.deepEqual(editor.searchReplaceOne({ query: 'یک', replace: '۱' }), {
      invalidRegexp: false, current: 1, total: 1, replaced: 0,
    });
    assert.equal(editor.getValue(), '۱ دو یک');
    // Now on the match: replaces it, leaving no matches behind.
    assert.deepEqual(editor.searchReplaceOne({ query: 'یک', replace: '۱' }), {
      invalidRegexp: false, current: 0, total: 0, replaced: 1,
    });
    assert.equal(editor.getValue(), '۱ دو ۱');
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_replace_all_in_one_step_when_search_replace_all_is_called', () => {
  const { host, editor } = createSearchEditor('یک دو یک');
  try {
    const result = editor.searchReplaceAll({ query: 'یک', replace: '۱' });
    assert.deepEqual(result, { invalidRegexp: false, current: 0, total: 0, replaced: 2 });
    assert.equal(editor.getValue(), '۱ دو ۱');
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_scope_to_selection_when_in_selection_is_set', () => {
  const { host, editor } = createSearchEditor('یک دو یک');
  try {
    // One step from the fresh cursor lands on the second match ("دو یک"
    // selected): only that match counts and only it gets replaced.
    editor.searchStep({ query: 'یک' }, 1);
    const scoped = editor.setSearch({ query: 'یک', inSelection: true });
    assert.deepEqual(scoped, { invalidRegexp: false, current: 1, total: 1 });
    const replaced = editor.searchReplaceAll({ query: 'یک', replace: '۱', inSelection: true });
    assert.equal(replaced.replaced, 1);
    assert.equal(editor.getValue(), 'یک دو ۱');
  } finally {
    editor.destroy();
    host.remove();
  }
});
