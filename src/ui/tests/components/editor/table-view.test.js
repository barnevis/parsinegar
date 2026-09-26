// Verifies live-table collection (pure) and widget rendering.
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { createMarkdownView } from '../../../components/editor/markdown-view.js';
import { collectTablesFrom } from '../../../components/editor/table-view.js';

function stateWith(text, selection) {
  return EditorState.create({
    doc: text,
    selection: selection ?? { anchor: 0 },
    extensions: [markdown({ base: markdownLanguage })],
  });
}

function collect(text, selection) {
  const state = stateWith(text, selection);
  return collectTablesFrom(state, 0, state.doc.length);
}

test('should_collect_header_rows_and_aligns_when_scanning', () => {
  const tables = collect('متن\n\n| نام | سن |\n|:---|---:|\n| علی | ۳۰ |');
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0].header, [[{ t: 'text', text: 'نام' }], [{ t: 'text', text: 'سن' }]]);
  assert.deepEqual(tables[0].rows, [[[{ t: 'text', text: 'علی' }], [{ t: 'text', text: '۳۰' }]]]);
  assert.deepEqual(tables[0].aligns, ['start', 'end']);
});

test('should_collect_inline_marks_when_scanning', () => {
  const tables = collect('متن\n\n| **a** و `c` |\n|---|\n| [l](https://e.com) و ~~s~~ |');
  assert.equal(tables.length, 1);
  const [head] = tables[0].header;
  assert.deepEqual(head[0], { t: 'strong', kids: [{ t: 'text', text: 'a' }] });
  assert.deepEqual(head[1], { t: 'text', text: ' و ' });
  assert.deepEqual(head[2], { t: 'code', kids: [{ t: 'text', text: 'c' }] });
  const [body] = tables[0].rows;
  const [cell] = body;
  assert.deepEqual(cell[0], {
    t: 'link',
    href: 'https://e.com',
    kids: [{ t: 'text', text: 'l' }],
  });
  assert.deepEqual(cell[1], { t: 'text', text: ' و ' });
  assert.deepEqual(cell[2], { t: 'strike', kids: [{ t: 'text', text: 's' }] });
});

test('should_default_align_when_delimiter_is_plain', () => {
  const tables = collect('متن\n\n| a | b |\n|---|---|\n| 1 | 2 |');
  assert.deepEqual(tables[0].aligns, ['start', 'start']);
});

test('should_center_when_delimiter_is_wrapped', () => {
  const tables = collect('متن\n\n| a |\n|:--:|\n| 1 |');
  assert.deepEqual(tables[0].aligns, ['center']);
});

test('should_skip_touched_table_when_selected', () => {
  const text = 'متن\n\n| a |\n|---|\n| 1 |';
  assert.equal(collect(text, { anchor: 0 }).length, 1);
  assert.equal(collect(text, { anchor: 10 }).length, 0);
});

test('should_skip_fenced_tables_when_scanning', () => {
  const tables = collect('```\n| a |\n|---|\n| 1 |\n```\n\n| b |\n|---|\n| 2 |');
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0].header, [[{ t: 'text', text: 'b' }]]);
});

function createEditor(documentText) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: documentText });
  return { host, editor };
}

test('should_render_table_when_present', () => {
  const { host, editor } = createEditor('متن\n\n| نام | سن |\n|:---|---:|\n| علی | ۳۰ |');
  try {
    const table = host.querySelector('.parsi-table');
    assert.ok(table, 'expected a table widget');
    assert.deepEqual(
      [...table.querySelectorAll('thead th')].map((cell) => cell.textContent),
      ['نام', 'سن'],
    );
    assert.deepEqual(
      [...table.querySelectorAll('tbody td')].map((cell) => cell.textContent),
      ['علی', '۳۰'],
    );
    const heads = [...table.querySelectorAll('thead th')];
    assert.equal(heads[0].style.textAlign, 'start');
    assert.equal(heads[1].style.textAlign, 'end');
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_render_inline_marks_when_cells_are_formatted', () => {
  const { host, editor } = createEditor('متن\n\n| **a** |\n|---|\n| [l](https://e.com) |');
  try {
    const table = host.querySelector('.parsi-table');
    assert.ok(table, 'expected a table widget');
    assert.ok(table.querySelector('thead th strong'), 'expected bold in the header');
    const anchor = table.querySelector('tbody td a');
    assert.ok(anchor, 'expected a link in the body');
    assert.equal(anchor.getAttribute('href'), 'https://e.com');
    assert.equal(anchor.getAttribute('target'), '_blank');
    assert.equal(anchor.textContent, 'l');
    assert.ok(!table.textContent.includes('**'), 'expected no raw marks');
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_keep_source_when_cursor_touches_table', () => {
  // A table opening the document is touched at the boundary cursor (like
  // links) and keeps its source.
  const { host, editor } = createEditor('| a |\n|---|\n| 1 |');
  try {
    assert.equal(host.querySelector('.parsi-table'), null);
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_render_when_cursor_leaves_after_paste', () => {
  // Pasting parks the cursor at the table end (source showing); moving
  // away — like clicking elsewhere — renders the widget.
  const { host, editor } = createEditor('| ستون ۱ | ستون ۲ |\n|---|---|\n| محتوا | محتوا |\n\nمتن بعد');
  try {
    assert.equal(host.querySelector('.parsi-table'), null);
    editor.gotoLine(5);
    const table = host.querySelector('.parsi-table');
    assert.ok(table, 'expected the table widget after leaving');
    assert.deepEqual(
      [...table.querySelectorAll('tbody td')].map((cell) => cell.textContent),
      ['محتوا', 'محتوا'],
    );
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_paint_tables_when_theme_is_loaded', () => {
  const { host, editor } = createEditor('متن\n\n| a |\n|---|\n| 1 |');
  try {
    const styleSheets = [...document.styleSheets];
    const has = (selector, property, expected) => styleSheets.some((sheet) => {
      try {
        return [...sheet.cssRules].some((rule) => rule.selectorText?.includes(selector) && rule.style?.getPropertyValue(property).includes(expected));
      } catch {
        return false;
      }
    });
    assert.ok(has('.parsi-table', 'border-collapse', 'collapse'));
    assert.ok(has('.parsi-table-wrapper', 'overflow-x', 'auto'));
    assert.ok(has('.parsi-table thead th', 'font-weight', '700'));
  } finally {
    editor.destroy();
    host.remove();
  }
});
