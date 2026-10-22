// Verifies inline-markdown label rendering for the mindmap (pure HTML
// strings, no DOM): parser-parity marks render, everything else stays
// escaped literal text.
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderInlineHtml } from '../../../components/workbench/mindmap-inline.js';

test('should_render_parity_marks_when_lines_carry_them', () => {
  assert.equal(renderInlineHtml('الف **ب** ج'), 'الف <strong>ب</strong> ج');
  assert.equal(renderInlineHtml('متن *کج* پایان'), 'متن <em>کج</em> پایان');
  assert.equal(renderInlineHtml('الف ~~حذف~~ ج'), 'الف <del>حذف</del> ج');
  assert.equal(renderInlineHtml('کدِ `خطی` اینجا'), 'کدِ <code>خطی</code> اینجا');
});

test('should_escape_absolute_and_relative_links_when_rendered', () => {
  assert.equal(
    renderInlineHtml('[متن](https://a.b/پ?x=1)'),
    '<a href="https://a.b/پ?x=1" target="_blank" rel="noopener">متن</a>',
  );
  assert.equal(
    renderInlineHtml('[خانه](/راهنما)'),
    '<a href="/راهنما" target="_blank" rel="noopener">خانه</a>',
  );
  assert.equal(
    renderInlineHtml('[نامه](mailto:a@b.c)'),
    '<a href="mailto:a@b.c" target="_blank" rel="noopener">نامه</a>',
  );
});

test('should_fall_back_to_plain_label_when_scheme_is_disallowed', () => {
  assert.equal(renderInlineHtml('[خطر](javascript:alert(1))'), 'خطر');
  assert.equal(renderInlineHtml('[داده](data:text/html,سلام)'), 'داده');
});

test('should_render_autolink_with_url_as_label', () => {
  assert.equal(
    renderInlineHtml('<https://auto.link>'),
    '<a href="https://auto.link" target="_blank" rel="noopener">https://auto.link</a>',
  );
});

test('should_escape_raw_html_and_entities_when_labels_carry_them', () => {
  assert.equal(
    renderInlineHtml('<b>html</b> و &amp; باقی'),
    '&lt;b&gt;html&lt;/b&gt; و &amp;amp; باقی',
  );
});

test('should_strip_backslash_marks_while_keeping_the_char_when_escaped', () => {
  assert.equal(renderInlineHtml('متن \\* ستاره'), 'متن * ستاره');
});

test('should_keep_literal_text_when_marks_are_unbalanced', () => {
  assert.equal(renderInlineHtml('**نابالانس'), '**نابالانس');
  assert.equal(renderInlineHtml('==برجسته== باقی'), '==برجسته== باقی');
});

test('should_render_image_label_without_href_when_images_appear', () => {
  assert.equal(renderInlineHtml('![تصویر](src.png)'), 'تصویر');
});

test('should_nest_marks_when_source_nests_them', () => {
  assert.equal(renderInlineHtml('***هر*** دو'), '<em><strong>هر</strong></em> دو');
});

test('should_escape_label_content_when_link_text_carries_marks_and_brackets', () => {
  assert.equal(
    renderInlineHtml('[<b>عنوان</b>](https://x)'),
    '<a href="https://x" target="_blank" rel="noopener">&lt;b&gt;عنوان&lt;/b&gt;</a>',
  );
});

test('should_return_empty_when_input_is_blank_or_not_text', () => {
  assert.equal(renderInlineHtml(''), '');
  assert.equal(renderInlineHtml('   '), '');
  assert.equal(renderInlineHtml(null), '');
  assert.equal(renderInlineHtml(42), '');
});
