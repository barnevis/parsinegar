// Verifies the backend kind registry (pure, no I/O).
import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_ADAPTERS, descriptorFor, instantiateBackend, mapAdapterError } from '../../lib/sync-backend.js';

const fakeDescriptor = {
  kind: 'fake',
  create: (params, fetchFn) => ({ params, fetchFn }),
  errorMap: { FAKE_DENIED: 'SYNC_AUTH_FAILED' },
  revMismatchCode: 'FAKE_REV_MISMATCH',
};

function stateWith(adapters) {
  return { storage: null, events: null, fetchFn: async () => ({}), adapters };
}

test('should_resolve_registered_kind_when_describing', () => {
  assert.equal(descriptorFor(stateWith({ fake: fakeDescriptor }), 'fake'), fakeDescriptor);
  assert.equal(descriptorFor({ storage: null }, 'git').kind, 'git');
  assert.deepEqual(Object.keys(DEFAULT_ADAPTERS), ['git', 'gitlab']);
  assert.equal(DEFAULT_ADAPTERS.gitlab.revMismatchCode, 'GITL_REV_MISMATCH');
});

test('should_reject_unknown_kind_when_describing', () => {
  assert.equal(descriptorFor(stateWith(undefined), 'git').kind, 'git');
  for (const adapters of [{}, { git: null }, { git: {} }]) {
    const error = (() => {
      try {
        descriptorFor(stateWith(adapters), 'git');
      } catch (caught) {
        return caught;
      }
      return null;
    })();
    assert.equal(error?.code, 'SYNC_INVALID_CONFIG');
  }
  const missing = (() => {
    try {
      descriptorFor(stateWith({ fake: fakeDescriptor }), 'nope');
    } catch (caught) {
      return caught;
    }
    return null;
  })();
  assert.equal(missing?.code, 'SYNC_INVALID_CONFIG');
});

test('should_pass_record_and_fetch_when_instantiating', async () => {
  const fetchFn = async () => ({});
  const { adapter, descriptor } = instantiateBackend(
    { storage: null, events: null, fetchFn, adapters: { fake: fakeDescriptor } },
    { kind: 'fake', repo: 'u/r' },
  );
  assert.equal(descriptor, fakeDescriptor);
  assert.equal(adapter.params.repo, 'u/r');
  assert.equal(adapter.fetchFn, fetchFn);
  const error = (() => {
    try {
      instantiateBackend(stateWith({}), 'fake');
    } catch (caught) {
      return caught;
    }
    return null;
  })();
  assert.equal(error?.code, 'SYNC_INVALID_CONFIG');
});

test('should_preserve_sync_errors_and_map_adapter_ones_when_mapping', () => {
  const through = { code: 'SYNC_NETWORK_FAILED', message: 'x' };
  assert.equal(mapAdapterError(fakeDescriptor, through), through);
  const mapped = mapAdapterError(fakeDescriptor, { code: 'FAKE_DENIED', message: 'no' });
  assert.equal(mapped.code, 'SYNC_AUTH_FAILED');
  assert.equal(mapped.detail.adapterCode, 'FAKE_DENIED');
  assert.equal(mapped.detail.kind, 'fake');
  const fallback = mapAdapterError(fakeDescriptor, { code: '???', message: 'x' });
  assert.equal(fallback.code, 'SYNC_NETWORK_FAILED');
  assert.equal(mapAdapterError({}, {}).code, 'SYNC_NETWORK_FAILED');
});
