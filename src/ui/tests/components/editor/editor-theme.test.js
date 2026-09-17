// Verifies the editor dark color-scheme extensions.
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { editorColorScheme } from '../../../components/editor/editor-theme.js';

test('should_return_no_extensions_when_scheme_is_light', () => {
  assert.deepEqual(editorColorScheme('light'), []);
});

test('should_return_no_extensions_when_scheme_is_unknown', () => {
  assert.deepEqual(editorColorScheme('device'), []);
  assert.deepEqual(editorColorScheme(), []);
});

test('should_return_theme_extensions_when_scheme_is_dark', () => {
  const extensions = editorColorScheme('dark');
  assert.equal(extensions.length, 1);
});
