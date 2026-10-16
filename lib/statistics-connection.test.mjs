import assert from 'node:assert/strict';
import test from 'node:test';
import { statisticsConnection } from './statistics/connection.ts';
import { statisticsCatalog, verifiedStatistics } from './statistics/catalog.ts';

test('source-only entries require table linking, never zero or API retry', () => {
  const entry = statisticsCatalog().find(item => !item.data_available);
  const connection = statisticsConnection(entry, undefined);
  assert.equal(connection.status, 'SOURCE_ONLY');
  assert.equal(connection.numeric_data_available, false);
  assert.equal(connection.retry_eligible, false);
});

test('API failure retains a verified numeric snapshot and retry date', () => {
  const entry = statisticsCatalog().find(item => item.data_provider === 'index');
  const result = verifiedStatistics(entry.dataset_id);
  const connection = statisticsConnection(entry, { ...result, refresh_error: 'SOURCE_RATE_LIMITED', auto_refresh: { enabled: true, next_check_at: '2026-10-13T00:00:00Z', status: 'retry_wait' } });
  assert.equal(connection.status, 'REFRESH_FAILED_WITH_SNAPSHOT');
  assert.equal(connection.numeric_data_available, true);
  assert.equal(connection.retry_eligible, true);
  assert.equal(connection.retry_at, '2026-10-13T00:00:00Z');
});
