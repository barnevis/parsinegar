// Verifies pey.filesystem entry point (prepare/activate wiring).
import assert from 'node:assert/strict';
import test from 'node:test';
import { activate, prepare } from '../index.js';

function createPrepareContext() {
  const subscribed = [];
  return {
    context: {
      config: {},
      events: {
        subscribe: (type, handler) => {
          subscribed.push([type, handler]);
          return () => {};
        },
        publish: () => ({ success: true }),
      },
      onShutdown: null,
      onDeactivated: null,
      reportCriticalError: () => {},
    },
    subscribed,
  };
}

function createStorage() {
  return {
    async read() {
      return null;
    },
    async write() {},
    async delete() {},
  };
}

test('should_register_service_when_prepared', async () => {
  const { context } = createPrepareContext();
  const provided = await prepare(context);
  assert.deepEqual(provided.map(({ name }) => name), ['pey.filesystem.service']);
  assert.equal(typeof context.onShutdown, 'function');
  assert.equal(typeof context.onDeactivated, 'function');
});

test('should_fail_clearly_when_storage_is_missing', async () => {
  const { context } = createPrepareContext();
  await prepare(context);
  await assert.rejects(activate({}), /pey\.storage\.service/);
});

test('should_fail_shadow_calls_when_called_before_activation', async () => {
  const { context } = createPrepareContext();
  const provided = await prepare(context);
  const service = provided[0].object;
  await assert.rejects(
    service.saveShadow('root', 'a.md', 'base', 'draft'),
    (error) => error?.code === 'FILESYSTEM_STORAGE_UNAVAILABLE',
  );
});

test('should_report_critical_when_storage_is_lost', async () => {
  const { context, subscribed } = createPrepareContext();
  const reported = [];
  context.reportCriticalError = (error) => {
    reported.push(error);
  };
  await prepare(context);
  await activate({ 'pey.storage.service': createStorage() });
  const handler = subscribed.find(([type]) => type === 'core:service-unavailable')?.[1];
  assert.equal(typeof handler, 'function');
  handler({ data: { serviceName: 'other.service' } });
  assert.deepEqual(reported, []);
  handler({ data: { serviceName: 'pey.storage.service' } });
  assert.equal(reported.length, 1);
  assert.equal(reported[0].code, 'REQUIRED_DEPENDENCY_LOST');
  assert.equal(reported[0].type, 'critical');
});
