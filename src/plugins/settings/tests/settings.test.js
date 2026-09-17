// Verifies the parsinegar.settings entry point (prepare/activate wiring).
import assert from 'node:assert/strict';
import test from 'node:test';
import { activate, prepare } from '../index.js';

function createPrepareContext() {
  const subscriptions = new Map();
  return {
    subscriptions,
    config: {},
    events: {
      subscribe: (type, listener) => {
        subscriptions.set(type, listener);
        return () => subscriptions.delete(type);
      },
      publish: () => ({ success: true }),
    },
    onShutdown: null,
    onDeactivated: null,
    reportCriticalError: () => {},
  };
}

test('should_register_service_when_prepared', async () => {
  const context = createPrepareContext();
  const provided = await prepare(context);
  assert.deepEqual(provided.map(({ name }) => name), ['parsinegar.settings.service']);
  assert.equal(typeof context.onShutdown, 'function');
  assert.equal(typeof context.onDeactivated, 'function');
  assert.equal(typeof context.subscriptions.get('core:service-unavailable'), 'function');
});

test('should_fail_clearly_when_storage_is_missing', async () => {
  await prepare(createPrepareContext());
  await assert.rejects(activate({}), /pey\.storage\.service/);
});

test('should_fail_service_calls_when_called_before_activation', async () => {
  const provided = await prepare(createPrepareContext());
  const service = provided[0].object;
  await assert.rejects(service.getSettings(), /pey\.storage\.service/);
});

test('should_report_critical_error_when_storage_becomes_unavailable', async () => {
  const context = createPrepareContext();
  let reported = null;
  context.reportCriticalError = (error) => {
    reported = error;
  };
  await prepare(context);
  context.subscriptions.get('core:service-unavailable')({ data: { serviceName: 'pey.storage.service' } });
  assert.equal(reported?.code, 'REQUIRED_DEPENDENCY_LOST');
});

test('should_ignore_unrelated_service_unavailability_when_notified', async () => {
  const context = createPrepareContext();
  let reported = null;
  context.reportCriticalError = (error) => {
    reported = error;
  };
  await prepare(context);
  context.subscriptions.get('core:service-unavailable')({ data: { serviceName: 'some.other.service' } });
  assert.equal(reported, null);
});
