// Verifies the status bar element.
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { TAG } from '../../../components/workbench/status-bar.js';

function createEvents() {
  return {
    subscribe: () => () => {},
    publish: () => ({ success: true }),
  };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function mount(refs = {}) {
  const element = document.createElement(TAG);
  element.connect({
    infrastructure: { events: createEvents() },
    refs: { t: (key) => key, ...refs },
  });
  document.body.append(element);
  return element;
}

function statsOf(element) {
  const value = (part) => element.shadowRoot.querySelector(`[data-stat="${part}"]`)?.textContent;
  return { chars: value('chars'), words: value('words'), lines: value('lines') };
}

test('should_render_zero_stats_when_mounted', async () => {
  const element = mount();
  try {
    await flush();
    assert.deepEqual(statsOf(element), { chars: '0', words: '0', lines: '0' });
  } finally {
    element.remove();
  }
});

test('should_update_stats_when_configured', async () => {
  const element = mount();
  try {
    await flush();
    element.configure({ stats: { chars: 10, words: 2, lines: 1 }, formatNumber: (value) => `#${value}` });
    await flush();
    assert.deepEqual(statsOf(element), { chars: '#10', words: '#2', lines: '#1' });
  } finally {
    element.remove();
  }
});
