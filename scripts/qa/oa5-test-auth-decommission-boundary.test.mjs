import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { TEST_REF, PURPOSE, COUNT_KEYS, assessTestAuthDecommissionBoundary } from './oa5-test-auth-decommission-boundary.mjs';

const now = new Date('2026-11-09T20:20:00Z');
const clean = () => ({
  schema_version: 1, project_ref: TEST_REF, purpose: PURPOSE,
  captured_at_utc: '2026-11-09T20:19:00Z',
  counts: Object.fromEntries(COUNT_KEYS.map(k => [k,0]))
});

test('synthetic dependency-free state never grants Auth deletion or reset authority', () => {
  const result = assessTestAuthDecommissionBoundary(clean(), now);
  assert.equal(result.dependencies_clear,true);
  assert.equal(result.auth_user_deletion_authorized,false);
  assert.equal(result.destructive_execution_authorized,false);
});

test('current historical Test metadata (66 external FKs) fails closed', () => {
  const s=clean();
  s.counts = {
    external_auth_user_fks:66, external_restrict_fks:30,
    external_cascade_fks:8, external_set_null_fks:28,
    external_other_fks:0, auth_users_custom_triggers:0
  };
  const result = assessTestAuthDecommissionBoundary(s, now);
  assert.equal(result.dependencies_clear,false);
  assert.equal(result.auth_user_deletion_authorized,false);
});

test('any relationship or auth.users trigger blocks Auth decommission', () => {
  for (const key of COUNT_KEYS) {
    const s=clean(); s.counts[key]=1;
    assert.equal(assessTestAuthDecommissionBoundary(s,now).dependencies_clear,false,key);
  }
});

test('wrong production project, purpose, schema or extra secret blocks', () => {
  for (const change of [
    s=>{s.project_ref='eujxswjspolugrzlsjnn';},
    s=>{s.project_ref='test';},
    s=>{s.purpose='delete-all-auth-users';},
    s=>{s.schema_version=2;},
    s=>{s.service_role='secret';},
    s=>{s.counts.session_token='secret';}
  ]) {
    const s=clean(); change(s);
    assert.equal(assessTestAuthDecommissionBoundary(s,now).dependencies_clear,false);
  }
});

test('stale/future timestamp, missing or malformed counts block', () => {
  for(const timestamp of ['2026-11-09T19:59:00Z','2026-11-09T20:21:00Z','invalid']) {
    const s=clean();s.captured_at_utc=timestamp;
    assert.equal(assessTestAuthDecommissionBoundary(s,now).dependencies_clear,false);
  }
  for(const key of COUNT_KEYS) {
    const missing=clean();delete missing.counts[key];
    assert.equal(assessTestAuthDecommissionBoundary(missing,now).dependencies_clear,false);
    for(const bad of [-1,0.5,'0',null]) {
      const s=clean();s.counts[key]=bad;
      assert.equal(assessTestAuthDecommissionBoundary(s,now).dependencies_clear,false);
    }
  }
  assert.equal(assessTestAuthDecommissionBoundary(null,now).dependencies_clear,false);
  assert.equal(assessTestAuthDecommissionBoundary([],now).dependencies_clear,false);
});

test('inconsistent category counts fail even if zero custom triggers', () => {
  const s=clean();
  s.counts.external_auth_user_fks=0;
  s.counts.external_restrict_fks=2;
  assert.equal(assessTestAuthDecommissionBoundary(s,now).dependencies_clear,false);
});

test('missing private operator file yields fail-closed CLI exit without network', () => {
  const cli = spawnSync(process.execPath,[
    new URL('./oa5-test-auth-decommission-boundary.mjs',import.meta.url).pathname,
    '--check','/not-present/private-Test-auth-fk-census.json'
  ],{encoding:'utf8'});
  assert.equal(cli.status,1);
  assert.match(cli.stderr,/BLOCKED/);
  assert.doesNotMatch(cli.stderr,/service_role|sk_live_/);
});
