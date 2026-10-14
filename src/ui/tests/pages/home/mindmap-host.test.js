// Verifies the mindmap host controller (real MindElixir when the
// environment allows layout, guidance fallback otherwise — never a crash).
import '../../setup-dom.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMindmapHost } from '../../../pages/home/mindmap-host.js';

function mountHost() {
  const host = document.createElement('div');
  document.body.append(host);
  return host;
}

test('should_throw_when_host_is_missing', () => {
  assert.throws(() => createMindmapHost(null), /requires an element host/);
});

test('should_show_guidance_when_document_is_not_list', async () => {
  const host = mountHost();
  const controller = createMindmapHost(host, { getText: () => 'متن ساده' });
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
  const controller = createMindmapHost(host, { getText: () => '- الف\n  - ب' });
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
  const controller = createMindmapHost(host, { getText: () => text });
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
