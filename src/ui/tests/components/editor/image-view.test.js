// Verifies live-image collection (pure, headless EditorState, no view).
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { collectImagesFrom } from '../../../components/editor/image-view.js';

function stateWith(text, selection) {
  return EditorState.create({
    doc: text,
    selection: selection ?? { anchor: 0 },
    extensions: [markdown({ base: markdownLanguage })],
  });
}

function collect(text, selection) {
  const state = stateWith(text, selection);
  return collectImagesFrom(state, 0, state.doc.length);
}

test('should_collect_remote_image_when_scanning', () => {
  const images = collect('متن ![alt text](https://example.com/a.png) بعد');
  assert.equal(images.length, 1);
  assert.deepEqual(images[0], {
    from: 4,
    to: 42,
    alt: 'alt text',
    src: 'https://example.com/a.png',
    href: '',
  });
});

test('should_keep_outer_target_when_image_is_linked', () => {
  const images = collect('[![badge](https://img.shields.io/x)](#)');
  assert.equal(images.length, 1);
  assert.equal(images[0].src, 'https://img.shields.io/x');
  assert.equal(images[0].href, '#');
  assert.equal(images[0].alt, 'badge');
});

test('should_skip_local_images_when_scanning', () => {
  // Leading text parks the default cursor (0) off every span: a boundary
  // cursor reveals the source like links do, which would also skip.
  assert.deepEqual(collect('متن ![a](./x.png)'), []);
  assert.deepEqual(collect('متن ![a](/abs/y.png)'), []);
  assert.deepEqual(collect('متن ![a](data:image/png;base64,AAA)'), []);
  // Reference-style images own no URL child (the definition is a separate
  // LinkReference node), so they keep the alt-text rendering.
  assert.deepEqual(collect('متن ![a][ref]\n\n[ref]: https://example.com/a.png'), []);
  assert.deepEqual(collect('متن ![](https://example.com/a.png)').length, 1);
});

test('should_skip_touched_image_when_selected', () => {
  const text = 'متن ![alt](https://example.com/a.png) بعد';
  assert.equal(collect(text, { anchor: 0 }).length, 1);
  assert.equal(collect(text, { anchor: 10 }).length, 0);
  assert.equal(collect(text, { anchor: 4, head: 8 }).length, 0);
});

test('should_skip_fenced_images_when_scanning', () => {
  const images = collect('```\n![a](https://example.com/a.png)\n```\n\n![b](https://example.com/b.png)');
  assert.equal(images.length, 1);
  assert.equal(images[0].src, 'https://example.com/b.png');
});

test('should_sort_images_when_scanning', () => {
  const text = '![b](https://example.com/b.png) و ![a](https://example.com/a.png)';
  // Park the cursor on the middle word: boundary cursors reveal like links.
  const images = collect(text, { anchor: 33 });
  assert.deepEqual(images.map((image) => image.alt), ['b', 'a']);
  assert.ok(images[0].from < images[1].from);
});
