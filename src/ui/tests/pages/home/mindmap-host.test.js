// Verifies the mindmap host controller (real MindElixir when the
// environment allows layout, guidance fallback otherwise — never a crash).
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import catalog from '../../../i18n/catalog.js';
import { createMindmapHost } from '../../../pages/home/mindmap-host.js';

const translate = (key) => catalog.fa[key] ?? key;

function mountHost() {
  const host = document.createElement('div');
  document.body.append(host);
  return host;
}

// Toolbar switches run fire-and-forget (void applyLayout); jsdom rebuilds
// through the cached module import, so a settled state poll replaces
// fixed sleeps in the switch tests.
async function waitUntil(condition, message = 'condition not met in time') {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(condition(), message);
}

test('should_throw_when_host_is_missing', () => {
  assert.throws(() => createMindmapHost(null), /requires an element host/);
});

test('should_throw_when_onchange_is_missing', () => {
  const host = mountHost();
  try {
    assert.throws(
      () => createMindmapHost(host, { getText: () => '- الف' }),
      /requires an onChange callback/,
    );
  } finally {
    host.remove();
  }
});

test('should_show_guidance_when_document_is_not_list', async () => {
  const host = mountHost();
  const controller = createMindmapHost(host, { getText: () => 'متن ساده', onChange: () => {} });
  try {
    await controller.ready;
    assert.ok(host.querySelector('[part="mindmap-empty"]'), 'expected guidance markup');
  } finally {
    controller.destroy();
    host.remove();
  }
});

test('should_mount_without_crashing_when_document_is_list', async () => {
  const host = mountHost();
  const controller = createMindmapHost(host, { getText: () => '- الف\n  - ب', onChange: () => {} });
  try {
    await controller.ready;
    assert.ok(host.childElementCount > 0, 'expected map nodes or guidance');
    await controller.refresh();
    assert.ok(host.childElementCount > 0, 'expected content after refresh');
  } finally {
    controller.destroy();
    host.remove();
  }
});

test('should_return_to_guidance_when_text_leaves_lists', async () => {
  let text = '- الف\n  - ب';
  const host = mountHost();
  const controller = createMindmapHost(host, { getText: () => text, onChange: () => {} });
  try {
    await controller.ready;
    text = 'متن ساده';
    await controller.refresh();
    assert.ok(host.querySelector('[part="mindmap-empty"]'), 'expected guidance after leaving lists');
  } finally {
    controller.destroy();
    host.remove();
  }
});

test('should_inject_stylesheet_into_head_when_mounted_in_light_dom', async () => {
  const host = mountHost();
  const controller = createMindmapHost(host, { getText: () => '- الف\n  - ب', onChange: () => {} });
  try {
    await controller.ready;
    assert.ok(
      document.head.querySelector('style[data-mindmap-css]'),
      'expected the library stylesheet in the document head, not appended to the document',
    );
  } finally {
    controller.destroy();
    host.remove();
    document.head.querySelector('style[data-mindmap-css]')?.remove();
  }
});

test('should_render_persian_toolbar_when_mounted', async () => {
  const host = mountHost();
  const controller = createMindmapHost(host, { getText: () => '- الف', t: translate, onChange: () => {} });
  try {
    await controller.ready;
    const labels = [...host.querySelectorAll('[data-mind-btn]')].map((button) => button.textContent);
    assert.deepEqual(labels, ['فرزند', 'هم‌سطح', 'حذف', 'پرش به متن', 'چیدمان']);
  } finally {
    controller.destroy();
    host.remove();
  }
});

test('should_render_layout_menu_closed_with_rtl_active_by_default', async () => {
  const host = mountHost();
  const controller = createMindmapHost(host, { getText: () => '- الف\n  - ب', t: translate, onChange: () => {} });
  try {
    await controller.ready;
    const menu = host.querySelector('[data-mind-menu]');
    assert.ok(menu, 'expected a layout menu');
    assert.equal(menu.hidden, true, 'expected the menu closed initially');
    assert.deepEqual(
      [...menu.querySelectorAll('[data-mind-layout]')].map((item) => item.textContent),
      ['راست‌به‌چپ', 'چپ‌به‌راست', 'دوطرفه', 'عمودی'],
    );
    const active = menu.querySelector('[data-mind-layout-active]')?.getAttribute('data-mind-layout');
    assert.equal(active, 'rtl', 'expected rtl marked active by default');
    assert.ok(host.querySelector('me-main.lhs me-tpc'), 'expected rtl (root right, children left)');
    assert.ok(!host.querySelector('me-main.rhs me-tpc'), 'expected no right-side subtree by default');
  } finally {
    controller.destroy();
    host.remove();
  }
});

