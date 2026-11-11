#!/usr/bin/env node
/**
 * OA5 — pre-rebuild, read-only historical Test Auth authority census.
 * Consumes only private aggregate counts. NEVER reads user IDs, email, SQL
 * bodies, session tokens or tenant rows; does not contact Supabase or mutate.
 * A PASS means the archived Test grant topology has not drifted; it is NOT
 * proof those historical users have been quarantined on a new schema.
 */
import {readFileSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const TEST_PROJECT='iukgsukdoowvnhlfmpml';
export const BEFORE_REBUILD='historic-test-auth-authority-before-rebuild';
export const HISTORICAL_BASELINE=Object.freeze({
  auth_users:5,
  auth_sessions:6,
  tenant_members:3,
  member_auth_users:3,
  member_rows_without_auth_user:0,
  branch_user_access:0,
  branch_access_auth_users:0,
  active_branch_access:0,
  platform_admins:3,
  platform_admin_users_matching_auth:3,
  admin_capability_grants:0,
  member_capability_rows:0,
  businesses:3,
  branches:3,
  historic_agreement_rows:5,
  historical_migration_versions:54
});
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join('|')===[...keys].sort().join('|');
const TIME_WINDOW_MS=10*60*1000;
export function assessHistoricalTestAuthLineage(s,now=new Date()) {
  const reasons=[];
  const make=()=>({
    historical_baseline_consistent:reasons.length===0,
    historical_auth_membership_authority_present:true,
    historical_users_quarantined_in_canonical_schema:false,
    historical_reviewer_access_verified:false,
    hosted_cleanup_authorized:false,
    destructive_execution_authorized:false,
    reasons
  });
  if(!exact(s,['schema_version','project_ref','purpose','captured_at_utc','counts'])){
    reasons.push('Missing or overbroad Test-only historic Auth lineage census');
    return make();
  }
  if(s.schema_version!==1||s.project_ref!==TEST_PROJECT||s.purpose!==BEFORE_REBUILD)
    reasons.push('Wrong Test project, purpose or snapshot format');
  const ts=typeof s.captured_at_utc==='string'&&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s.captured_at_utc)
    ? Date.parse(s.captured_at_utc):NaN;
  if(!Number.isFinite(ts)||ts>now.getTime()||now.getTime()-ts>TIME_WINDOW_MS)
    reasons.push('Historical authority census is future-dated or older than ten minutes');
  if(!exact(s.counts,Object.keys(HISTORICAL_BASELINE))) {
    reasons.push('Missing or extra historical Auth/merchant grant count category');
    return make();
  }
  for(const [key,expected] of Object.entries(HISTORICAL_BASELINE)){
    const found=s.counts[key];
    if(!Number.isSafeInteger(found)||found<0)
      reasons.push('Missing or invalid count: '+key);
    else if(found!==expected)
      reasons.push('Historical Test authority or archive dataset drift: '+key);
  }
  // A historical membership/admin row must not be mistaken for a canonical
  // permission grant; snapshot is *before*, not after, any cleanup.
  return make();
}
function main(){
  if(process.argv.length!==4||process.argv[2]!=='--check'){
    console.error('Usage: node scripts/qa/oa5-test-historical-auth-lineage.mjs --check <protected-count-only-Test-snapshot.json>');
    process.exitCode=2;return;
  }
  let s;
  try{
    const file=resolve(process.argv[3]),stat=lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32768)throw Error('unsafe');
    s=JSON.parse(readFileSync(file,'utf8'));
  }catch{
    console.error('BLOCKED: private count-only Test authority census missing or unsafe');
    process.exitCode=1;return;
  }
  const result=assessHistoricalTestAuthLineage(s);
  console.log(JSON.stringify(result,null,2));
  if(!result.historical_baseline_consistent)process.exitCode=1;
  console.log('NOT VERIFIED: historical users remain authorized in historic Test; canonical quarantine and reviewer continuity are not proven.');
  console.log('NOT AUTHORIZED: no Test cleanup, Auth deletion, cron pause or Production operation.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
