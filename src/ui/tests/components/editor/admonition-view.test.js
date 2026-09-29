// Verifies admonition collection (pure) and decorations.
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { createMarkdownView } from '../../../components/editor/markdown-view.js';
import { ADMONITION_KINDS, collectAdmonitions } from '../../../components/editor/admonition-view.js';

function collect(text, selection) {
  const state = EditorState.create({ doc: text, selection: selection ?? { anchor: 0 } });
  return collectAdmonitions(state);
}

test('should_know_five_kinds_when_listed', () => {
  assert.deepEqual(Object.keys(ADMONITION_KINDS), ['هشدار', 'احتیاط', 'مهم', 'راهنما', 'نکته']);
  for (const kind of Object.values(ADMONITION_KINDS)) {
    for (const scheme of ['light', 'dark', 'sepia']) {
      assert.ok(kind.accent[scheme] && kind.wash[scheme], `expected ${scheme} colors`);
    }
  }
});

test('should_collect_block_when_fenced', () => {
  const blocks = collect('متن\n\n... هشدار\nمحتوا\n...\n\nبعد');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'هشدار');
});

test('should_accept_glued_opener_when_scanning', () => {
  assert.equal(collect('...هشدار\nمحتوا\n...').length, 1);
  assert.equal(collect('... هشدار\nمحتوا\n...').length, 1);
});

test('should_reject_unknown_kind_and_extra_words_when_scanning', () => {
  assert.deepEqual(collect('... ناشناخته\nx\n...'), []);
  assert.deepEqual(collect('... هشدار اضافه\nx\n...'), []);
  assert.deepEqual(collect('.... هشدار\nx\n...'), []);
});

test('should_run_to_end_when_unclosed', () => {
  const text = 'متن\n\n... نکته\nالف\nب';
  const blocks = collect(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'نکته');
  assert.equal(text.slice(blocks[0].from, blocks[0].to), '... نکته\nالف\nب');
});

test('should_allow_indent_and_quote_when_scanning', () => {
  assert.equal(collect('  ... مهم\nx\n...').length, 1);
  assert.equal(collect('> ... راهنما\n> x\n> ...').length, 1);
  assert.equal(collect('    ... هشدار\nx\n...').length, 0);
});

test('should_skip_fenced_code_when_scanning', () => {
  assert.deepEqual(collect('```\n... هشدار\n```'), []);
});

function createEditor(documentText) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: documentText });
  return { host, editor };
}

test('should_wash_and_label_when_block_is_present', () => {
  const { host, editor } = createEditor('متن\n\n...هشدار\nمحتوا\n...\n\nبعد');
  try {
    const lines = [...host.querySelectorAll('.cm-line')];
    const byText = (start) => lines.find((line) => line.textContent.startsWith(start));
    const opener = lines.find((line) => line.textContent.includes('...هشدار'));
    assert.ok(opener, 'expected the opener line');
    // Whole region washed: opener, content and closer.
    for (const line of [opener, byText('محتوا'), lines.find((line) => line.textContent === '...')]) {
      assert.ok(line && line.classList.contains('parsi-admonition-line'), 'expected the unified wash');
    }
    // Corners on the fences; the label lives on the opener line.
    assert.ok(opener.classList.contains('parsi-admonition-first'), 'expected the rounded top');
    const label = host.querySelector('.parsi-admonition-label');
    assert.ok(label, 'expected the kind label');
    assert.equal(label.textContent, 'هشدار');
    assert.equal(label.closest('.cm-line'), opener);
    assert.equal(host.querySelectorAll('.parsi-fence-hidden').length, 2);
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_swap_label_for_fence_when_cursor_is_on_opener', () => {
  // Lines: 1 متن, 2 blank, 3 opener, 4 content, 5 closer.
  const { host, editor } = createEditor('متن\n\n...هشدار\nمحتوا\n...');
  try {
    assert.ok(host.querySelector('.parsi-admonition-label'), 'expected the label first');
    editor.gotoLine(3);
    assert.equal(host.querySelector('.parsi-admonition-label'), null, 'expected the label gone on the opener');
    assert.equal(host.querySelectorAll('.parsi-fence-hidden').length, 1, 'expected only the closer hidden');
    editor.gotoLine(4);
    assert.ok(host.querySelector('.parsi-admonition-label'), 'expected the label back off the opener');
    assert.equal(host.querySelectorAll('.parsi-fence-hidden').length, 2);
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_paint_github_alert_when_theme_is_loaded', () => {
  const { host, editor } = createEditor('متن\n\n...هشدار\nمحتوا\n...');
  try {
    const styleSheets = [...document.styleSheets];
    const has = (selector, property, expected) => styleSheets.some((sheet) => {
      try {
        return [...sheet.cssRules].some((rule) => rule.selectorText?.includes(selector) && rule.style?.getPropertyValue(property).includes(expected));
      } catch {
        return false;
      }
    });
    assert.ok(has('.parsi-admonition-line-0', 'border-inline-start', '#9a6700'));
    assert.ok(has('.parsi-admonition-label-0', 'color', '#9a6700'));
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_paint_dark_accents_when_scheme_is_dark', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: 'متن\n\n...هشدار\nمحتوا\n...', colorScheme: 'dark' });
  try {
    const styleSheets = [...document.styleSheets];
    const has = (selector, property, expected) => styleSheets.some((sheet) => {
      try {
        return [...sheet.cssRules].some((rule) => rule.selectorText?.includes(selector) && rule.style?.getPropertyValue(property).includes(expected));
      } catch {
        return false;
      }
    });
    assert.ok(has('.parsi-admonition-line-0', 'border-inline-start', '#d29922'));
    assert.ok(has('.parsi-admonition-label-0', 'color', '#d29922'));
    assert.ok(host.querySelector('.parsi-admonition-line'), 'expected the wash in dark mode');
  } finally {
    editor.destroy();
    host.remove();
  }
});
