// Verifies the sync view renderer (pure function, no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderSyncView } from '../../../components/workbench/views-sync.js';

test('should_render_sync_form_when_unconfigured', () => {
  const markup = renderSyncView({ t: (key) => key, sync: null });
  assert.ok(markup.includes('data-sync-field="repo"'));
  assert.ok(markup.includes('data-sync-field="branch"'));
  assert.ok(markup.includes('data-sync-field="token"'));
  assert.ok(markup.includes('data-sync-save'));
  assert.ok(!markup.includes('data-sync-now'), 'expected no sync button without a backend');
  assert.ok(!markup.includes('data-sync-remove'), 'expected no remove button without a backend');
});

test('should_warm_about_token_safety_when_unconfigured', () => {
  const markup = renderSyncView({ t: (key) => key, sync: null });
  assert.ok(markup.includes('parsinegar.sync.token-note'));
  assert.ok(markup.includes('parsinegar.sync.single-repo'));
});

test('should_render_sync_status_when_configured', () => {
  const markup = renderSyncView({
    t: (key) => key,
    sync: { configured: true, repo: 'u/r', branch: 'main', lastSyncText: 'امروز', errorText: null },
  });
  assert.ok(markup.includes('data-sync-now'));
  assert.ok(markup.includes('data-sync-remove'));
  assert.ok(markup.includes('u/r'));
  assert.ok(!markup.includes('data-sync-field="token"'), 'expected no token field when configured');
});

test('should_render_sync_error_when_present', () => {
  const markup = renderSyncView({
    t: (key) => key,
    sync: { configured: true, repo: 'u/r', branch: 'main', lastSyncText: null, errorText: 'boom' },
  });
  assert.ok(markup.includes('boom'));
});

test('should_render_sync_error_when_unconfigured', () => {
  const markup = renderSyncView({
    t: (key) => key,
    sync: { configured: false, repo: 'u/r', branch: 'dev', lastSyncText: null, errorText: 'boom', busy: false },
  });
  assert.ok(markup.includes('boom'));
});

test('should_disable_actions_and_rename_labels_when_busy', () => {
  const busy = renderSyncView({
    t: (key) => key,
    sync: { configured: true, repo: 'u/r', branch: 'main', lastSyncText: null, errorText: null, busy: true },
  });
  assert.ok(busy.includes('data-sync-now disabled'));
  assert.ok(busy.includes('part="sync-spinner"'), 'expected the in-button spinner');
  assert.ok(busy.includes('parsinegar.sync.syncing'), 'expected the status note below');
  assert.ok(busy.includes('parsinegar.sync.now</button>'), 'expected the button label kept');
  const connecting = renderSyncView({
    t: (key) => key,
    sync: { configured: false, repo: null, branch: null, lastSyncText: null, errorText: null, busy: true },
  });
  assert.ok(connecting.includes('data-sync-save disabled'));
  assert.ok(connecting.includes('part="sync-spinner"'));
  assert.ok(connecting.includes('parsinegar.sync.connecting'));
});

test('should_mark_main_actions_primary_when_rendered', () => {
  const fresh = renderSyncView({ t: (key) => key, sync: null });
  assert.ok(fresh.includes('data-primary data-sync-save'), 'expected the save primary');
  assert.ok(fresh.includes('data-primary data-sync-ignore-save'), 'expected the ignore save primary');
  const configured = renderSyncView({
    t: (key) => key,
    sync: { configured: true, repo: 'u/r', branch: 'main', lastSyncText: null, errorText: null, busy: false },
  });
  assert.ok(configured.includes('data-primary data-sync-now'), 'expected the sync primary');
  assert.ok(!configured.includes('data-primary data-sync-remove'), 'expected no primary remove');
});

test('should_repopulate_attempt_without_token_when_unconfigured', () => {
  const markup = renderSyncView({
    t: (key) => key,
    sync: { configured: false, repo: 'u/r', branch: 'dev', lastSyncText: null, errorText: null, busy: false },
  });
  assert.ok(markup.includes('value="u/r"'));
  assert.ok(markup.includes('value="dev"'));
  assert.ok(!markup.includes('value="tok"'), 'token must never echo back');
});

test('should_render_ignore_form_with_current_patterns', () => {
  const markup = renderSyncView({
    t: (key) => key,
    sync: { configured: false, repo: null, branch: null, lastSyncText: null, errorText: null, busy: false, ignoreText: 'پیش‌نویس\nکار/' },
  });
  assert.ok(markup.includes('data-sync-field="ignore"'));
  assert.ok(markup.includes('rows="6"'));
  assert.ok(markup.includes('data-sync-ignore-save'));
  assert.ok(markup.includes('پیش‌نویس\nکار/'));
  assert.ok(markup.includes('parsinegar.sync.single-repo'));
  assert.ok(markup.includes('parsinegar.sync.ignore-note'));
});
