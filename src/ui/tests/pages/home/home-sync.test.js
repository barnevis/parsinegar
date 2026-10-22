// Verifies the sync orchestration of the home page: backend configure and
// remove through the side-panel form, run rounds (automatic and typed
// commit messages), conflict modal flow, ignore patterns riding the scope,
// and the rail status dot in every state.
import '../../setup-dom.js';
import '../../setup-styles.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { TAG } from '../../../pages/home/home.js';
import {
  child,
  createDocuments,
  createSettings,
  flush,
  inChild,
  mountWithDocuments,
  mountWithSettings,
  settled,
} from './helpers.js';

function createSyncService(overrides = {}) {
  const calls = [];
  return {
    calls,
    async configureBackend(input) {
      calls.push(['configureBackend', input]);
      return { ok: true, kind: 'git', repo: input?.params?.repo ?? null, branch: input?.params?.branch ?? null };
    },
    async removeBackend() {
      calls.push(['removeBackend']);
      return { ok: true };
    },
    async getStatus() {
      return { configured: true, kind: 'git', repo: 'u/r', branch: 'main', lastSyncAt: null, lastError: null };
    },
    async hasPendingChanges() {
      return { pending: false };
    },
    async syncNow() {
      calls.push(['syncNow']);
      return { pushed: [], pulled: [], deletedRemote: [], deleteLocal: [], relocated: [], skipped: [], conflicts: [], completed: true };
    },
    async resolveConflict(input) {
      calls.push(['resolveConflict', input]);
      return { remaining: 0 };
    },
    ...overrides,
  };
}

function syncDot(element) {
  return inChild(element, 'parsi-activity-rail', '[data-view="sync"] [data-sync-dot]')?.getAttribute('data-sync-dot') ?? null;
}

test('should_configure_backend_when_sync_form_is_saved', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const syncer = createSyncService();
  const element = await mountWithDocuments(documents, { 'pey.sync.service': syncer });
  try {
    element.shadowRoot.querySelector('[part="workbench"]').dispatchEvent(new CustomEvent('sync-configure', { bubbles: true, detail: { repo: 'u/r', branch: 'main', token: 'tok' } }));
    await settled();
    await settled();
    assert.deepEqual(syncer.calls, [['configureBackend', { kind: 'git', params: { repo: 'u/r', branch: 'main', token: 'tok' } }]]);
  } finally {
    element.remove();
  }
});

test('should_ignore_sync_events_without_service_when_dispatched', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const element = await mountWithDocuments(documents);
  try {
    element.shadowRoot.querySelector('[part="workbench"]').dispatchEvent(new CustomEvent('sync-now', { bubbles: true, detail: {} }));
    await settled();
    await settled();
    assert.equal(element.value, 'c1');
  } finally {
    element.remove();
  }
});

test('should_show_conflict_modal_when_sync_reports_conflicts', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const syncer = createSyncService({
    async syncNow() {
      return {
        pushed: [],
        pulled: [],
        deletedRemote: [],
        deleteLocal: [],
        relocated: [],
        skipped: [],
        conflicts: [{
          collection: 'documents',
          id: 'd1',
          title: 'یادداشت',
          local: { updatedAt: 2, content: 'نسخه من' },
          remote: { updatedAt: 3, content: 'نسخه طرف' },
        }],
        completed: false,
      };
    },
  });
  const element = await mountWithDocuments(documents, { 'pey.sync.service': syncer });
  try {
    element.shadowRoot.querySelector('[part="workbench"]').dispatchEvent(new CustomEvent('sync-now', { bubbles: true, detail: {} }));
    await settled();
    await settled();
    assert.ok(inChild(element, 'parsi-modal-dialog', '[data-sync-resolve="local"]'), 'expected the keep-mine choice');
    assert.ok(inChild(element, 'parsi-modal-dialog', '[data-sync-resolve="remote"]'), 'expected the take-theirs choice');
    const text = inChild(element, 'parsi-modal-dialog', '[part="modal-dialog"]').textContent;
    assert.ok(text.includes('نسخه من'));
    assert.ok(text.includes('نسخه طرف'));
    inChild(element, 'parsi-modal-dialog', '[data-sync-resolve="local"]').click();
    await settled();
    await settled();
    assert.deepEqual(syncer.calls.filter(([name]) => name === 'resolveConflict'), [
      ['resolveConflict', { collection: 'documents', id: 'd1', choice: 'local' }],
    ]);
    assert.equal(inChild(element, 'parsi-modal-dialog', '[data-sync-resolve="local"]'), null);
  } finally {
    element.remove();
  }
});