test('should_switch_layout_from_the_menu_and_persist_through_callback', async () => {
  const host = mountHost();
  const layouts = [];
  const controller = createMindmapHost(host, {
    getText: () => '- الف\n  - ب\n  - ج',
    t: translate,
    onChange: () => {},
    onLayoutChange: (next) => layouts.push(next),
  });
  try {
    await controller.ready;
    host.querySelector('[data-mind-btn="layout"]').click();
    assert.equal(host.querySelector('[data-mind-menu]').hidden, false, 'expected the menu open after the toolbar click');
    host.querySelector('[data-mind-layout="side"]').click();
    // The active mark applies synchronously; the rebuilt subtree is the
    // settlement signal.
    await waitUntil(
      () => layouts.length === 1
        && host.querySelector('me-main.lhs me-tpc') !== null
        && host.querySelector('me-main.rhs me-tpc') !== null,
      'expected the menu switch reported once and the map rebuilt on both sides',
    );
    assert.deepEqual(layouts, ['side'], 'expected the switch reported exactly once');
    assert.equal(host.querySelector('[data-mind-menu]').hidden, true, 'expected the menu closed after choosing');
    const active = host.querySelector('[data-mind-layout-active]')?.getAttribute('data-mind-layout');
    assert.equal(active, 'side', 'expected the chosen option marked active');
    await controller.refresh();
    assert.ok(host.querySelector('me-main.lhs me-tpc') && host.querySelector('me-main.rhs me-tpc'),
      'expected the layout to survive a text refresh');
  } finally {
    controller.destroy();
    host.remove();
  }
});

test('should_ignore_invalid_and_current_layout_switches', async () => {
  const host = mountHost();
  const layouts = [];
  const controller = createMindmapHost(host, {
    getText: () => '- الف\n  - ب',
    t: translate,
    onChange: () => {},
    onLayoutChange: (next) => layouts.push(next),
  });
  try {
    await controller.ready;
    await controller.setLayout('bogus');
    await controller.setLayout('rtl');
    assert.deepEqual(layouts, [], 'expected nothing persisted for invalid or unchanged layout');
    assert.ok(host.querySelector('[data-mind-menu] me-tpc') === null && host.querySelector('[data-mindmap-canvas] me-tpc'),
      'expected the map intact after ignored switches');
  } finally {
    controller.destroy();
    host.remove();
  }
});

test('should_rebuild_the_map_in_the_requested_layout_through_setLayout', async () => {
  const host = mountHost();
  const layouts = [];
  const controller = createMindmapHost(host, {
    getText: () => '- الف\n  - ب',
    t: translate,
    onChange: () => {},
    onLayoutChange: (next) => layouts.push(next),
  });
  try {
    await controller.ready;
    await controller.setLayout('down');
    assert.deepEqual(layouts, ['down']);
    assert.ok(host.querySelector('me-main.down me-tpc'), 'expected the vertical layout class applied');
    await controller.setLayout('ltr');
    assert.deepEqual(layouts, ['down', 'ltr']);
    assert.ok(host.querySelector('me-main.rhs me-tpc'), 'expected children on the right for ltr');
    assert.ok(!host.querySelector('me-main.lhs me-tpc'), 'expected no left-side subtree for ltr');
  } finally {
    controller.destroy();
    host.remove();
  }
});

test('should_hide_bar_with_guidance_when_document_is_not_list', async () => {
  const host = mountHost();
  const controller = createMindmapHost(host, { getText: () => 'متن ساده', onChange: () => {} });
  try {
    await controller.ready;
    assert.ok(host.querySelector('[part="mindmap-empty"]'), 'expected guidance markup');
    assert.equal(host.querySelector('[data-mindmap-bar]').hidden, true);
  } finally {
    controller.destroy();
    host.remove();
  }
});

test('should_render_parity_marks_in_node_labels_when_mounted', async () => {
  const host = mountHost();
  const controller = createMindmapHost(host, {
    getText: () => '- **ریشه**\n  - *شاخه* با [متن](https://x) و `کد`',
    onChange: () => {},
  });
  try {
    await controller.ready;
    const labels = [...host.querySelectorAll('me-tpc .text')].map((span) => span.innerHTML);
    assert.ok(
      labels.some((label) => label.includes('<strong>ریشه</strong>')),
      `expected the root label to render strong, got ${JSON.stringify(labels)}`,
    );
    assert.ok(
      labels.some((label) => label.includes('<em>شاخه</em>') && label.includes('<code>کد</code>')),
      `expected the child label to render marks, got ${JSON.stringify(labels)}`,
    );
    assert.ok(
      labels.some((label) => label.includes('href="https://x"') && label.includes('rel="noopener"')),
      `expected the child link to open safely, got ${JSON.stringify(labels)}`,
    );
  } finally {
    controller.destroy();
    host.remove();
  }
});

test('should_keep_labels_styled_after_edit_commit_when_node_topic_changes', async () => {
  let text = '- **ریشه**\n  - شاخه';
  const host = mountHost();
  const controller = createMindmapHost(host, { getText: () => text, onChange: (next) => { text = next; } });
  try {
    await controller.ready;
    const changed = text.replace('شاخه', '*شاخه*');
    // The library re-labels through the markdown hook on every commit too;
    // here we drive the same hook through a direct rebuild to pin it.
    text = changed;
    await controller.refresh();
    const labels = [...host.querySelectorAll('me-tpc .text')].map((span) => span.innerHTML);
    assert.ok(
      labels.some((label) => label.includes('<em>شاخه</em>')),
      `expected the rebuilt label to render em, got ${JSON.stringify(labels)}`,
    );
  } finally {
    controller.destroy();
    host.remove();
  }
});
