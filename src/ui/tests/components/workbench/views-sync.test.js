// Verifies the sync view renderer (pure function, no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderSyncView } from '../../../components/workbench/views-sync.js';

test('should_render_sync_form_when_unconfigured', () => {
  const markup = renderSyncView({ t: (key) => key, sync: null });
  assert.ok(markup.includes('parsinegar.sync.experimental'), 'expected the experimental notice');
  assert.ok(markup.includes('data-sync-field="repo"'));
  assert.ok(markup.includes('data-sync-field="branch"'));
  assert.ok(markup.includes('data-sync-field="token"'));
  assert.ok(markup.includes('data-sync-save'));
  assert.ok(!markup.includes('data-sync-now'), 'expected no sync button without a backend');
  assert.ok(!markup.includes('data-sync-remove'), 'expected no remove button without a backend');
});

test('should_render_experimental_notice_above_the_sync_group', () => {
  const markup = renderSyncView({ t: (key) => key, sync: null });
  const notice = markup.indexOf('part="settings-notice"');
  const group = markup.indexOf('part="settings-group"');
  assert.ok(notice > -1 && group > -1, 'expected notice and group');
  assert.ok(notice < group, 'expected the notice outside, before the sync box');
  assert.ok(!markup.includes('<fieldset part="sync-host-group"'), 'expected no nested host fieldset');
  assert.ok(markup.includes('part="sync-host-label"'), 'expected a plain host label inside the sync box');
});

test('should_warm_about_token_safety_on_a_tip_icon_when_unconfigured', () => {
  const markup = renderSyncView({ t: (key) => key, sync: null, assetBaseUrl: 'http://a/' });
  assert.ok(markup.includes('part="sync-tip-pop"'), 'expected the tooltip pop');
  assert.ok(markup.includes('parsinegar.sync.token-note'));
  assert.ok(markup.includes('parsinegar.sync.single-repo'));
  assert.ok(markup.includes('parsinegar.sync.warn'), 'expected the warning lead-in');
  assert.ok(markup.includes('part="sync-tip-warn"'), 'expected the styled warning fragment');
  assert.ok(!markup.includes('parsinegar.sync.token-note</p>'), 'expected no print row under the field');
});

test('should_render_status_lines_separately_when_configured', () => {
  const markup = renderSyncView({
    t: (key) => key,
    sync: { configured: true, kind: 'gitlab', repo: 'u/r', branch: 'dev', lastSyncText: 'امروز', errorText: null },
  });
  assert.ok(markup.includes('data-sync-status="host"'));
  assert.ok(markup.includes('data-sync-status="repo"'));
  assert.ok(markup.includes('data-sync-status="branch"'));
  assert.ok(markup.includes('data-sync-status="last"'));
  assert.ok(/data-sync-status="host"[^<]*<\/p>\s*<p/.test(markup.replace(/\n/g, ' ')), 'expected the host line closed before the next');
  assert.ok(markup.includes('parsinegar.sync.host.gitlab'), 'expected the host name');
  assert.ok(markup.includes('u/r'));
  assert.ok(markup.includes('dev'));
  assert.ok(markup.includes('parsinegar.sync.experimental'), 'expected the experimental notice when configured');
  assert.ok(!markup.includes('data-sync-field="token"'), 'expected no token field when configured');
});

test('should_render_sync_error_when_present', () => {
  const markup = renderSyncView({
    t: (key) => key,
    sync: { configured: true, repo: 'u/r', branch: 'main', lastSyncText: null, errorText: 'boom' },
  });
  assert.ok(markup.includes('boom'));
  assert.ok(markup.includes('part="settings-error"'));
});

test('should_render_sync_error_when_unconfigured', () => {
  const markup = renderSyncView({
    t: (key) => key,
    sync: { configured: false, repo: 'u/r', branch: 'dev', lastSyncText: null, errorText: 'boom', busy: false },
  });
  assert.ok(markup.includes('boom'));
});

test('should_disable_sync_now_when_clean_or_busy', () => {
  const clean = renderSyncView({
    t: (key) => key,
    sync: { configured: true, repo: 'u/r', branch: 'main', lastSyncText: 'امروز', errorText: null, busy: false, clean: true },
  });
  assert.ok(clean.includes('data-sync-now disabled'), 'expected the clean state to disable sync');
  assert.ok(!clean.includes('data-sync-remove disabled'), 'expected remove to stay available');
  const dirty = renderSyncView({
    t: (key) => key,
    sync: { configured: true, repo: 'u/r', branch: 'main', lastSyncText: 'امروز', errorText: null, busy: false, clean: false },
  });
  assert.ok(!dirty.includes('data-sync-now disabled'), 'expected sync enabled when there is news to send');
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

test('should_render_base_url_and_auto_commit_help_on_tip_icons', () => {
  const configured = renderSyncView({
    t: (key) => key,
    sync: { configured: true, repo: 'u/r', branch: 'main', lastSyncText: null, errorText: null },
    assetBaseUrl: 'http://a/',
  });
  assert.ok(configured.includes('parsinegar.sync.auto-commit-note'), 'expected the auto-commit help in the pop');
  assert.ok(!configured.includes('parsinegar.sync.auto-commit-note</p>'), 'auto-commit note must not appear as a plain print row');
  const unconfigured = renderSyncView({
    t: (key) => key,
    sync: { configured: false, repo: null, branch: null, lastSyncText: null, errorText: null, busy: false },
    assetBaseUrl: 'http://a/',
  });
  assert.ok(unconfigured.includes('parsinegar.sync.base-url-note'), 'expected the base-url help in the pop');
  assert.ok(!unconfigured.includes('parsinegar.sync.base-url-note</p>'), 'expected no print note under the base URL');
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
  assert.ok(markup.includes('parsinegar.sync.ignore-note'), 'expected the patterns help in the pop');
  assert.ok(/data-sync-ignore-save[^>]*disabled/.test(markup), 'expected the save disabled until edited');
});
