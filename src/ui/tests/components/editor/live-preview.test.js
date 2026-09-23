// Verifies the live-preview extensions (real CodeMirror in jsdom).
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorSelection, EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { createMarkdownView } from '../../../components/editor/markdown-view.js';
import { buildMarkRevealDecorations, collectExtendedMarkRanges, collectInlineContainers, selectionTouches } from '../../../components/editor/live-preview.js';

function createEditor(documentText) {
  const host = document.createElement('div');
  document.body.append(host);
  return { host, editor: createMarkdownView(host, { document: documentText }) };
}

function destroy({ host, editor }) {
  editor.destroy();
  host.remove();
}

/**
 * Checks that an injected stylesheet rule targets a selector with a declaration.
 * @param {string} selector Fragment of the rule selector (e.g. '.parsi-h1').
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

test('should_remove_focus_outline_when_rendered', () => {
  const mounted = createEditor('متن');
  try {
    assert.ok(hasRule('.cm-focused', 'outline', 'none'));
  } finally {
    destroy(mounted);
  }
});

test('should_hide_marks_when_rendered', () => {
  const mounted = createEditor('متن\n\n# سلام');
  try {
    const marks = [...mounted.host.querySelectorAll('.parsi-mark')];
    assert.ok(marks.length > 0, 'expected mark spans');
    // jsdom does not compute font-size; the injected rule is authoritative.
    assert.ok(hasRule('.parsi-mark', 'font-size', '0'));
  } finally {
    destroy(mounted);
  }
});

test('should_hide_heading_marks_despite_heading_styles_when_rendered', () => {
  const mounted = createEditor('# سلام');
  try {
    const mark = [...mounted.host.querySelectorAll('.parsi-mark')]
      .find((span) => span.textContent === '#');
    assert.ok(mark, 'expected a heading mark span');
    assert.ok(mark.classList.contains('parsi-h1'), 'heading marks carry content classes too');
    assert.ok(hasRule('.cm-line .parsi-mark', 'font-size', '0'));
  } finally {
    destroy(mounted);
  }
});

test('should_style_heading_when_rendered', () => {
  const mounted = createEditor('# سلام');
  try {
    const heading = mounted.host.querySelector('.parsi-h1');
    assert.ok(heading, 'expected a heading span');
    assert.ok(hasRule('.parsi-h1', 'font-size', '1.7em'));
    assert.ok(hasRule('.parsi-heading', 'font-weight', '700'));
  } finally {
    destroy(mounted);
  }
});

test('should_style_strikethrough_when_rendered', () => {
  const mounted = createEditor('متن\n\n~~خط خورده~~');
  try {
    const struck = mounted.host.querySelector('.parsi-strike');
    assert.ok(struck, 'expected a strikethrough span');
    assert.ok(hasRule('.parsi-strike', 'text-decoration', 'line-through'));
  } finally {
    destroy(mounted);
  }
});

test('should_decorate_quote_line_when_rendered', () => {
  const mounted = createEditor('> نقل‌قول');
  try {
    const line = mounted.host.querySelector('.cm-line.parsi-quote-line');
    assert.ok(line, 'expected a decorated quote line');
  } finally {
    destroy(mounted);
  }
});

test('should_replace_bullet_with_marker_when_rendered', () => {
  const mounted = createEditor('متن\n\n- مورد');
  try {
    const marker = mounted.host.querySelector('.parsi-list-marker');
    assert.ok(marker, 'expected a list marker widget');
    assert.equal(marker.textContent, '• ');
  } finally {
    destroy(mounted);
  }
});

test('should_keep_number_in_marker_when_ordered', () => {
  const mounted = createEditor('متن\n\n۱. نخست\n۲. دوم');
  try {
    const markers = [...mounted.host.querySelectorAll('.parsi-list-marker')];
    assert.ok(markers.length >= 1, 'expected marker widgets');
    assert.ok(markers[0].textContent.startsWith('۱'));
  } finally {
    destroy(mounted);
  }
});

test('should_reveal_span_marks_when_cursor_is_on_its_edge', () => {
  const mounted = createEditor('**a** متن **b**');
  try {
    // No focus(): the pristine selection (cursor at 0) keeps this
    // deterministic — focusing would read stale jsdom DOM selections.
    // Exactly one span's pair opens (line-level reveal would open all four).
    const open = [...mounted.host.querySelectorAll('.parsi-mark-open')];
    assert.equal(open.length, 2);
    assert.ok(open.every((span) => span.textContent === '**'));
    assert.ok(hasRule('.parsi-mark.parsi-mark-open', 'font-size', '1rem'));
    assert.ok(hasRule('.parsi-mark-open .parsi-mark', 'font-size', '1rem'));
  } finally {
    destroy(mounted);
  }
});

test('should_keep_all_marks_hidden_when_cursor_is_on_plain_text', () => {
  const mounted = createEditor('متن **b**');
  try {
    assert.equal(mounted.host.querySelectorAll('.parsi-mark-open').length, 0);
  } finally {
    destroy(mounted);
  }
});

test('should_reveal_link_mark_when_cursor_is_on_it', () => {
  const mounted = createEditor('[متن](https://x.ir)');
  try {
    const open = [...mounted.host.querySelectorAll('.parsi-mark-open')];
    assert.ok(open.length > 0, 'expected an open mark');
    assert.ok(open.some((span) => span.textContent === '['));
  } finally {
    destroy(mounted);
  }
});

test('should_decorate_code_block_when_fenced', () => {
  const mounted = createEditor('```\ncode\n```');
  try {
    const codeLine = mounted.host.querySelector('.cm-line.parsi-code-line');
    assert.ok(codeLine, 'expected a decorated code line');
  } finally {
    destroy(mounted);
  }
});

test('should_collect_reveal_spans_when_tree_has_them', () => {
  const doc = '# تیتر\n\n> نقل\n\n- مورد\n\n**پررنگ** و `کد`';
  const tree = markdownLanguage.parser.parse(doc);
  const containers = collectInlineContainers(tree, 0, doc.length);
  const kinds = containers.map(({ from, to }) => doc.slice(from, to));
  assert.ok(kinds.includes('# تیتر'), `expected the heading span, got ${JSON.stringify(kinds)}`);
  assert.ok(kinds.includes('**پررنگ**'), `expected the strong span, got ${JSON.stringify(kinds)}`);
  assert.ok(kinds.includes('`کد`'), `expected the code span, got ${JSON.stringify(kinds)}`);
  assert.ok(!kinds.some((span) => span.startsWith('>')), 'expected no quote span');
  assert.ok(!kinds.some((span) => span.startsWith('- ')), 'expected no list span');
});

test('should_extend_marks_over_delimiter_spaces_when_collected', () => {
  const doc = '# سلام\n\n> نقل\n\nعنوان\n===';
  const state = EditorState.create({ doc });
  const tree = markdownLanguage.parser.parse(doc);
  const ranges = collectExtendedMarkRanges(state.doc, tree, 0, doc.length);
  const kinds = ranges.map(({ from, to }) => doc.slice(from, to));
  assert.ok(kinds.includes('# '), `expected the heading mark plus space, got ${JSON.stringify(kinds)}`);
  assert.ok(kinds.includes('> '), `expected the quote mark plus space, got ${JSON.stringify(kinds)}`);
  assert.ok(kinds.includes('==='), `expected the bare underline unchanged, got ${JSON.stringify(kinds)}`);
});

test('should_extend_marks_over_space_runs_when_collected', () => {
  const doc = '#  سلام';
  const state = EditorState.create({ doc });
  const tree = markdownLanguage.parser.parse(doc);
  const ranges = collectExtendedMarkRanges(state.doc, tree, 0, doc.length);
  assert.deepEqual(ranges.map(({ from, to }) => doc.slice(from, to)), ['#  ']);
});

test('should_hide_delimiter_space_when_heading_is_not_touched', () => {
  const mounted = createEditor('متن\n\n# سلام');
  try {
    const hidden = [...mounted.host.querySelectorAll('.parsi-mark')]
      .find((span) => span.textContent === '# ');
    assert.ok(hidden, 'expected the extended hidden span');
    assert.ok(!hidden.classList.contains('parsi-mark-open'), 'expected it hidden');
  } finally {
    destroy(mounted);
  }
});

test('should_hide_delimiter_space_when_quote_is_not_touched', () => {
  const mounted = createEditor('متن\n\n> نقل');
  try {
    const hidden = [...mounted.host.querySelectorAll('.parsi-mark')]
      .find((span) => span.textContent === '> ');
    assert.ok(hidden, 'expected the extended hidden span');
    assert.ok(!hidden.classList.contains('parsi-mark-open'), 'expected it hidden');
  } finally {
    destroy(mounted);
  }
});

test('should_reveal_delimiter_space_when_cursor_is_on_heading', () => {
  // Pristine cursor sits at 0 — on the opening hashes — so the extended
  // range opens together with the marks themselves.
  const mounted = createEditor('## سلام');
  try {
    const open = [...mounted.host.querySelectorAll('.parsi-mark-open')];
    assert.ok(open.some((span) => span.textContent === '## '), 'expected the extended open span');
  } finally {
    destroy(mounted);
  }
});

test('should_sort_mixed_decorations_when_selection_touches_later_marks', () => {
  // Cursor inside the bold pair: the `**` marks open while the earlier
  // heading mark stays hidden. Pushing the later ranges first used to crash
  // the RangeSetBuilder on real clicks (`Ranges must be added sorted`).
  const doc = '# تیتر\n\n**bold**';
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(11),
    extensions: [markdown()],
  });
  const decorations = buildMarkRevealDecorations({ state, visibleRanges: [{ from: 0, to: doc.length }] });
  const found = [];
  decorations.between(0, doc.length, (from, to, value) => {
    found.push({ from, to, cls: value.spec.class });
  });
  assert.deepEqual(found, [
    { from: 0, to: 2, cls: 'parsi-mark' },
    { from: 8, to: 10, cls: 'parsi-mark-open' },
    { from: 14, to: 16, cls: 'parsi-mark-open' },
  ]);
});

test('should_reveal_setext_marks_when_cursor_is_on_heading_text', () => {
  // Pristine cursor sits at 0 — on the heading text, not on the `===`
  // underline — so only whole-heading reveal (not exact overlap) opens it.
  const mounted = createEditor('سلام\n===');
  try {
    const open = [...mounted.host.querySelectorAll('.parsi-mark-open')];
    assert.ok(open.some((span) => span.textContent === '==='), 'expected the underline revealed');
  } finally {
    destroy(mounted);
  }
});

test('should_reveal_atx_marks_when_cursor_is_on_heading', () => {
  // Pristine cursor sits at 0 — on the opening hashes (exact overlap) —
  // which opens them through the same container path as standing on the
  // heading text further right.
  const mounted = createEditor('## سلام');
  try {
    const open = [...mounted.host.querySelectorAll('.parsi-mark-open')];
    assert.ok(open.some((span) => span.textContent === '##'), 'expected the hashes revealed');
  } finally {
    destroy(mounted);
  }
});

test('should_touch_ranges_when_selection_overlaps', () => {
  const spanned = { ranges: [{ from: 2, to: 8, empty: false }] };
  assert.equal(selectionTouches(spanned, 0, 5), true);
  assert.equal(selectionTouches(spanned, 8, 12), true);
  assert.equal(selectionTouches(spanned, 9, 12), false);
  assert.equal(selectionTouches(spanned, 0, 1), false);
});

test('should_ignore_collapsed_cursors_when_touching', () => {
  const cursor = { ranges: [{ from: 5, to: 5, empty: true }] };
  assert.equal(selectionTouches(cursor, 0, 10), false);
});

test('should_keep_code_unpainted_when_cursor_is_collapsed', () => {
  // Pristine cursor is collapsed: the chip renders, but nothing paints.
  const mounted = createEditor('متن `کد`');
  try {
    assert.ok(mounted.host.querySelector('.parsi-code'), 'expected the chip');
    assert.equal(mounted.host.querySelectorAll('.parsi-selected').length, 0);
  } finally {
    destroy(mounted);
  }
});

test('should_keep_fence_line_unpainted_when_cursor_is_collapsed', () => {
  const mounted = createEditor('```\ncode\n```');
  try {
    const line = mounted.host.querySelector('.cm-line.parsi-code-line');
    assert.ok(line, 'expected the fence line');
    assert.ok(!line.classList.contains('parsi-selected'), 'expected no paint');
  } finally {
    destroy(mounted);
  }
});
