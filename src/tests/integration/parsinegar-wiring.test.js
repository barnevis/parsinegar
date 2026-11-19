// Wiring/contract checks (bonyan-integration-testing): the real pieces —
// real Core, real plugins, real manifests, real adapters on the fake device
// database — connect the way this app's bootstrap.json declares. UI-free:
// the fake entry only captures what Core binds. Route/UI-invokes-service
// correctness belongs to the UI suite (ui-testing-standard); Core's internal
// mechanisms belong to pey-core's own suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootParsinegar, eventType, readBootstrapJson, readUnitManifest } from './boot.js';

const UI_REF = './src/ui';

// Where each service's real providing manifest lives, for method-shape
// checks against the declarations (no duplicated method lists here).
const PROVIDING_MANIFESTS = {
  'pey.router.service': './node_modules/pey.router',
  'pey.storage.service': './node_modules/pey.storage',
  'pey.sync.service': './node_modules/pey.sync',
  'parsinegar.app.service': './src/plugins/app',
  'parsinegar.documents.service': './src/plugins/documents',
  'parsinegar.settings.service': './src/plugins/settings',
  'pey.filesystem.service': './node_modules/pey.filesystem',
  'pey.markdown.service': './node_modules/pey.markdown',
  'pey.document-export.service': './node_modules/pey.document-export',
};

test('should_start_infrastructure_before_application_and_ui_last_when_booted', async () => {
  const bootstrap = await readBootstrapJson();
  const instance = await bootParsinegar();
  try {
    assert.equal(instance.ready, true);
    const listOrder = bootstrap.plugins.map((plugin) => plugin.path);
    const types = {};
    for (const ref of listOrder) {
      types[ref] = (await readUnitManifest(ref)).type;
    }
    const infrastructure = listOrder.filter((ref) => types[ref] === 'infrastructure');
    const application = listOrder.filter((ref) => types[ref] !== 'infrastructure');
    // Group separation (infrastructure first) and in-group bootstrap order
    // are the real declared dependency graph; the UI boots last.
    assert.deepEqual(instance.loader.calls.entries, [...infrastructure, ...application, UI_REF]);
  } finally {
    await instance.shutdown();
  }
});

test('should_publish_storage_ready_before_core_ready_when_booted', async () => {
  const instance = await bootParsinegar();
  try {
    assert.equal(instance.ready, true);
    const types = instance.events.map(eventType);
    const storageReady = types.indexOf('storage:ready');
    const coreReady = types.indexOf('core:ready');
    assert.ok(storageReady !== -1, 'expected storage:ready to be published');
    assert.ok(coreReady !== -1, 'expected core:ready to be published');
    assert.ok(storageReady < coreReady, 'storage:ready must precede core:ready');
    assert.equal(instance.ui.captured.setups, 1, 'the UI must have been set up exactly once');
  } finally {
    await instance.shutdown();
  }
});

test('should_bind_every_ui_required_service_with_its_declared_methods_when_ready', async () => {
  const uiManifest = await readUnitManifest(UI_REF);
  const instance = await bootParsinegar();
  try {
    assert.equal(instance.ready, true);
    const services = instance.ui.captured.context.services;
    for (const serviceName of uiManifest.dependencies.required) {
      const service = services[serviceName];
      assert.ok(service && typeof service === 'object', `missing UI-required service: ${serviceName}`);
      const manifest = await readUnitManifest(PROVIDING_MANIFESTS[serviceName]);
      const provided = manifest.provides.find((entry) => entry.name === serviceName);
      assert.ok(provided, `no provides entry found for ${serviceName}`);
      for (const method of provided.methods) {
        assert.equal(typeof service[method.name], 'function',
          `${serviceName}.${method.name} must be callable as declared`);
      }
    }
  } finally {
    await instance.shutdown();
  }
});

test('should_deactivate_the_failed_plugin_and_still_reach_ready_when_a_feature_entry_is_refused', async () => {
  // pey.markdown is a feature whose service pey.markdown.service feeds
  // pey.document-export. An activation-level refusal (manifest valid, entry
  // load fails) must deactivate exactly the failed plugin, cascade to the
  // dependents, and still reach core:ready — the non-fatal contract for
  // feature/product types.
  const instance = await bootParsinegar({ refuseEntries: ['./node_modules/pey.markdown'] });
  try {
    const types = instance.events.map(eventType);
    assert.ok(types.includes('core:plugin-failed'), 'expected core:plugin-failed for the refused plugin');
    assert.ok(types.includes('core:ready'), 'the system itself must still reach core:ready');
    assert.equal(instance.ui.captured.setups, 1, 'the Core binds the UI; the kit owns required-service enforcement');
    const services = instance.ui.captured.context.services;
    assert.equal('pey.markdown.service' in services, false,
      'the refused plugin must provide no service');
    assert.equal('pey.document-export.service' in services, false,
      'the dependent export plugin must not survive the cascade');
    const documents = services['parsinegar.documents.service'];
    assert.equal(Array.isArray(await documents.listDocuments()), true,
      'unrelated services must stay alive');
  } finally {
    await instance.shutdown();
  }
});

test('should_publish_startup_failed_without_core_ready_when_a_manifest_is_refused', async () => {
  // A manifest that cannot load leaves a hole in the declared dependency
  // graph: the Core stops the whole startup (core:startup-failed), never
  // publishes core:ready, and start() still resolves with a shutdown fn.
  const instance = await bootParsinegar({ refuse: ['./node_modules/pey.storage'] });
  try {
    assert.equal(instance.ready, false);
    const types = instance.events.map(eventType);
    assert.ok(types.includes('core:plugin-failed'), 'expected core:plugin-failed for the refused plugin');
    assert.ok(types.includes('core:startup-failed'), 'expected core:startup-failed');
    assert.equal(types.includes('core:ready'), false, 'core:ready must never be published');
    assert.equal(instance.ui.captured.setups, 0, 'the UI must never set up on a failed startup');
  } finally {
    await instance.shutdown();
  }
});

test('should_stop_ui_and_fail_post_shutdown_service_calls_safely_when_shutdown', async () => {
  const instance = await bootParsinegar();
  try {
    assert.equal(instance.ready, true);
    const documents = instance.ui.captured.context.services['parsinegar.documents.service'];
    await instance.shutdown();
    assert.equal(instance.ui.captured.shutdowns, 1, 'the UI onShutdown hook must run once');
    const types = instance.events.map(eventType);
    assert.ok(types.includes('core:shutdown'), 'expected core:shutdown to be published');
    const outcome = await documents.listDocuments().then(
      (value) => ({ resolved: value }),
      (error) => ({ rejected: error }),
    );
    const failedSafely = Boolean(outcome.rejected)
      || (outcome.resolved !== null && typeof outcome.resolved === 'object'
        && !Array.isArray(outcome.resolved) && 'error' in outcome.resolved);
    assert.equal(failedSafely, true,
      'a service call after shutdown must fail safely — not silently succeed');
  } finally {
    await instance.shutdown();
  }
});

// No optional-dependency variation exists to exercise: every manifest in
// this app's bootstrap.json (and the UI manifest) declares `optional: []`,
// so there is no supported on/off combination beyond the everything-present
// boot covered above.
