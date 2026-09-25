// Verifies the product icon sprite contract (shape + symbol ids).
//
// All symbols are Google Material Symbols (Apache License 2.0) with
// `currentColor` ink, so they follow the theme text color like any text.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SPRITE_URL = new URL('../../assets/icons.svg', import.meta.url);
const REQUIRED_SYMBOLS = ['file-copy', 'toc', 'delete', 'settings', 'add-notes', 'sort', 'upload', 'content-copy', 'check', 'search', 'lock', 'lock-open'];

test('should_define_required_symbols_when_sprite_is_loaded', async () => {
  const markup = await readFile(SPRITE_URL, 'utf8');
  for (const symbol of REQUIRED_SYMBOLS) {
    assert.ok(markup.includes(`id="${symbol}"`), `expected symbol: ${symbol}`);
  }
  const ids = [...markup.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  for (const id of ids) {
    // Same strict kebab-case the kit enforces in createIconMarkup.
    assert.match(id, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
  }
  assert.ok(markup.includes('fill="currentColor"'), 'expected theme-following ink');
});
