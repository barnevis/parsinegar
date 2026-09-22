// Verifies the outline scrollspy (pure logic over fakes, no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createScrollSpy } from '../../../pages/home/scroll-spy.js';

const DOC = '# یک\n\nمتن\n\n## دو\n\nمتن\n';

function createCenter(top = 0) {
  const listeners = new Map();
  return {
    top,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    getBoundingClientRect() {
      return { top };
    },
    scroll() {
      listeners.get('scroll')?.();
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

function createSpy(overrides = {}) {
  const seen = [];
  const spy = createScrollSpy({
    getVisibleLine: () => 1,
    getText: () => DOC,
    onActiveLine: (line) => seen.push(line),
    isLive: () => true,
    ...overrides,
  });
  return { spy, seen };
}

test('should_report_heading_when_visible_line_moves', () => {
  const lines = [1, 5];
  const { spy, seen } = createSpy({ getVisibleLine: () => lines.shift() ?? 5 });
  const center = createCenter();
  try {
    spy.watch(center);
    center.scroll();
    center.scroll();
    assert.deepEqual(seen, [1, 5]);
    assert.equal(spy.getActiveLine(), 5);
  } finally {
    spy.unwatch();
  }
});

test('should_push_once_when_line_repeats', () => {
  const { spy, seen } = createSpy({ getVisibleLine: () => 2 });
  const center = createCenter();
  try {
    spy.watch(center);
    center.scroll();
    center.scroll();
    assert.deepEqual(seen, [1]);
  } finally {
    spy.unwatch();
  }
});

test('should_ignore_invalid_lines_when_reporting', () => {
  for (const line of [null, 0, -3, 2.5, Number.NaN]) {
    const { spy, seen } = createSpy({ getVisibleLine: () => line });
    const center = createCenter();
    spy.watch(center);
    center.scroll();
    spy.unwatch();
    assert.deepEqual(seen, [], `expected silence for ${String(line)}`);
  }
});

test('should_ignore_throwing_measurement_when_reporting', () => {
  const { spy, seen } = createSpy({
    getVisibleLine: () => { throw new Error('no metrics'); },
  });
  const center = createCenter();
  try {
    spy.watch(center);
    center.scroll();
    assert.deepEqual(seen, []);
  } finally {
    spy.unwatch();
  }
});

test('should_forget_heading_when_reset', () => {
  const { spy, seen } = createSpy({ getVisibleLine: () => 1 });
  const center = createCenter();
  try {
    spy.watch(center);
    center.scroll();
    spy.reset();
    assert.equal(spy.getActiveLine(), null);
    center.scroll();
    assert.deepEqual(seen, [1, 1]);
  } finally {
    spy.unwatch();
  }
});

test('should_stop_reporting_when_unwatched', () => {
  const { spy, seen } = createSpy({ getVisibleLine: () => 1 });
  const center = createCenter();
  spy.watch(center);
  spy.unwatch();
  assert.equal(center.listenerCount, 0);
  center.scroll();
  assert.deepEqual(seen, []);
});

test('should_ignore_missing_or_repeated_centers_when_watching', () => {
  const { spy, seen } = createSpy({ getVisibleLine: () => 1 });
  const center = createCenter();
  try {
    spy.watch(null);
    spy.watch(center);
    spy.watch(center);
    assert.equal(center.listenerCount, 1);
    center.scroll();
    assert.deepEqual(seen, [1]);
  } finally {
    spy.unwatch();
  }
});

test('should_stop_reporting_when_owner_disconnects', () => {
  let live = true;
  const { spy, seen } = createSpy({ getVisibleLine: () => 1, isLive: () => live });
  const center = createCenter();
  try {
    spy.watch(center);
    live = false;
    center.scroll();
    assert.deepEqual(seen, []);
  } finally {
    spy.unwatch();
  }
});
