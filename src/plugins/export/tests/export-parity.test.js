// Verifies export parity with the editor: every syntax the editor
// understands renders in the export too (real pey.markdown pipeline).
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import MarkdownService from 'pey.markdown/lib/markdown-service.js';
import { highlight, highlightHtml } from '../lib/mark-extension.js';
import {
  persianFootnoteOptionsForRender,
  persianHtmlExtensions,
  persianSyntaxExtensions,
} from '../lib/persian-extensions.js';

const markdownService = new MarkdownService({});

function render(markdown) {
  return markdownService
    .renderFragment({
      markdown,
      syntaxExtensions: [...persianSyntaxExtensions(), highlight()],
      htmlExtensions: [...persianHtmlExtensions(), highlightHtml()],
      footnoteOptions: persianFootnoteOptionsForRender(),
    })
    .html;
}

test('should_render_gfm_tables_tasks_and_strikethrough_when_exported', () => {
  const html = render('| a | b |\n|---|---|\n| ۱ | ۲ |\n\n- [ ] باز\n- [x] بسته\n\n~~خط~~\n\nhttps://example.com\n');
  assert.ok(html.includes('<table>'), 'table');
  assert.ok(html.includes('type="checkbox"'), 'task checkbox');
  assert.ok(html.includes('<del>خط</del>') || html.includes('<s>خط</s>') || html.includes('<strike>'), 'strikethrough');
  assert.ok(html.includes('<a href="https://example.com">'), 'autolink');
});

test('should_render_persian_admonitions_attached_and_spaced_when_exported', () => {
  const attached = render('...هشدار\nمتن\n...\n');
  const spaced = render('... نکته\nمتن\n...\n');
  assert.ok(attached.includes('parsneshan-warning'), 'attached opener');
  assert.ok(spaced.includes('parsneshan-note'), 'spaced opener');
  assert.ok(attached.includes('<p>متن</p>'), 'markdown inside block');
});

test('should_render_persian_list_and_poem_when_exported', () => {
  const list = render('۲. الف\n۳. ب\n');
  assert.ok(list.includes('<ol start="2">'), 'start from first number');
  const poem = render('...شعر\nتو نیکی می‌کن و در دجله انداز     که ایزد در بیابانت دهد باز\n\nبه جهان خرم از آنم که جهان خرم از اوست     عاشقم بر همه عالم که همه عالم از اوست\n...\n');
  assert.ok(poem.includes('parsneshan-poem'), 'poem block');
  assert.ok(poem.includes('parsneshan-verse'), 'verses');
});

test('should_render_highlight_with_nested_formatting_when_exported', { skip: 'pending upstream mark allowlist in pey.markdown sanitizer' }, () => {
  const html = render('این ==متن **مهم**== است.');
  assert.ok(html.includes('<mark>متن <strong>مهم</strong></mark>'), 'mark with nested strong');
});

test('should_render_rule_but_keep_setext_heading_when_exported', () => {
  assert.ok(render('متن\n\n---\n\nبعد').includes('<hr'), 'thematic break');
  const setext = render('عنوان\n---\n');
  assert.ok(setext.includes('<h2'), 'setext stays a heading');
  assert.ok(!setext.includes('<hr'), 'no rule for setext underline');
  assert.ok(render('```\n---\n```').includes('<code'), 'fenced dashes stay code');
});

test('should_strip_scripts_handlers_and_schemes_when_exported', () => {
  const html = render('<script>alert(1)</script>\n\n<a href="javascript:alert(1)" onclick="x()">t</a>\n\n![a](data:text/html,x)');
  assert.ok(!html.includes('<script'), 'no script tag');
  assert.ok(!html.includes('onclick'), 'no handlers');
  assert.ok(!html.includes('javascript:'), 'no js scheme');
});

test('should_keep_image_alt_when_source_is_unsafe_when_exported', () => {
  const html = render('![توضیح](data:text/html,x)');
  assert.ok(html.includes('alt="توضیح"'), 'alt survives');
});

test('should_render_footnotes_when_exported', () => {
  const html = render('متن[^۱]\n\n[^۱]: توضیح\n');
  assert.ok(html.includes('footnotes'), 'footnotes section');
  assert.ok(html.includes('توضیح'), 'footnote body');
  assert.ok(html.includes('id="user-content-fn-'), 'footnote ids survive for navigation');
});

test('should_number_from_first_digit_when_list_is_ragged', () => {
  // Browsers count <ol start> upward, so a ragged source (۲./۵.) exports
  // as ۲/۳ while the editor still shows the source digits until resequence.
  const html = render('۲. الف\n۵. ب\n');
  assert.ok(html.includes('<ol start="2">'), 'start from first number');
});

test('should_fallback_sloppy_poem_to_text_when_exported', () => {
  // Parsneshan is strict (mixed verse shapes invalidate the block) while
  // the editor renders leniently — a documented divergence, pinned here.
  const html = render('...شعر\nبیت اول مصرع اول     مصرع دوم\nبیت دوم تک‌مصرعی\n...\n');
  assert.ok(!html.includes('parsneshan-poem'), 'no poem block');
  assert.ok(html.includes('بیت اول'), 'content survives as text');
});

test('should_document_footnote_divergence_with_editor', () => {
  // The editor parses [^۱] as a link reference; the export renders GFM
  // footnotes. Pinned so either side gaining footnote support updates this.
  const doc = 'متن[^۱]\n\n[^۱]: توضیح\n';
  const state = EditorState.create({ doc, extensions: [markdown()] });
  ensureSyntaxTree(state, doc.length, 2000);
  const names = [];
  syntaxTree(state).iterate({ enter: (node) => names.push(node.name) });
  assert.ok(!names.includes('Footnote'), 'editor has no footnote node');
  assert.ok(render(doc).includes('footnotes'), 'export renders footnotes');
});
