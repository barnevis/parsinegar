// Verifies link target resolution (pure) and modifier-click follow-through.
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { createMarkdownView } from '../../../components/editor/markdown-view.js';
import { linkHrefAt } from '../../../components/editor/link-follow.js';

function stateWith(text) {
  return EditorState.create({
    doc: text,
    extensions: [markdown({ base: markdownLanguage })],
  });
}

test('should_resolve_href_when_inside_link_label', () => {
  const state = stateWith('متن [گیت‌هاب](https://example.com/x) بعد');
  assert.equal(linkHrefAt(state, 8), 'https://example.com/x');
});

test('should_reject_non_links_and_local_targets_when_resolving', () => {
  assert.equal(linkHrefAt(stateWith('متن ساده'), 2), '');
  assert.equal(linkHrefAt(stateWith('[a](./x)'), 2), '');
  assert.equal(linkHrefAt(stateWith('[a](#frag)'), 2), '');
  assert.equal(linkHrefAt(stateWith('[a](https://example.com/x)'), -1), '');
  assert.equal(linkHrefAt(stateWith('[a](https://example.com/x)'), 999), '');
});

test('should_reject_fragment_href_when_image_is_linked', () => {
  // `#` is not remote: the picture itself navigates natively instead.
  const state = stateWith('[![b](https://img.example/x)](#)');
  assert.equal(linkHrefAt(state, 10), '');
});

function createEditor(documentText) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createMarkdownView(host, { document: documentText });
  return { host, editor };
}

test('should_open_target_when_ctrl_click_lands_on_label', () => {
  const { host, editor } = createEditor('متن [گیت‌هاب](https://example.com/x) بعد');
  const realOpen = window.open;
  const opened = [];
  window.open = (url, target, features) => {
    opened.push({ url, target, features });
    return null;
  };
  try {
    const label = host.querySelector('.parsi-link');
    assert.ok(label, 'expected a link label');
    label.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    assert.deepEqual(opened, [{ url: 'https://example.com/x', target: '_blank', features: 'noopener' }]);
  } finally {
    window.open = realOpen;
    editor.destroy();
    host.remove();
  }
});

test('should_keep_cursor_when_plain_click_lands_on_label', () => {
  const { host, editor } = createEditor('متن [گیت‌هاب](https://example.com/x) بعد');
  const realOpen = window.open;
  let calls = 0;
  window.open = () => {
    calls += 1;
    return null;
  };
  try {
    const label = host.querySelector('.parsi-link');
    assert.ok(label, 'expected a link label');
    label.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(calls, 0);
  } finally {
    window.open = realOpen;
    editor.destroy();
    host.remove();
  }
});
