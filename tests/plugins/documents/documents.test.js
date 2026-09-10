// Verifies the parsinegar.documents entry point (prepare/activate wiring).
import assert from 'node:assert/strict';
import test from 'node:test';
import { activate, prepare } from '../../../src/plugins/documents/index.js';

function createPrepareContext() {
  return {
    config: {},
    events: { subscribe: () => () => {}, publish: () => ({ success: true }) },
    onShutdown: null,
    onDeactivated: null,
    reportCriticalError: () => {},
  };
}

test('should_register_service_when_prepared', async () => {
  const context = createPrepareContext();
  const provided = await prepare(context);
  assert.deepEqual(provided.map(({ name }) => name), ['parsinegar.documents.service']);
  assert.equal(typeof context.onShutdown, 'function');
  assert.equal(typeof context.onDeactivated, 'function');
});

test('should_fail_clearly_when_storage_is_missing', async () => {
  await prepare(createPrepareContext());
  await assert.rejects(activate({}), /pey\.storage\.service/);
});

test('should_fail_service_calls_when_called_before_activation', async () => {
  const provided = await prepare(createPrepareContext());
  const service = provided[0].object;
  await assert.rejects(service.listDocuments(), /pey\.storage\.service/);
});
