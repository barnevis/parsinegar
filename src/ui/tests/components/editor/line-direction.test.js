// Verifies neutral-line detection and base-direction decorations.
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarkdownView } from '../../../components/editor/markdown-view.js';
import { isNeutralLine } from '../../../components/editor/line-direction.js';

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

test('should_pin_neutral_lines_when_mounted', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: '۱۲۳\nسلام' });
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
