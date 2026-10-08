// Verifies pey.filesystem entry point (prepare/activate wiring).
import assert from 'node:assert/strict';
import test from 'node:test';
import { activate, prepare } from '../index.js';

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
  assert.deepEqual(provided.map(({ name }) => name), ['pey.filesystem.service']);
  assert.equal(typeof context.onShutdown, 'function');
  assert.equal(typeof context.onDeactivated, 'function');
});

test('should_activate_without_dependencies_when_bound', async () => {
  await prepare(createPrepareContext());
  await activate({});
});
