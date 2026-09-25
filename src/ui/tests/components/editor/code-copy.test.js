// Verifies fenced-code collection, copy widgets and clipboard fallback.
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { createMarkdownView } from '../../../components/editor/markdown-view.js';
import { collectCodeBlocks, copyText } from '../../../components/editor/code-copy.js';

function createEditor(documentText, options = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  return { host, editor: createMarkdownView(host, { document: documentText, t: (key) => key, assetBaseUrl: 'http://localhost/assets/', ...options }) };
}

function destroy({ host, editor }) {
  editor.destroy();
  host.remove();
}

function fakeView(documentText) {
  const state = EditorState.create({ doc: documentText });
  return { state, visibleRanges: [{ from: 0, to: documentText.length }] };
}

test('should_collect_closed_blocks_when_scanning', () => {
  const blocks = collectCodeBlocks(fakeView('متن\n```js\nconst x = 1;\n```\nبعد'));
  assert.equal(blocks.length, 1);
  const [block] = blocks;
  assert.equal('متن\n```js\nconst x = 1;\n```\nبعد'.slice(block.from, block.to), 'const x = 1;\n');
});

test('should_collect_unclosed_blocks_when_scanning', () => {
  const blocks = collectCodeBlocks(fakeView('متن\n```\ncode\nmore'));
  assert.equal(blocks.length, 1);
  assert.equal('متن\n```\ncode\nmore'.slice(blocks[0].from, blocks[0].to), 'code\nmore');
});

test('should_skip_empty_blocks_when_scanning', () => {
  assert.deepEqual(collectCodeBlocks(fakeView('```\n```')), []);
  assert.deepEqual(collectCodeBlocks(fakeView('متن ساده')), []);
});

test('should_render_copy_button_when_fenced', () => {
  const mounted = createEditor('متن\n\n```js\nconst x = 1;\n```\n');
  try {
    const button = mounted.host.querySelector('.parsi-code-copy');
    assert.ok(button, 'expected a copy button');
    assert.equal(button.getAttribute('aria-label'), 'parsinegar.code.copy');
    assert.ok(button.querySelector('svg'), 'expected the copy icon');
    assert.ok(Number.isInteger(Number(button.dataset.copyFrom)));
    assert.ok(Number.isInteger(Number(button.dataset.copyTo)));
  } finally {
    destroy(mounted);
  }
});

test('should_copy_block_content_when_clicked', async () => {
  const written = [];
  const previous = globalThis.navigator?.clipboard;
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText: async (text) => { written.push(text); } },
    configurable: true,
  });
  const mounted = createEditor('متن\n\n```js\nconst x = 1;\n```\n');
  try {
    mounted.host.querySelector('.parsi-code-copy').dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(written, ['const x = 1;\n']);
    const button = mounted.host.querySelector('.parsi-code-copy');
    assert.equal(button.getAttribute('aria-label'), 'parsinegar.code.copied');
  } finally {
    destroy(mounted);
    if (previous === undefined) {
      delete globalThis.navigator.clipboard;
    } else {
      Object.defineProperty(globalThis.navigator, 'clipboard', { value: previous, configurable: true });
    }
  }
});

test('should_write_through_clipboard_when_available', async () => {
  const written = [];
  const previous = globalThis.navigator?.clipboard;
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText: async (text) => { written.push(text); } },
    configurable: true,
  });
  try {
    assert.equal(await copyText('سلام'), true);
    assert.deepEqual(written, ['سلام']);
  } finally {
    if (previous === undefined) {
      delete globalThis.navigator.clipboard;
    } else {
      Object.defineProperty(globalThis.navigator, 'clipboard', { value: previous, configurable: true });
    }
  }
});

test('should_fall_back_when_clipboard_rejects', async () => {
  const previousClipboard = globalThis.navigator?.clipboard;
  const previousExec = document.execCommand;
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText: async () => { throw new Error('denied'); } },
    configurable: true,
  });
  document.execCommand = () => true;
  try {
    assert.equal(await copyText('سلام'), true);
  } finally {
    if (previousClipboard === undefined) {
      delete globalThis.navigator.clipboard;
    } else {
      Object.defineProperty(globalThis.navigator, 'clipboard', { value: previousClipboard, configurable: true });
    }
    document.execCommand = previousExec;
  }
});

test('should_report_failure_when_nothing_writes', async () => {
  const previousClipboard = globalThis.navigator?.clipboard;
  const previousExec = document.execCommand;
  if (previousClipboard !== undefined) {
    delete globalThis.navigator.clipboard;
  }
  document.execCommand = undefined;
  try {
    assert.equal(await copyText('سلام'), false);
  } finally {
    if (previousClipboard !== undefined) {
      Object.defineProperty(globalThis.navigator, 'clipboard', { value: previousClipboard, configurable: true });
    }
    document.execCommand = previousExec;
  }
});