test('should_refresh_editor_when_sync_pulls_open_document', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const syncCalls = [];
  const syncer = createSyncService({
    async syncNow(input) {
      syncCalls.push(input);
      await documents.saveDocument({ id: 'd1', title: 'یادداشت', content: 'pulled' });
      return { pushed: [], pulled: [{ collection: 'documents', id: 'd1' }], deletedRemote: [], deleteLocal: [], relocated: [], skipped: [], conflicts: [], completed: true };
    },
  });
  const element = await mountWithDocuments(documents, { 'pey.sync.service': syncer });
  try {
    assert.equal(element.value, 'c1');
    element.shadowRoot.querySelector('[part="workbench"]').dispatchEvent(new CustomEvent('sync-now', { bubbles: true, detail: {} }));
    await settled();
    await settled();
    assert.equal(element.value, 'pulled');
    assert.equal(syncCalls.length, 1);
    assert.deepEqual(syncCalls[0].scope.collections.map(({ collection }) => collection), ['documents']);
  } finally {
    element.remove();
  }
});

test('should_remove_backend_when_remove_is_dispatched', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const syncer = createSyncService();
  const element = await mountWithDocuments(documents, { 'pey.sync.service': syncer });
  try {
    element.shadowRoot.querySelector('[part="workbench"]').dispatchEvent(new CustomEvent('sync-remove', { bubbles: true, detail: {} }));
    await settled();
    await settled();
    assert.deepEqual(syncer.calls, [['removeBackend']]);
  } finally {
    element.remove();
  }
});

test('should_show_busy_state_while_configure_is_pending', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const syncer = createSyncService({
    async configureBackend() {
      return new Promise(() => {});
    },
    async getStatus() {
      return { configured: false, lastSyncAt: null, lastError: null };
    },
  });
  const element = await mountWithDocuments(documents, { 'pey.sync.service': syncer });
  try {
    child(element, 'parsi-activity-rail').dispatchEvent(new CustomEvent('view-select', { bubbles: true, detail: { id: 'sync' } }));
    await settled();
    await settled();
    element.shadowRoot.querySelector('[part="workbench"]').dispatchEvent(new CustomEvent('sync-configure', {
      bubbles: true,
      detail: { repo: 'u/r', branch: 'main', token: 'tok' },
    }));
    await settled();
    await settled();
    const panel = () => element.shadowRoot.querySelector('parsi-side-panel').shadowRoot;
    assert.ok(panel().querySelector('[data-sync-save]').disabled, 'expected the save button disabled while busy');
    assert.ok(panel().innerHTML.includes('در حال اتصال'), 'expected the connecting label');
  } finally {
    element.remove();
  }
});

