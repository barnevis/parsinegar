// Verifies table readability collection (pure) and role washes.
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

test('should_collect_table_span_when_scanning', () => {
  const tables = collect('متن\n\n| a | b |\n|---|---|\n| 1 | 2 |');
  assert.equal(tables.length, 1);
  assert.ok(tables[0].from > 0 && tables[0].to <= 'متن\n\n| a | b |\n|---|---|\n| 1 | 2 |'.length);
});

test('should_skip_touched_table_when_selected', () => {
  const text = 'متن\n\n| a |\n|---|\n| 1 |';
  assert.equal(collect(text, { anchor: 0 }).length, 1);
  assert.equal(collect(text, { anchor: 10 }).length, 0);
});

test('should_skip_fenced_tables_when_scanning', () => {
  const tables = collect('```\n| a |\n|---|\n| 1 |\n```\n\n| b |\n|---|\n| 2 |');
  assert.equal(tables.length, 1);
});

function createEditor(documentText) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: documentText });
  return { host, editor };
}

test('should_wash_roles_when_table_is_present', () => {
  const { host, editor } = createEditor('متن\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |');
  try {
    const lines = [...host.querySelectorAll('.cm-line')];
    const byText = (start) => lines.find((line) => line.textContent.startsWith(start));
    assert.ok(byText('| a | b |').classList.contains('parsi-table-header'), 'expected the header wash');
    assert.ok(byText('|---|---|').classList.contains('parsi-table-delimiter'), 'expected the delimiter wash');
    assert.ok(byText('| 1 | 2 |').classList.contains('parsi-table-row'), 'expected a plain body row');
    assert.ok(byText('| 3 | 4 |').classList.contains('parsi-table-row-alt'), 'expected the zebra row');
    assert.ok(!byText('متن').classList.contains('parsi-table-header'));
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_leave_source_alone_when_cursor_touches_table', () => {
  // Fresh cursor at 0 sits before the table here... a table opening the
  // document is touched at the boundary (like links) and stays plain.
  const { host, editor } = createEditor('| a |\n|---|\n| 1 |');
  try {
    for (const line of host.querySelectorAll('.cm-line')) {
      assert.ok(!line.classList.contains('parsi-table-header'), 'expected no wash while touched');
    }
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_paint_roles_when_theme_is_loaded', () => {
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
    assert.ok(has('.parsi-table-header', 'font-weight', '700'));
    assert.ok(has('.parsi-table-delimiter', 'color', 'text-muted'));
    assert.ok(has('.parsi-table-row-alt', 'background-color', '127'));
  } finally {
    editor.destroy();
    host.remove();
  }
});
