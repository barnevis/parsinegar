// Verifies the themed logotype markup (pure, no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { logoMarkup } from '../../../components/workbench/logo.js';

test('should_render_inline_svg_when_called', () => {
  const markup = logoMarkup();
  assert.ok(markup.startsWith('<svg'));
  assert.ok(markup.includes('viewBox="0 0 99 129"'));
  assert.ok(markup.includes('fill="currentColor"'), 'expected theme-following ink');
  assert.ok(markup.includes('aria-hidden="true"'));
  assert.equal(markup.match(/<path /g)?.length, 5);
});