test('should_repopulate_form_after_failed_configure_when_refreshed', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const syncer = createSyncService({
    async configureBackend() {
      throw { code: 'SYNC_AUTH_FAILED' };
    },
    async getStatus() {
      return { configured: false, lastSyncAt: null, lastError: { code: 'SYNC_AUTH_FAILED', message: 'nope', at: 1 } };
    },
  });
  const element = await mountWithDocuments(documents, { 'pey.sync.service': syncer });
  try {
    child(element, 'parsi-activity-rail').dispatchEvent(new CustomEvent('view-select', { bubbles: true, detail: { id: 'sync' } }));
    await settled();
    await settled();
    element.shadowRoot.querySelector('[part="workbench"]').dispatchEvent(new CustomEvent('sync-configure', {
      bubbles: true,
      detail: { repo: 'u/r', branch: 'dev', token: 'tok' },
    }));
    await settled();
    await settled();
    const panel = () => element.shadowRoot.querySelector('parsi-side-panel').shadowRoot;
    assert.equal(panel().querySelector('[data-sync-field="repo"]').value, 'u/r');
    assert.equal(panel().querySelector('[data-sync-field="branch"]').value, 'dev');
    assert.equal(panel().querySelector('[data-sync-field="token"]').value, '');
    assert.ok(panel().innerHTML.includes('nope'));
  } finally {
    element.remove();
  }
});

test('should_send_gitlab_envelope_when_gitlab_form_is_saved', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const syncer = createSyncService();
  const element = await mountWithDocuments(documents, { 'pey.sync.service': syncer });
  try {
    element.shadowRoot.querySelector('[part="workbench"]').dispatchEvent(new CustomEvent('sync-configure', {
      bubbles: true,
      detail: { kind: 'gitlab', repo: 'u/r', branch: 'trunk', token: 'tok', baseUrl: 'https://git.self.test' },
    }));
    await settled();
    await settled();
    assert.deepEqual(syncer.calls, [[
      'configureBackend',
      { kind: 'gitlab', params: { repo: 'u/r', branch: 'trunk', token: 'tok', baseUrl: 'https://git.self.test' } },
    ]]);
  } finally {
    element.remove();
  }
});

test('should_repopulate_gitlab_attempt_after_failed_configure_when_refreshed', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const syncer = createSyncService({
    async configureBackend() {
      throw { code: 'SYNC_INVALID_CONFIG' };
    },
    async getStatus() {
      return { configured: false, lastSyncAt: null, lastError: { code: 'SYNC_INVALID_CONFIG', message: 'nope', at: 1 } };
    },
  });
  const element = await mountWithDocuments(documents, { 'pey.sync.service': syncer });
  try {
    child(element, 'parsi-activity-rail').dispatchEvent(new CustomEvent('view-select', { bubbles: true, detail: { id: 'sync' } }));
    await settled();
    await settled();
    element.shadowRoot.querySelector('[part="workbench"]').dispatchEvent(new CustomEvent('sync-configure', {
      bubbles: true,
      detail: { kind: 'gitlab', repo: 'u/r', branch: 'main', token: 'tok', baseUrl: 'https://git.self.test' },
    }));
    await settled();
    await settled();
    const panel = () => element.shadowRoot.querySelector('parsi-side-panel').shadowRoot;
    assert.equal(panel().querySelector('input[data-sync-field="git-kind"][value="gitlab"]').checked, true, 'gitlab stays selected');
    assert.equal(panel().querySelector('[data-sync-field="baseUrl"]').value, 'https://git.self.test');
    assert.equal(panel().querySelector('[data-sync-field="repo"]').value, 'u/r');
    assert.equal(panel().querySelector('[data-sync-field="token"]').value, '');
  } finally {
    element.remove();
  }
});

test('should_show_sync_view_with_form_when_rail_selects_it', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const syncer = createSyncService({
    async getStatus() {
      return { configured: false, lastSyncAt: null, lastError: null };
    },
  });
  const element = await mountWithDocuments(documents, { 'pey.sync.service': syncer });
  try {
    child(element, 'parsi-activity-rail').dispatchEvent(new CustomEvent('view-select', { bubbles: true, detail: { id: 'sync' } }));
    await settled();
    await settled();
    assert.equal(inChild(element, 'parsi-activity-rail', '[data-view="sync"]').getAttribute('aria-pressed'), 'true');
    assert.ok(inChild(element, 'parsi-side-panel', '[data-sync-field="repo"]'), 'expected the sync form');
    assert.ok(inChild(element, 'parsi-side-panel', '[data-sync-save]'), 'expected the save action');
  } finally {
    element.remove();
  }
});

