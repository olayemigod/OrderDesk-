import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { assessTestManagedBoundary, BASELINE_20261109, TEST_REF } from './oa5-test-managed-boundary.mjs';

const now = new Date('2026-11-09T17:15:30Z');
const snapshot = () => ({
  schema_version: 1, project_ref: TEST_REF,
  captured_at_utc: '2026-11-09T17:15:00Z',
  counts: { ...BASELINE_20261109 }
});

test('matching synthetic Test count snapshot is not permission to cleanup', () => {
  const result = assessTestManagedBoundary(snapshot(), now);
  assert.equal(result.ok, true);
  assert.equal(result.managed_cleanup_authorized, false);
  assert.equal(result.destructive_execution_authorized, false);
});
test('Production or ambiguous project and unknown schema fail closed', () => {
  for (const change of [
    s => { s.project_ref = 'eujxswjspolugrzlsjnn'; },
    s => { s.project_ref = 'staging'; },
    s => { s.schema_version = 2; },
    s => { s.secret = 'not-allowed'; }
  ]) {
    const s = snapshot(); change(s);
    assert.equal(assessTestManagedBoundary(s, now).ok, false);
  }
});
test('stale, malformed or future timestamps are rejected', () => {
  for (const value of ['2026-11-09T17:00:00Z', '2026-11-09T17:17:00Z', 'not-a-date']) {
    const s = snapshot(); s.captured_at_utc = value;
    assert.equal(assessTestManagedBoundary(s, now).ok, false);
  }
});
test('observed Test seven sessions and twenty-two refresh tokens fail closed against dated managed baseline', () => {
  const s = snapshot();
  s.counts.auth_sessions = 7;
  s.counts.auth_refresh_tokens = 22;
  const result = assessTestManagedBoundary(s, now);
  assert.equal(result.ok, false);
  assert.equal(result.managed_cleanup_authorized, false);
  assert.equal(result.destructive_execution_authorized, false);
  assert.match(result.reasons.join(' '), /auth_sessions/);
  assert.match(result.reasons.join(' '), /auth_refresh_tokens/);
});

test('missing/extra/negative/fractional fields and even one count drift stop', () => {
  for (const key of Object.keys(BASELINE_20261109)) {
    let s = snapshot(); s.counts[key] += 1;
    assert.equal(assessTestManagedBoundary(s, now).ok, false, 'drift: ' + key);
    s = snapshot(); delete s.counts[key];
    assert.equal(assessTestManagedBoundary(s, now).ok, false, 'missing: ' + key);
    s = snapshot(); s.counts[key] = -1;
    assert.equal(assessTestManagedBoundary(s, now).ok, false, 'negative: ' + key);
    s = snapshot(); s.counts[key] = .5;
    assert.equal(assessTestManagedBoundary(s, now).ok, false, 'fraction: ' + key);
  }
  const s = snapshot(); s.counts.token = 'not-allowed';
  assert.equal(assessTestManagedBoundary(s, now).ok, false);
});
test('malformed snapshot and CLI without evidence are blocked offline', () => {
  assert.equal(assessTestManagedBoundary(null, now).ok, false);
  assert.equal(assessTestManagedBoundary([], now).ok, false);
  const run = spawnSync(process.execPath,
    [new URL('./oa5-test-managed-boundary.mjs', import.meta.url).pathname, '--check', '/not-present/private-snapshot.json'],
    { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /BLOCKED/);
});
