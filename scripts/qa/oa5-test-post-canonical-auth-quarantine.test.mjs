import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
  assessPostCanonicalAuthQuarantine,TEST_REF,PRE_PURPOSE,POST_PURPOSE,
  HISTORIC_AUTH_LINK_CATEGORIES,EXPECTED_CANONICAL_MIGRATIONS
} from './oa5-test-post-canonical-auth-quarantine.mjs';

const SHA='a'.repeat(40),fingerprint='b'.repeat(64);
const now=new Date('2026-11-11T22:25:00Z');
const fixture=()=>({
  pre:{schema_version:1,project_ref:TEST_REF,purpose:PRE_PURPOSE,
    captured_at_utc:'2026-11-11T20:00:00Z',
    cohort:{historical_users:5,identity_set_sha256:fingerprint}},
  post:{schema_version:1,project_ref:TEST_REF,purpose:POST_PURPOSE,
    captured_at_utc:'2026-11-11T22:22:00Z',historical_cutoff_utc:'2026-11-11T20:00:00Z',
    reviewed_source_sha:SHA,
    cohort:{historical_users:5,identity_set_sha256:fingerprint},
    grants:Object.fromEntries(HISTORIC_AUTH_LINK_CATEGORIES.map(k=>[k,0])),
    canonical:{applied_migrations:EXPECTED_CANONICAL_MIGRATIONS,
      new_auth_users:2,new_business_members:1,businesses_present:1}}
});
const assess=(x)=>assessPostCanonicalAuthQuarantine(x.pre,x.post,{sourceSha:SHA,now});
test('valid synthetic count-only evidence cannot authorize hosted test or production work',()=>{
  const result=assess(fixture());
  assert.equal(result.sql_authority_link_quarantine_evidence_consistent,true,result.reasons.join('; '));
  for(const key of ['authenticated_historical_actor_rls_test_verified',
    'old_jwt_session_revocation_verified','provider_callback_isolation_verified',
    'historical_preview_reviewer_continuity_verified','synthetic_merchant_acceptance_authorized',
    'hosted_test_reconstruction_authorized','production_cutover_authorized'])
    assert.equal(result[key],false,key);
});
test('historical Auth identity set is immutable and exact Test identity is required',()=>{
 for(const change of [
   x=>x.pre.project_ref='eujxswjspolugrzlsjnn',
   x=>x.post.project_ref='eujxswjspolugrzlsjnn',
   x=>x.post.cohort.historical_users=4,
   x=>x.post.cohort.identity_set_sha256='c'.repeat(64),
   x=>x.pre.cohort.identity_set_sha256='not-a-digest',
   x=>x.post.reviewed_source_sha='c'.repeat(40),
   x=>x.pre.cohort.email='do-not-include@example.com',
   x=>x.post.jwt='do-not-include-token',
   x=>x.post.purpose='historic-recovery-complete',
   x=>x.post.schema_version=2]){
    const f=fixture();change(f);
    assert.equal(assess(f).sql_authority_link_quarantine_evidence_consistent,false);
 }
 assert.equal(assessPostCanonicalAuthQuarantine(null,null,{sourceSha:SHA,now}).sql_authority_link_quarantine_evidence_consistent,false);
});
test('every old-user authority path fails with even one leftover grant',()=>{
 for(const k of HISTORIC_AUTH_LINK_CATEGORIES){
   const f=fixture();f.post.grants[k]=1;
   const result=assess(f);
   assert.equal(result.sql_authority_link_quarantine_evidence_consistent,false,k);
   assert.match(result.reasons.join(' '),/Historical Auth cohort/);
   const g=fixture();delete g.post.grants[k];
   assert.equal(assess(g).sql_authority_link_quarantine_evidence_consistent,false,k);
 }
});
test('positive controls prevent vacuous empty-database passing',()=>{
 for(const [key,value] of [['applied_migrations',456],['new_auth_users',0],
  ['new_business_members',0],['businesses_present',0],['new_auth_users','2']]){
  const f=fixture();f.post.canonical[key]=value;
  assert.equal(assess(f).sql_authority_link_quarantine_evidence_consistent,false,key);
 }
});
test('fresh post snapshot must follow exact baseline cutoff, no future or stale snapshots',()=>{
 for(const change of [x=>x.post.historical_cutoff_utc='2026-11-11T19:59:59Z',
   x=>x.post.captured_at_utc='2026-11-11T20:00:00Z',
   x=>x.post.captured_at_utc='2026-11-11T22:14:59Z',
   x=>x.post.captured_at_utc='2026-11-11T22:26:00Z',
   x=>x.pre.captured_at_utc='2026-10-31T00:00:00Z',
   x=>x.pre.captured_at_utc='invalid']){
    const f=fixture();change(f);
    assert.equal(assess(f).sql_authority_link_quarantine_evidence_consistent,false);
 }
});
test('no private path or identity fingerprint can leak on invalid CLI input',()=>{
 const script=new URL('./oa5-test-post-canonical-auth-quarantine.mjs',import.meta.url).pathname;
 const secret='/some-private-merchant-file-with-identifier.json';
 const p=spawnSync(process.execPath,[script,'--check',secret,secret],{encoding:'utf8'});
 assert.equal(p.status,1);
 assert.match(p.stderr,/BLOCKED/);
 assert.equal(p.stderr.includes(secret),false);
});