test('should_show_stale_dot_when_never_synced', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const element = await mountWithDocuments(documents, { 'pey.sync.service': createSyncService() });
  try {
    await settled();
    await settled();
    assert.equal(syncDot(element), 'stale');
  } finally {
    element.remove();
  }
});

test('should_show_ok_dot_after_clean_sync', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const syncer = createSyncService({
    async getStatus() {
      return { configured: true, kind: 'git', repo: 'u/r', branch: 'main', lastSyncAt: 200, lastError: null };
    },
  });
  const element = await mountWithDocuments(documents, { 'pey.sync.service': syncer });
  try {
    await settled();
    await settled();
    assert.equal(syncDot(element), 'ok');
  } finally {
    element.remove();
  }
});

test('should_show_bad_dot_when_last_sync_failed', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const syncer = createSyncService({
    async getStatus() {
      return { configured: true, kind: 'git', repo: 'u/r', branch: 'main', lastSyncAt: null, lastError: { code: 'SYNC_NETWORK_FAILED', message: 'nope', at: 1 } };
    },
  });
  const element = await mountWithDocuments(documents, { 'pey.sync.service': syncer });
  try {
    await settled();
    await settled();
    assert.equal(syncDot(element), 'bad');
  } finally {
    element.remove();
  }
});

test('should_show_busy_dot_while_sync_runs', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const syncer = createSyncService({
    async syncNow() {
      return new Promise(() => {});
    },
  });
  const element = await mountWithDocuments(documents, { 'pey.sync.service': syncer });
  try {
    element.shadowRoot.querySelector('[part="workbench"]').dispatchEvent(new CustomEvent('sync-now', { bubbles: true, detail: {} }));
    await settled();
    await settled();
    assert.equal(syncDot(element), 'busy');
  } finally {
    element.remove();
  }
});

test('should_show_dirty_dot_with_tooltip_after_local_edit', async (t) => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  let pending = false;
  const syncer = createSyncService({
    async getStatus() {
      return { configured: true, kind: 'git', repo: 'u/r', branch: 'main', lastSyncAt: 200, lastError: null };
    },
    async hasPendingChanges() {
      return { pending };
    },
  });
  const element = await mountWithDocuments(documents, { 'pey.sync.service': syncer });
  try {
    await settled();
    await settled();
    assert.equal(syncDot(element), 'ok');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    pending = true;
    element.setDocument('متن تازه');
    t.mock.timers.tick(1000);
    t.mock.timers.reset();
    await settled();
    await settled();
    await settled();
    assert.equal(syncDot(element), 'stale');
    const hint = inChild(element, 'parsi-activity-rail', '[data-view="sync"]').getAttribute('data-tooltip');
    assert.ok(hint.includes('تغییرهای ارسال‌نشده'), `expected the unsent hint, got: ${hint}`);
  } finally {
    t.mock.timers.reset();
    element.remove();
  }
});

test('should_clear_dirty_dot_after_clean_sync', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  let pending = true;
  const syncer = createSyncService({
    async getStatus() {
      return { configured: true, kind: 'git', repo: 'u/r', branch: 'main', lastSyncAt: 200, lastError: null };
    },
    async hasPendingChanges() {
      return { pending };
    },
    async syncNow() {
      pending = false;
      return { pushed: [], pulled: [], deletedRemote: [], deleteLocal: [], relocated: [], skipped: [], conflicts: [], completed: true };
    },
  });
  const element = await mountWithDocuments(documents, { 'pey.sync.service': syncer });
  try {
    await settled();
    await settled();
    assert.equal(syncDot(element), 'stale');
    element.shadowRoot.querySelector('[part="workbench"]').dispatchEvent(new CustomEvent('sync-now', { bubbles: true, detail: {} }));
    await settled();
    await settled();
    await settled();
    assert.equal(syncDot(element), 'ok');
    assert.equal(inChild(element, 'parsi-activity-rail', '[data-view="sync"]').getAttribute('data-tooltip'), 'همگام‌سازی');
  } finally {
    element.remove();
  }
});

