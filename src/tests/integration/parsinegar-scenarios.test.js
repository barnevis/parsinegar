// Scenario checks (bonyan-integration-testing): real business journeys that
// cross more than one real plugin, called through the real bound services in
// the same order and data shape the product's critical paths produce. The
// network is never touched by these journeys; the database engine is
// fake-indexeddb under the real IndexedDBAdapter. The browser-only
// filesystem picker flows (pey.filesystem's dialog APIs) are exercised by
// real-browser probes instead — no fake adapter is forced in here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootParsinegar } from './boot.js';

const DOCUMENTS = 'parsinegar.documents.service';
const SETTINGS = 'parsinegar.settings.service';
const APP = 'parsinegar.app.service';
const EXPORT = 'pey.document-export.service';
const SYNC = 'pey.sync.service';
const FILESYSTEM = 'pey.filesystem.service';

test('should_empty_every_store_and_restore_defaults_when_wipe_all_data_is_called', async () => {
  // The factory-reset journey: one call crossing documents, settings,
  // folders, disk drafts and both sync stores. Each store is filled through
  // its real owning service — the same way the product fills them — and
  // verified through that owner afterwards (the UI never binds raw storage).
  // The only faked I/O is the network: the git adapter's open() probes the
  // repo and branch endpoints, answered 200 by the environment-level double.
  const instance = await bootParsinegar({
    network: (url) => {
      const target = String(url);
      if (!target.startsWith('https://api.github.com/repos/owner/test-repo')) {
        return undefined;
      }
      const payload = target.includes('/branches/')
        ? { name: 'main', commit: { sha: 'test-sha' } }
        : { full_name: 'owner/test-repo', default_branch: 'main' };
      return {
        ok: true,
        status: 200,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      };
    },
  });
  try {
    assert.equal(instance.ready, true);
    const services = instance.ui.captured.context.services;
    const documents = services[DOCUMENTS];
    const settings = services[SETTINGS];
    const app = services[APP];
    const sync = services[SYNC];
    const filesystem = services[FILESYSTEM];

    await documents.createDocument('یادداشت پاک‌سازی');
    await documents.createFolder('پوشه پاک‌سازی');
    await settings.saveSettings({ theme: 'sepia', direction: 'rtl', fontSize: 18 });
    await filesystem.saveShadow('پوشهٔ دستگاه آزمون', 'یادداشت.md', '', 'پیش‌نویس آزمون');
    const configured = await sync.configureBackend({
      kind: 'git',
      params: { host: 'github', repo: 'owner/test-repo', branch: 'main', token: 'test-token' },
    });
    assert.equal(configured.ok, true, 'the sync backend must configure without touching the network');
    assert.equal((await sync.getStatus()).configured, true, 'the backend must be configured before the wipe');

    await app.wipeAllData();

    assert.deepEqual(await documents.listDocuments(), []);
    assert.deepEqual(await documents.listFolders(), []);
    assert.equal(await filesystem.readShadow('پوشهٔ دستگاه آزمون', 'یادداشت.md'), null,
      'the disk draft must be wiped');
    assert.deepEqual(await sync.getStatus(), { configured: false, lastSyncAt: null, lastError: null },
      'the sync backend and state must be wiped');
    const defaults = await settings.getSettings();
    assert.equal(defaults.theme, 'device', 'settings must fall back to the product default');
    assert.equal(defaults.direction, 'auto');
    assert.equal(defaults.fontSize, 16);
  } finally {
    await instance.shutdown();
  }
});

test('should_keep_documents_reachable_across_rename_folder_move_and_title_conflicts_when_organized', async () => {
  // The library-organization journey: create → folder move → rename, with
  // the unique-title contract enforced by the real service on top of the
  // real storage adapter.
  const instance = await bootParsinegar();
  try {
    assert.equal(instance.ready, true);
    const documents = instance.ui.captured.context.services[DOCUMENTS];

    const first = await documents.createDocument('یادداشت نخست');
    const second = await documents.createDocument('یادداشت دوم');
    const folder = await documents.createFolder('کار');

    const moved = await documents.moveDocument(first.id, folder.id);
    assert.equal(moved.folderId, folder.id);
    assert.deepEqual((await documents.listFolders()).map((entry) => entry.name), ['کار']);

    const renamed = await documents.renameDocument(first.id, 'گزارش کار');
    assert.equal(renamed.title, 'گزارش کار');
    const reopened = await documents.openDocument(first.id);
    assert.equal(reopened.title, 'گزارش کار');

    await assert.rejects(
      () => documents.renameDocument(second.id, 'گزارش کار'),
      (error) => error?.code === 'DOCUMENT_TITLE_DUPLICATE',
      'the unique-title contract must hold on the real services',
    );
  } finally {
    await instance.shutdown();
  }
});

test('should_persist_valid_settings_and_reject_invalid_values_when_saved', async () => {
  // The preferences journey: a validated write/read round-trip where the
  // settings domain — not the caller — owns the rules.
  const instance = await bootParsinegar();
  try {
    assert.equal(instance.ready, true);
    const settings = instance.ui.captured.context.services[SETTINGS];

    const saved = await settings.saveSettings({ theme: 'sepia', direction: 'rtl', fontSize: 18 });
    assert.equal(saved.theme, 'sepia');
    const readBack = await settings.getSettings();
    assert.deepEqual(
      { theme: readBack.theme, direction: readBack.direction, fontSize: readBack.fontSize },
      { theme: 'sepia', direction: 'rtl', fontSize: 18 },
    );

    await assert.rejects(
      () => settings.saveSettings({ theme: 'bogus' }),
      (error) => error?.code === 'SETTINGS_INVALID_VALUE',
      'an invalid theme must be rejected by the settings domain',
    );
    await assert.rejects(
      () => settings.saveSettings({ fontSize: 99 }),
      (error) => error?.code === 'SETTINGS_INVALID_VALUE',
      'an out-of-range font size must be rejected',
    );
    const afterRejection = await settings.getSettings();
    assert.equal(afterRejection.theme, 'sepia', 'a rejected patch must leave stored settings untouched');
  } finally {
    await instance.shutdown();
  }
});

test('should_produce_standalone_rtl_html_from_a_real_document_when_exported', async () => {
  // The export journey: a real document on the real storage flows through
  // the real export plugin (which consumes the real pey.markdown service).
  const instance = await bootParsinegar();
  try {
    assert.equal(instance.ready, true);
    const services = instance.ui.captured.context.services;
    const documents = services[DOCUMENTS];
    const exportService = services[EXPORT];

    const document = await documents.createDocument('گزارش صادرات');
    await documents.saveDocument({
      id: document.id,
      content: '# گزارش صادرات\n\nاین **متن** آزمون است.',
    });
    const stored = await documents.openDocument(document.id);

    const result = await exportService.exportHtml({
      markdown: stored.content,
      title: stored.title,
      theme: 'sepia',
    });
    assert.equal(result.mime, 'text/html');
    assert.equal(result.filename.length > 0, true);
    assert.ok(result.html.includes('dir="rtl"'), 'the standalone page must be RTL');
    assert.ok(result.html.includes('<h1'), 'the heading must render as real HTML');
    assert.ok(result.html.includes('گزارش صادرات'), 'the title must appear in the page');
    assert.ok(result.html.includes('<strong>متن</strong>'), 'inline markdown must render');
  } finally {
    await instance.shutdown();
  }
});
