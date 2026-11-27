#!/usr/bin/env node
/**
 * OA5 Method B — OFFLINE, read-only, Test-only Auth session provenance guard.
 * The historical Auth accounts and sessions are RETAINED, not deleted.
 * This evaluates only an aggregate private snapshot from the Test database.
 * It NEVER calls Supabase, manipulates sessions, authorizes a database reset,
 * asserts inherited business privileges are gone, or prints fingerprints.
 */
import {lstatSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const TEST_REF='iukgsukdoowvnhlfmpml';
export const PURPOSE='method-b-retained-auth-session-provenance';
export const ARCHIVE_DAY_END='2026-11-08T00:00:00Z';
export const COUNTS=Object.freeze({
 auth_user_count:5,
 historical_user_count:5,
 total_sessions:7,
 pre_cutoff_sessions:5,
 post_cutoff_sessions:2,
 post_cutoff_historical_user_sessions:2,
 post_cutoff_unrecognized_user_sessions:0,
 post_cutoff_admin_sessions:2,
 post_cutoff_member_sessions:2,
 refresh_tokens:22,
 orphan_sessions:0,
 tenant_memberships:3,
 platform_admin_assignments:3,
 historical_migration_versions:54,
 historical_agreement_packages:5,
 active_jobs:0,
 queued_http:0
});
const TIME_WINDOW_MS=10*60*1000;
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).sort().join('|')===[...keys].sort().join('|');
const hex64=(v)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const ts=(v)=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(v)?Date.parse(v):NaN;

export function assessMethodBRetainedAuthSessionCensus(snapshot, now=new Date()){
 const reasons=[];
 const report=()=>({
  observed_retained_auth_session_provenance_consistent:reasons.length===0,
  archive_user_and_session_id_parity_verified:false,
  historic_privileged_actor_denial_verified:false,
  existing_jwt_and_refresh_token_safety_verified:false,
  provider_ingress_egress_quiescence_verified:false,
  hosted_test_reconstruction_authorized:false,
  auth_deletion_or_session_revocation_authorized:false,
  production_change_authorized:false,
  reasons
 });
 if(!exact(snapshot,['schema_version','project_ref','purpose','captured_at_utc',
                       'archive_day_end_utc','counts','identity_fingerprints'])){
  reasons.push('Missing, extra or private identity-bearing Test Auth snapshot fields');return report();
 }
 if(snapshot.schema_version!==1||snapshot.project_ref!==TEST_REF||snapshot.purpose!==PURPOSE||
    snapshot.archive_day_end_utc!==ARCHIVE_DAY_END)
  reasons.push('Incorrect isolated Test project, purpose or known archive boundary');
 const at=ts(snapshot.captured_at_utc), n=now instanceof Date?now.getTime():NaN;
 if(!Number.isFinite(n)||!Number.isFinite(at)||at>n||n-at>TIME_WINDOW_MS)
  reasons.push('Test Auth provenance snapshot stale, future-dated or invalid');
 if(!exact(snapshot.counts,Object.keys(COUNTS))){
  reasons.push('Historical Auth, authority, cron and Agreement counts incomplete or overbroad');
 }else{
  for(const [k,expected] of Object.entries(COUNTS)){
   const count=snapshot.counts[k];
   if(!Number.isSafeInteger(count)||count!==expected)
    reasons.push('Test Auth/merchant/session provenance drift: '+k);
  }
  const c=snapshot.counts;
  if(c.pre_cutoff_sessions+c.post_cutoff_sessions!==c.total_sessions||
     c.post_cutoff_historical_user_sessions+c.post_cutoff_unrecognized_user_sessions!==c.post_cutoff_sessions)
    reasons.push('Historical versus additional session counts are not a partition');
 }
 if(!exact(snapshot.identity_fingerprints,[
    'historical_user_set_sha256','pre_cutoff_session_set_sha256','all_session_set_sha256'
  ])||Object.values(snapshot.identity_fingerprints||{}).some(x=>!hex64(x)))
   reasons.push('Private Auth cohort/session fingerprints missing or invalid');
 // This validates *today's captured state*, NOT the encrypted archive's
 // individual IDs or external provider and old JWT safety.
 return report();
}

function main(){
 if(process.argv.length!==4||process.argv[2]!=='--check'){
  console.error('Usage: node scripts/qa/oa5-method-b-retained-auth-session-census.mjs --check <private-readonly-Test-snapshot.json>');
  process.exitCode=2;return;
 }
 let snap;
 try{
  const path=resolve(process.argv[3]),stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32768)throw Error('unsafe');
  snap=JSON.parse(readFileSync(path,'utf8'));
 }catch{
  console.error('BLOCKED: protected Test Auth session census missing or unsafe');
  process.exitCode=1;return;
 }
 const result=assessMethodBRetainedAuthSessionCensus(snap);
 if(!result.observed_retained_auth_session_provenance_consistent){
  console.error('BLOCKED: Test Method B retained-session provenance cannot be reconciled');
  for(const reason of result.reasons)console.error(' - '+reason);
  process.exitCode=1;return;
 }
 console.log('PASS: exact current Test Auth/session/authority counts and private fingerprints have valid shape.');
 console.log('NOT VERIFIED: archived individual IDs, privileged actor denial, external provider containment or old JWT safety.');
 console.log('NOT AUTHORIZED: no Auth deletion, session revocation, remote Test reset, migration, provider change, APK or Production change.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
