// Verifies the status bar element.
import '../../setup-dom.js';
import '../../setup-styles.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { TAG } from '../../../components/status-bar/status-bar.js';

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
  return {
    chars: value('chars'),
    letters: value('letters'),
    words: value('words'),
    lines: value('lines'),
    size: value('size'),
  };
}

test('should_render_zero_stats_when_mounted', async () => {
  const element = mount();
  try {
    await flush();
    assert.deepEqual(statsOf(element), {
      chars: '0',
      letters: '0',
      words: '0',
      lines: '0',
      size: '0 parsinegar.stats.bytes',
    });
  } finally {
    element.remove();
  }
});

test('should_update_stats_when_configured', async () => {
  const element = mount();
  try {
    await flush();
    element.configure({
      stats: { chars: 10, letters: 8, words: 2, lines: 1, bytes: 2048 },
      formatNumber: (value) => `#${value}`,
    });
    await flush();
    assert.deepEqual(statsOf(element), {
      chars: '#10',
      letters: '#8',
      words: '#2',
      lines: '#1',
      size: '#2 parsinegar.stats.kilobytes',
    });
  } finally {
    element.remove();
  }
});

test('should_render_label_before_value_when_mounted', async () => {
  const element = mount({
    t: (key) => ({ 'parsinegar.stats.words': 'واژه' }[key] ?? key),
  });
  try {
    await flush();
    element.configure({ stats: { chars: 0, letters: 0, words: 250, lines: 0, bytes: 0 } });
    await flush();
    const stats = [...element.shadowRoot.querySelectorAll('[part="stat"]')];
    assert.deepEqual(
      stats.map((node) => node.querySelector('[data-stat]')?.getAttribute('data-stat')),
      ['chars', 'letters', 'words', 'lines', 'size'],
    );
    const words = stats[2]?.textContent ?? '';
    assert.ok(words.indexOf('واژه') < words.indexOf('250'), `expected label first, got: ${words}`);
  } finally {
    element.remove();
  }
});

test('should_show_lock_chip_when_read_only_is_configured', async () => {
  const element = mount();
  try {
    await flush();
    assert.equal(element.shadowRoot.querySelector('[part="lock-chip"]'), null);
    element.configure({ readOnly: true });
    await flush();
    const chip = element.shadowRoot.querySelector('[part="lock-chip"]');
    assert.ok(chip, 'expected the lock chip');
    assert.equal(chip.textContent, 'parsinegar.status.locked');
    element.configure({ readOnly: false });
    await flush();
    assert.equal(element.shadowRoot.querySelector('[part="lock-chip"]'), null);
  } finally {
    element.remove();
  }
});
