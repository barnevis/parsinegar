// Verifies shared HTML helpers (pure, no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { escapeHtml } from '../../../components/workbench/html.js';

test('should_escape_markup_when_text_contains_it', () => {
  assert.equal(escapeHtml('<img src="x">'), '&lt;img src=&quot;x&quot;&gt;');
  assert.equal(escapeHtml('a&b'), 'a&amp;b');
});

test('should_pass_plain_text_when_safe', () => {
  assert.equal(escapeHtml('سلام دنیا'), 'سلام دنیا');
  assert.equal(escapeHtml(null), '');
});
