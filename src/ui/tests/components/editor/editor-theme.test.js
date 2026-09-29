// Verifies the editor dark color-scheme extensions.
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { editorColorScheme } from '../../../components/editor/editor-theme.js';

test('should_return_theme_for_light_scheme_when_queried', () => {
  // Every color has a single source in the scheme theme (including light),
  // so no selector collides across tags.
  assert.equal(editorColorScheme('light').length, 1);
});

test('should_fall_back_to_light_when_scheme_is_unknown', () => {
  assert.equal(editorColorScheme('device').length, 1);
  assert.equal(editorColorScheme().length, 1);
});

test('should_return_theme_extensions_when_scheme_is_dark', () => {
  const extensions = editorColorScheme('dark');
  assert.equal(extensions.length, 1);
});

test('should_return_theme_extensions_when_scheme_is_sepia', () => {
  const extensions = editorColorScheme('sepia');
  assert.equal(extensions.length, 1);
});