test('should_carry_ignore_patterns_in_sync_scope_when_synced', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const settings = createSettings({ theme: 'device', direction: 'rtl', fontSize: 16, syncIgnore: ['پیش‌نویس'] });
  const syncCalls = [];
  const syncer = createSyncService({
    async syncNow(input) {
      syncCalls.push(input);
      return { pushed: [], pulled: [], deletedRemote: [], deleteLocal: [], relocated: [], skipped: [], conflicts: [], completed: true };
    },
  });
  const element = await mountWithSettings(documents, settings, { 'pey.sync.service': syncer });
  try {
    element.shadowRoot.querySelector('[part="workbench"]').dispatchEvent(new CustomEvent('sync-now', { bubbles: true, detail: {} }));
    await settled();
    await settled();
    const docsScope = syncCalls[0].scope.collections.find(({ collection }) => collection === 'documents');
    assert.deepEqual(docsScope.ignore, ['پیش‌نویس']);
  } finally {
    element.remove();
  }
});

test('should_save_ignore_patterns_and_repopulate_when_saved', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const settings = createSettings({ theme: 'device', direction: 'rtl', fontSize: 16 });
  const syncer = createSyncService({
    async getStatus() {
      return { configured: false, lastSyncAt: null, lastError: null };
    },
  });
  const element = await mountWithSettings(documents, settings, { 'pey.sync.service': syncer });
  try {
    child(element, 'parsi-activity-rail').dispatchEvent(new CustomEvent('view-select', { bubbles: true, detail: { id: 'sync' } }));
    await settled();
    await settled();
    inChild(element, 'parsi-side-panel', '[data-sync-field="ignore"]').value = 'a\n\n# نظر\nb';
    // The save button stays disabled on the stored patterns: the input
    // event (like real typing) enables it first.
    inChild(element, 'parsi-side-panel', '[data-sync-field="ignore"]').dispatchEvent(new Event('input', { bubbles: true }));
    inChild(element, 'parsi-side-panel', '[data-sync-ignore-save]').click();
    await settled();
    await settled();
    await settled();
    assert.ok(settings.calls.some((patch) => JSON.stringify(patch) === JSON.stringify({ syncIgnore: ['a', 'b'] })));
    assert.equal(inChild(element, 'parsi-side-panel', '[data-sync-field="ignore"]').value, 'a\nb');
  } finally {
    element.remove();
  }
});

test('should_run_sync_without_modal_when_auto_commit_is_enabled', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const settings = createSettings({ theme: 'device', direction: 'rtl', fontSize: 16 });
  const syncCalls = [];
  const syncer = createSyncService({
    async syncNow(input) {
      syncCalls.push(input);
      return { pushed: [], pulled: [], deletedRemote: [], deleteLocal: [], relocated: [], skipped: [], conflicts: [], completed: true };
    },
  });
  const element = await mountWithSettings(documents, settings, { 'pey.sync.service': syncer });
  try {
    element.shadowRoot.querySelector('[part="workbench"]').dispatchEvent(new CustomEvent('sync-now', { bubbles: true, detail: {} }));
    await settled();
    await settled();
    assert.deepEqual(syncCalls, [{ scope: syncCalls[0]?.scope }]);
    assert.ok(syncCalls[0].scope, 'expected the sync scope in the input');
    assert.equal(syncCalls[0].message, undefined);
    assert.equal(inChild(element, 'parsi-modal-dialog', '[data-sync-message-input]'), null, 'expected no message modal');
  } finally {
    element.remove();
  }
});

