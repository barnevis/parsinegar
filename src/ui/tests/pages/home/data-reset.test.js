// Verifies the data reset factory: arming, the modal snapshot, the wipe
// service envelope and the reload-on-success seam.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDataReset } from '../../../pages/home/data-reset.js';

function createResetService({ failure = false } = {}) {
  const service = { calls: [] };
  service.wipeAllData = async () => {
    service.calls.push('wipeAllData');
    if (failure) {
      throw { code: 'APP_STORAGE_UNAVAILABLE', source: 'parsinegar.app.service', type: 'operational' };
    }
    return { ok: true, cleared: { documents: 1 } };
  };
  return service;
}

test('should_show_wipe_modal_only_while_armed', () => {
  const resets = createDataReset({ getService: () => null });
  assert.equal(resets.modal(), null);
  resets.arm();
  assert.deepEqual(resets.modal(), { kind: 'confirm-wipe' });
  resets.cancel();
  assert.equal(resets.modal(), null);
});

test('should_wipe_and_reload_when_confirmed', async () => {
  const service = createResetService();
  const reloads = [];
  const resets = createDataReset({ getService: () => service, reload: () => reloads.push(true) });
  resets.arm();
  const wiped = await resets.confirm();
  assert.equal(wiped, true);
  assert.deepEqual(service.calls, ['wipeAllData']);
  assert.deepEqual(reloads, [true]);
  assert.equal(resets.modal(), null, 'expected the arm closed after the run');
});

test('should_keep_page_when_service_is_missing', async () => {
  const reloads = [];
  const resets = createDataReset({ getService: () => null, reload: () => reloads.push(true) });
  resets.arm();
  const wiped = await resets.confirm();
  assert.equal(wiped, false);
  assert.deepEqual(reloads, []);
});

test('should_keep_page_when_the_wipe_fails', async () => {
  const service = createResetService({ failure: true });
  const reloads = [];
  const resets = createDataReset({ getService: () => service, reload: () => reloads.push(true) });
  resets.arm();
  const wiped = await resets.confirm();
  assert.equal(wiped, false);
  assert.deepEqual(service.calls, ['wipeAllData']);
  assert.deepEqual(reloads, [], 'expected no reload on a failed atomic wipe');
});

test('should_not_wipe_when_disconnected', async () => {
  const service = createResetService();
  const reloads = [];
  const resets = createDataReset({ getService: () => service, isConnected: () => false, reload: () => reloads.push(true) });
  resets.arm();
  const wiped = await resets.confirm();
  assert.equal(wiped, false);
  assert.deepEqual(service.calls, []);
});
