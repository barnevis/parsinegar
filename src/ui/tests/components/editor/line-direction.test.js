// Verifies line-direction resolution and per-line direction decorations.
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarkdownView } from '../../../components/editor/markdown-view.js';
import { isNeutralLine, resolveLineDirection } from '../../../components/editor/line-direction.js';

test('should_detect_neutral_lines_when_checking_text', () => {
  assert.equal(isNeutralLine(''), true);
  assert.equal(isNeutralLine('   '), true);
  assert.equal(isNeutralLine('۱۲۳'), true);
  assert.equal(isNeutralLine('# '), true);
  assert.equal(isNeutralLine('- '), true);
  assert.equal(isNeutralLine('```'), true);
});

test('should_detect_content_lines_when_checking_text', () => {
  assert.equal(isNeutralLine('سلام'), false);
  assert.equal(isNeutralLine('a'), false);
  assert.equal(isNeutralLine('۱۲۳a'), false);
  assert.equal(isNeutralLine(null), false);
  assert.equal(isNeutralLine(42), false);
});

test('should_resolve_rtl_when_first_letter_is_rtl', () => {
  assert.equal(resolveLineDirection('سلام'), 'rtl');
  assert.equal(resolveLineDirection('- باتری محتوایی'), 'rtl');
  assert.equal(resolveLineDirection('**نکته فنی:**'), 'rtl');
  assert.equal(resolveLineDirection('«نقل‌قول»'), 'rtl');
});

test('should_resolve_ltr_when_first_letter_is_latin', () => {
  assert.equal(resolveLineDirection('Hello'), 'ltr');
  assert.equal(resolveLineDirection('- item ۱۲۳'), 'ltr');
  assert.equal(resolveLineDirection('# Title'), 'ltr');
  assert.equal(resolveLineDirection('۱۲۳a'), 'ltr');
  assert.equal(resolveLineDirection('(test) تست'), 'ltr');
});

test('should_resolve_null_when_line_has_no_letter', () => {
  assert.equal(resolveLineDirection(''), null);
  assert.equal(resolveLineDirection('   '), null);
  assert.equal(resolveLineDirection('۱۲۳'), null);
  assert.equal(resolveLineDirection('- '), null);
  assert.equal(resolveLineDirection('```'), null);
  assert.equal(resolveLineDirection(null), null);
  assert.equal(resolveLineDirection(42), null);
});

test('should_pin_every_line_when_mounted', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: 'سلام\nHello\n۱۲۳', direction: 'auto' });
  try {
    const lines = [...host.querySelectorAll('.cm-line')];
    assert.equal(lines.length, 3);
    assert.ok(lines[0].classList.contains('parsi-dir-rtl'), 'expected the Persian line pinned right');
    assert.ok(lines[1].classList.contains('parsi-dir-ltr'), 'expected the English line pinned left');
    assert.ok(lines[2].classList.contains('parsi-base-rtl'), 'expected the digits line on the base');
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_lock_every_line_when_direction_is_rtl', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: 'سلام\nHello\n۱۲۳', direction: 'rtl' });
  try {
    const lines = [...host.querySelectorAll('.cm-line')];
    assert.equal(lines.length, 3);
    for (const line of lines) {
      assert.ok(line.classList.contains('parsi-base-rtl'), 'expected every line on the rtl base');
      assert.ok(!line.classList.contains('parsi-dir-ltr'), 'expected no per-line ltr');
    }
    const english = globalThis.getComputedStyle(lines[1]);
    assert.equal(english.direction, 'rtl');
    assert.equal(english.textAlign, 'right');
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_lock_every_line_when_direction_is_ltr', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: 'سلام\nHello', direction: 'ltr' });
  try {
    const lines = [...host.querySelectorAll('.cm-line')];
    assert.equal(lines.length, 2);
    for (const line of lines) {
      assert.ok(line.classList.contains('parsi-base-ltr'), 'expected every line on the ltr base');
    }
    const persian = globalThis.getComputedStyle(lines[0]);
    assert.equal(persian.direction, 'ltr');
    assert.equal(persian.textAlign, 'left');
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_keep_fenced_code_ltr_when_direction_is_rtl', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: 'متن\n```\nکد فارسی\n```\nبعد', direction: 'rtl' });
  try {
    const lines = [...host.querySelectorAll('.cm-line')];
    assert.equal(lines.length, 5);
    assert.ok(lines[0].classList.contains('parsi-base-rtl'), 'expected the text line locked right');
    assert.ok(lines[1].classList.contains('parsi-base-rtl'), 'expected the fence marker on the base');
    assert.ok(lines[2].classList.contains('parsi-dir-ltr'), 'expected the code line left');
    assert.ok(lines[3].classList.contains('parsi-base-rtl'), 'expected the fence marker on the base');
    assert.ok(lines[4].classList.contains('parsi-base-rtl'), 'expected the text line locked right');
    const code = globalThis.getComputedStyle(lines[2]);
    assert.equal(code.direction, 'ltr');
    assert.equal(code.textAlign, 'left');
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_detect_code_per_line_when_direction_is_auto', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: 'متن\n```\nتوضیح فارسی\n```', direction: 'auto' });
  try {
    const lines = [...host.querySelectorAll('.cm-line')];
    assert.ok(lines[0].classList.contains('parsi-dir-rtl'), 'expected the text line right');
    assert.ok(lines[2].classList.contains('parsi-dir-rtl'), 'expected per-line detection inside fences in auto');
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_align_lines_explicitly_when_mounted', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: 'سلام\nHello', direction: 'auto' });
  try {
    const lines = [...host.querySelectorAll('.cm-line')];
    const persian = globalThis.getComputedStyle(lines[0]);
    const english = globalThis.getComputedStyle(lines[1]);
    assert.equal(persian.direction, 'rtl');
    assert.equal(persian.textAlign, 'right');
    assert.equal(english.direction, 'ltr');
    assert.equal(english.textAlign, 'left');
  } finally {
    editor.destroy();
    host.remove();
  }
});
test('should_pin_neutral_lines_when_mounted', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: '۱۲۳\nسلام', direction: 'auto' });
  try {
    const lines = [...host.querySelectorAll('.cm-line')];
    assert.equal(lines.length, 2);
    assert.ok(lines[0].classList.contains('parsi-base-rtl'), 'expected the digits line pinned');
    assert.ok(!lines[1].classList.contains('parsi-base-rtl'), 'expected the text line untouched');
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_pin_ltr_base_when_direction_is_ltr', () => {
  const host = document.createElement('div');
  document.body.append(host);
  // NOTE: an empty document has no visible ranges in jsdom, so a neutral
  // content line stands in (real browsers decorate the empty line too).
  const editor = createMarkdownView(host, { document: '۱۲۳', direction: 'ltr' });
  try {
    const line = host.querySelector('.cm-line');
    assert.ok(line.classList.contains('parsi-base-ltr'), 'expected the digits line pinned left');
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('should_pin_empty_document_when_mounted', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: '' });
  try {
    const line = host.querySelector('.cm-line');
    assert.ok(line.classList.contains('parsi-base-rtl'), 'expected the empty line pinned');
  } finally {
    editor.destroy();
    host.remove();
  }
});