test('should_sync_with_typed_message_when_auto_commit_is_disabled', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const settings = createSettings({ theme: 'device', direction: 'rtl', fontSize: 16, syncCommitAuto: false });
  const syncCalls = [];
  const syncer = createSyncService({
    async syncNow(input) {
      syncCalls.push(input);
      return { pushed: [], pulled: [], deletedRemote: [], deleteLocal: [], relocated: [], skipped: [], conflicts: [], completed: true };
    },
  });
  const element = await mountWithSettings(documents, settings, { 'pey.sync.service': syncer });
  try {
    element.shadowRoot.querySelector('[part="workbench"]').dispatchEvent(new CustomEvent('sync-now', { bubbles: true, detail: {} }));
    await settled();
    await settled();
    const input = inChild(element, 'parsi-modal-dialog', '[data-sync-message-input]');
    assert.ok(input, 'expected the message modal');
    const send = () => inChild(element, 'parsi-modal-dialog', '[data-sync-message-send]');
    assert.equal(send().disabled, true, 'expected a disabled send with an empty message');
    input.value = 'پیام من';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    assert.equal(send().disabled, false, 'expected send to enable after typing');
    send().click();
    await settled();
    await settled();
    assert.equal(syncCalls.length, 1);
    assert.equal(syncCalls[0].message, 'پیام من');
    assert.ok(syncCalls[0].scope, 'expected the sync scope in the input');
    assert.equal(inChild(element, 'parsi-modal-dialog', '[data-sync-message-input]'), null, 'expected the modal to close');
  } finally {
    element.remove();
  }
});

test('should_close_message_modal_without_sync_when_cancelled', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const settings = createSettings({ theme: 'device', direction: 'rtl', fontSize: 16, syncCommitAuto: false });
  const syncer = createSyncService();
  const element = await mountWithSettings(documents, settings, { 'pey.sync.service': syncer });
  try {
    element.shadowRoot.querySelector('[part="workbench"]').dispatchEvent(new CustomEvent('sync-now', { bubbles: true, detail: {} }));
    await settled();
    await settled();
    assert.ok(inChild(element, 'parsi-modal-dialog', '[data-sync-message-input]'));
    inChild(element, 'parsi-modal-dialog', '[data-sync-message-cancel]').click();
    await settled();
    await settled();
    assert.equal(inChild(element, 'parsi-modal-dialog', '[data-sync-message-input]'), null, 'expected the modal to close');
    assert.deepEqual(syncer.calls, [], 'expected no sync without a message');
  } finally {
    element.remove();
  }
});

test('should_save_commit_mode_and_rerender_when_checkbox_is_toggled', async () => {
  const documents = createDocuments([
    { id: 'd1', title: 'یادداشت', content: 'c1', updatedAt: 100 },
  ]);
  const settings = createSettings({ theme: 'device', direction: 'rtl', fontSize: 16 });
  const syncer = createSyncService({
    async getStatus() {
      return { configured: true, kind: 'git', repo: 'u/r', branch: 'main', lastSyncAt: null, lastError: null };
    },
  });
  const element = await mountWithSettings(documents, settings, { 'pey.sync.service': syncer });
  try {
    child(element, 'parsi-activity-rail').dispatchEvent(new CustomEvent('view-select', { bubbles: true, detail: { id: 'sync' } }));
    await settled();
    await settled();
    const checkbox = inChild(element, 'parsi-side-panel', '[data-sync-field="autoCommit"]');
    assert.ok(checkbox, 'expected the checkbox in the sync view');
    assert.equal(checkbox.checked, true);
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await settled();
    await settled();
    assert.ok(settings.calls.some((patch) => JSON.stringify(patch) === JSON.stringify({ syncCommitAuto: false })));
    assert.equal(inChild(element, 'parsi-side-panel', '[data-sync-field="autoCommit"]').checked, false);
  } finally {
    element.remove();
  }
});
