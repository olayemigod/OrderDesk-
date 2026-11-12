#!/usr/bin/env node
// Offline Test-only count reconciliation: never reads identifiers or makes network calls.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const TEST_REF='iukgsukdoowvnhlfmpml';
export const ARCHIVED_COUNTS=Object.freeze({
  auth_users:5,auth_sessions:5,public_tables:132,public_functions:479,
  migration_rows:54,storage_buckets:3,storage_objects:0,
});
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
  Object.keys(x).sort().join('|')===[...keys].sort().join('|');
export const REVIEWED_SESSION_LOSS_SCOPE='one-post-archive-test-auth-session';
export function assessTestLiveCensus(s,now=new Date(),approvedLoss=null){
  const reasons=[],drift=[];
  let acceptedSessionLoss=false;
  if(approvedLoss!==null){
    const complete=exact(approvedLoss,[
      'schema_version','project_ref','scope','archive_auth_sessions',
      'current_auth_sessions','approved_loss','reviewed_at_utc','evidence_ref'
    ]);
    const stamp=complete&&typeof approvedLoss.reviewed_at_utc==='string'&&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(approvedLoss.reviewed_at_utc)
      ?Date.parse(approvedLoss.reviewed_at_utc):NaN;
    const captured=typeof s?.captured_at_utc==='string'&&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(s.captured_at_utc)
      ?Date.parse(s.captured_at_utc):NaN;
    // Exact, explicitly reviewed one-session loss. Never any general drift waiver.
    acceptedSessionLoss=complete&&approvedLoss.schema_version===1&&
      approvedLoss.project_ref===TEST_REF&&s?.project_ref===TEST_REF&&
      approvedLoss.scope===REVIEWED_SESSION_LOSS_SCOPE&&
      approvedLoss.archive_auth_sessions===ARCHIVED_COUNTS.auth_sessions&&
      approvedLoss.current_auth_sessions===6&&s?.counts?.auth_sessions===6&&
      approvedLoss.approved_loss===true&&
      typeof approvedLoss.evidence_ref==='string'&&
      /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$/.test(approvedLoss.evidence_ref)&&
      Number.isFinite(stamp)&&Number.isFinite(captured)&&
      stamp>=captured&&stamp<=now.getTime()&&now.getTime()-stamp<=600000;
    if(!acceptedSessionLoss)
      reasons.push('Unreviewed or invalid private approval for precise post-archive Test Auth session loss');
  }
  if(!exact(s,['schema_version','project_ref','captured_at_utc','counts']))
    return {ok:false,may_reset:false,reasons:['Missing or excessive Test-only count evidence'],drift};
  if(s.schema_version!==1||s.project_ref!==TEST_REF)reasons.push('Wrong Test project/schema');
  const when=typeof s.captured_at_utc==='string'&&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(s.captured_at_utc)
    ?Date.parse(s.captured_at_utc):NaN;
  if(!Number.isFinite(when)||when>now.getTime()||now.getTime()-when>600000)
    reasons.push('Count inventory is missing, future-dated or older than 10 minutes');
  if(!exact(s.counts,Object.keys(ARCHIVED_COUNTS)))
    reasons.push('Incomplete or overbroad Test counts');
  for(const [key,baseline] of Object.entries(ARCHIVED_COUNTS)){
    const n=s.counts?.[key];
    if(!Number.isSafeInteger(n)||n<0){reasons.push('Missing/invalid count: '+key);continue;}
    if(n!==baseline){
      drift.push({category:key,archive_count:baseline,current_count:n});
      if(!(key==='auth_sessions'&&n===6&&acceptedSessionLoss))
        reasons.push('Post-archive Test state changed: '+key+' (archive '+baseline+' vs current '+n+')');
    }
  }
  return {ok:reasons.length===0,may_reset:false,reasons,drift,
    reviewed_session_loss_accepted:acceptedSessionLoss&&drift.length===1&&
      drift[0].category==='auth_sessions'&&drift[0].current_count===6};
}
function main(){
  if((process.argv.length!==4&&process.argv.length!==5)||process.argv[2]!=='--check'){
    console.error('Usage: node scripts/qa/oa5-test-live-census.mjs --check <private-Test-counts.json> [private-reviewed-session-loss.json]');
    process.exitCode=2;return;
  }
  let s,approvedLoss=null;
  try{
    s=JSON.parse(readFileSync(resolve(process.argv[3]),'utf8'));
    if(process.argv[4])approvedLoss=JSON.parse(readFileSync(resolve(process.argv[4]),'utf8'));
  }
  catch{console.error('BLOCKED: no private Test-only count inventory');process.exitCode=1;return;}
  const result=assessTestLiveCensus(s,new Date(),approvedLoss);
  if(!result.ok){
    console.error('BLOCKED: Test state diverges from the independently restored archive.');
    for(const reason of result.reasons)console.error(' - '+reason);
    process.exitCode=1;return;
  }
  console.log(result.reviewed_session_loss_accepted
    ?'PASS: exact one-session Test-only loss privately reviewed; original archive baseline unchanged.'
    :'PASS: fresh Test count inventory matches the archived counts.');
  console.log('NOT AUTHORIZED: no cron pause or destructive Test reset may be inferred.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
