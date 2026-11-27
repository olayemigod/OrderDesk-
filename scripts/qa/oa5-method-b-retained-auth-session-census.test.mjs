import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
 assessMethodBRetainedAuthSessionCensus,COUNTS,TEST_REF,PURPOSE,ARCHIVE_DAY_END
} from './oa5-method-b-retained-auth-session-census.mjs';

const NOW=new Date('2026-11-13T07:10:00Z');
const DIGEST='f'.repeat(64);
const valid=()=>({
 schema_version:1,project_ref:TEST_REF,purpose:PURPOSE,
 captured_at_utc:'2026-11-13T07:09:00Z',
 archive_day_end_utc:ARCHIVE_DAY_END,
 counts:{...COUNTS},
 identity_fingerprints:{
  historical_user_set_sha256:DIGEST,
  pre_cutoff_session_set_sha256:'b'.repeat(64),
  all_session_set_sha256:'c'.repeat(64)
 }
});
const assess=s=>assessMethodBRetainedAuthSessionCensus(s,NOW);

test('exact retained Auth cohort provenance passes only as a read-only count/shape observation',()=>{
 const r=assess(valid());
 assert.equal(r.observed_retained_auth_session_provenance_consistent,true,r.reasons.join('; '));
 for(const flag of [
  'archive_user_and_session_id_parity_verified',
  'historic_privileged_actor_denial_verified',
  'existing_jwt_and_refresh_token_safety_verified',
  'provider_ingress_egress_quiescence_verified',
  'hosted_test_reconstruction_authorized',
  'auth_deletion_or_session_revocation_authorized',
  'production_change_authorized'
 ]) assert.equal(r[flag],false,flag);
});

test('reject Production, malformed stage and historical cutoff tampering',()=>{
 for(const change of [
  s=>s.project_ref='eujxswjspolugrzlsjnn',
  s=>s.project_ref='production',
  s=>s.purpose='reset-authorized',
  s=>s.archive_day_end_utc='2026-11-09T00:00:00Z',
  s=>s.schema_version=2,
  s=>s.jwt='secret',
  s=>s.counts.user_id='secret',
  s=>s.identity_fingerprints.refresh_token='secret'
 ]){
  const s=valid();change(s);
  assert.equal(assess(s).observed_retained_auth_session_provenance_consistent,false);
 }
 assert.equal(assess(null).observed_retained_auth_session_provenance_consistent,false);
});

test('no drift of retained users, privileged post-archive sessions, refresh tokens or external worker queues passes',()=>{
 for(const [k,n] of Object.entries(COUNTS)){
  for(const v of [n+1, -1, String(n)]){
   const s=valid();s.counts[k]=v;
   const r=assess(s);
   assert.equal(r.observed_retained_auth_session_provenance_consistent,false,k+'='+v);
   assert.equal(r.hosted_test_reconstruction_authorized,false);
  }
  const s=valid();delete s.counts[k];
  assert.equal(assess(s).observed_retained_auth_session_provenance_consistent,false,k);
 }
});

test('five pre-cutoff and two after-cutoff privileged sessions must partition exactly',()=>{
 for(const change of [
  s=>s.counts.total_sessions=6,
  s=>s.counts.post_cutoff_sessions=3,
  s=>s.counts.post_cutoff_historical_user_sessions=1,
  s=>s.counts.post_cutoff_unrecognized_user_sessions=1,
  s=>s.counts.post_cutoff_admin_sessions=0,
  s=>s.counts.post_cutoff_member_sessions=0,
  s=>s.counts.orphan_sessions=1
 ]){
  const s=valid();change(s);
  assert.equal(assess(s).observed_retained_auth_session_provenance_consistent,false);
 }
});

test('private fingerprints, freshness and unknown fields are fail closed',()=>{
 for(const change of [
  s=>s.identity_fingerprints.historical_user_set_sha256='not-a-hash',
  s=>delete s.identity_fingerprints.all_session_set_sha256,
  s=>s.identity_fingerprints.pre_cutoff_session_set_sha256='0'.repeat(63),
  s=>s.captured_at_utc='2026-11-13T06:00:00Z',
  s=>s.captured_at_utc='2026-11-13T07:11:00Z',
  s=>s.captured_at_utc='invalid'
 ]){
  const s=valid();change(s);
  assert.equal(assess(s).observed_retained_auth_session_provenance_consistent,false);
 }
});

test('offline CLI refuses absent private evidence without leaking path',()=>{
 const path='/private/merchant-auth-snapshot-secret.json';
 const script=new URL('./oa5-method-b-retained-auth-session-census.mjs',import.meta.url).pathname;
 const run=spawnSync(process.execPath,[script,'--check',path],{encoding:'utf8'});
 assert.equal(run.status,1);
 assert.match(run.stderr,/BLOCKED/);
 assert.equal(run.stderr.includes(path),false);
});
