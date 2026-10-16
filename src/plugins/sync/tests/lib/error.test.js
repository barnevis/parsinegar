// Verifies the standard Bonyan error shapes (plain objects, typed builders).
import assert from 'node:assert/strict';
import test from 'node:test';
import { syncCriticalError, syncError, syncStartupError } from '../../lib/error.js';

test('should_build_plain_operational_error_when_called', () => {
  const error = syncError('SYNC_NETWORK_FAILED', 'nope', { repo: 'u/r' });
  assert.equal(error instanceof Error, false);
  assert.deepEqual({ ...error, timestamp: 'x' }, {
    code: 'SYNC_NETWORK_FAILED',
    message: 'nope',
    source: 'pey.sync.service',
    type: 'operational',
    timestamp: 'x',
    detail: { repo: 'u/r' },
  });
  assert.equal(typeof error.timestamp, 'string');
});

test('should_default_detail_to_null_when_omitted', () => {
  assert.equal(syncError('SYNC_X', 'y').detail, null);
  assert.equal(syncStartupError('SYNC_X', 'y').detail, null);
  assert.equal(syncCriticalError('SYNC_X', 'y').detail, null);
});

test('should_build_startup_and_critical_errors_when_called', () => {
  assert.equal(syncStartupError('SYNC_X', 'y').type, 'startup');
  const critical = syncCriticalError('LOST', 'gone', { service: 's' });
  assert.equal(critical.type, 'critical');
  assert.equal(critical.source, 'pey.sync.service');
  assert.deepEqual(critical.detail, { service: 's' });
});
