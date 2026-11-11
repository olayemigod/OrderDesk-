#!/usr/bin/env node
/**
 * OA5: OFFLINE and count/fingerprint-only Test Auth cohort quarantine gate.
 * It processes private Supabase SELECT snapshots, never connects, mutates,
 * logs identities, exposes fingerprints, or authorizes a hosted operation.
 * A clean SQL link census is not authenticated actor/RLS/API acceptance.
 */
import {lstatSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const TEST_REF='iukgsukdoowvnhlfmpml';
export const PRE_PURPOSE='pre-rebuild-historical-auth-cohort';
export const POST_PURPOSE='post-canonical-historical-auth-cohort';
export const EXPECTED_HISTORIC_USERS=5;
export const EXPECTED_CANONICAL_MIGRATIONS=457;
export const HISTORIC_AUTH_LINK_CATEGORIES=Object.freeze([
  'tenant_member_grants',
  'branch_user_access_grants',
  'tenant_member_capability_grants',
  'platform_admin_grants',
  'platform_admin_capability_grants',
  'setup_installer_staff_links',
  'setup_installer_assignment_links',
  'setup_invitation_auth_or_email_links'
]);
const EXACT=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  Object.keys(x).sort().join('|')===[...keys].sort().join('|');
const HEX64=(x)=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const SHA=(x)=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const ISO=(x)=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(x)
  ? Date.parse(x):NaN;
const SAFE_NAT=(n)=>Number.isSafeInteger(n)&&n>=0;
export function assessPostCanonicalAuthQuarantine(pre,post,{sourceSha,now=new Date()}={}){
  const reasons=[];
  const report=()=>({
    sql_authority_link_quarantine_evidence_consistent:reasons.length===0,
    authenticated_historical_actor_rls_test_verified:false,
    old_jwt_session_revocation_verified:false,
    provider_callback_isolation_verified:false,
    historical_preview_reviewer_continuity_verified:false,
    synthetic_merchant_acceptance_authorized:false,
    hosted_test_reconstruction_authorized:false,
    production_cutover_authorized:false,
    reasons
  });
  if(!EXACT(pre,['schema_version','project_ref','purpose','captured_at_utc','cohort'])||
     !EXACT(post,['schema_version','project_ref','purpose','captured_at_utc',
       'historical_cutoff_utc','reviewed_source_sha','cohort','grants','canonical'])){
    reasons.push('Private before/after historical Auth cohort snapshots missing or overbroad');
    return report();
  }
  if(pre.schema_version!==1||post.schema_version!==1||
     pre.project_ref!==TEST_REF||post.project_ref!==TEST_REF||
     pre.purpose!==PRE_PURPOSE||post.purpose!==POST_PURPOSE)
    reasons.push('Source snapshots do not describe the same isolated Test project and stage');
  const tPre=ISO(pre.captured_at_utc),tPost=ISO(post.captured_at_utc);
  const present=now instanceof Date?now.getTime():NaN;
  if(!Number.isFinite(tPre)||!Number.isFinite(tPost)||
     !Number.isFinite(present)||tPre>=tPost||
     tPost>present||present-tPost>10*60*1000||
     tPost-tPre>72*60*60*1000||post.historical_cutoff_utc!==pre.captured_at_utc)
    reasons.push('Cohort snapshot order, exact cutoff, seventy-two-hour window or ten-minute freshness failed');
  if(!EXACT(pre.cohort,['historical_users','identity_set_sha256'])||
     !EXACT(post.cohort,['historical_users','identity_set_sha256'])||
     pre.cohort?.historical_users!==EXPECTED_HISTORIC_USERS||
     post.cohort?.historical_users!==EXPECTED_HISTORIC_USERS||
     !HEX64(pre.cohort?.identity_set_sha256)||
     pre.cohort?.identity_set_sha256!==post.cohort?.identity_set_sha256)
    reasons.push('The five original Auth identities are not all retained and exactly matched across snapshots');
  if(!SHA(sourceSha)||post.reviewed_source_sha!==sourceSha)
    reasons.push('Post-rebuild canonical source SHA differs from the exact reviewed checkout');
  if(!EXACT(post.grants,HISTORIC_AUTH_LINK_CATEGORIES)){
    reasons.push('All eight historical identity authorization paths must be measured');
  } else {
    for(const category of HISTORIC_AUTH_LINK_CATEGORIES){
      if(post.grants[category]!==0)
        reasons.push('Historical Auth cohort still linked to canonical authority: '+category);
    }
  }
  if(!EXACT(post.canonical,['applied_migrations','new_auth_users','new_business_members','businesses_present'])||
     post.canonical?.applied_migrations!==EXPECTED_CANONICAL_MIGRATIONS||
     !SAFE_NAT(post.canonical?.new_auth_users)||post.canonical.new_auth_users<1||
     !SAFE_NAT(post.canonical?.new_business_members)||post.canonical.new_business_members<1||
     !SAFE_NAT(post.canonical?.businesses_present)||post.canonical.businesses_present<1)
    reasons.push('Clean canonical migration ledger and synthetic-merchant positive controls are missing');
  return report();
}
function privateJson(path){
  const f=resolve(path),s=lstatSync(f);
  if(!s.isFile()||s.isSymbolicLink()||s.size>32768)throw Error('unsafe');
  return JSON.parse(readFileSync(f,'utf8'));
}
function main(){
  if(process.argv.length!==5||process.argv[2]!=='--check'){
    console.error('Usage: node scripts/qa/oa5-test-post-canonical-auth-quarantine.mjs --check <private-pre-cohort.json> <private-post-cohort.json>');
    process.exitCode=2;return;
  }
  let pre,post,sourceSha;
  try{
    pre=privateJson(process.argv[3]);post=privateJson(process.argv[4]);
    sourceSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',timeout:10000}).trim();
  }catch{
    console.error('BLOCKED: protected cohort files or exact local Git identity unavailable');
    process.exitCode=1;return;
  }
  const r=assessPostCanonicalAuthQuarantine(pre,post,{sourceSha});
  console.log(JSON.stringify(r,null,2));
  if(!r.sql_authority_link_quarantine_evidence_consistent)process.exitCode=1;
  console.log('NOT VERIFIED: real historical JWTs, RLS/Edge actor-level behavior, session revocation, reviewer access or provider isolation.');
  console.log('NOT AUTHORIZED: no hosted cleanup, Auth deletion, cron pause, merchant QA activation or Production cutover.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();

