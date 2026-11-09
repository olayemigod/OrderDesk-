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
export function assessTestLiveCensus(s,now=new Date()){
  const reasons=[],drift=[];
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
      reasons.push('Post-archive Test state changed: '+key+' (archive '+baseline+' vs current '+n+')');
    }
  }
  return {ok:reasons.length===0,may_reset:false,reasons,drift};
}
function main(){
  if(process.argv.length!==4||process.argv[2]!=='--check'){
    console.error('Usage: node scripts/qa/oa5-test-live-census.mjs --check <private-Test-counts.json>');
    process.exitCode=2;return;
  }
  let s;
  try{s=JSON.parse(readFileSync(resolve(process.argv[3]),'utf8'));}
  catch{console.error('BLOCKED: no private Test-only count inventory');process.exitCode=1;return;}
  const result=assessTestLiveCensus(s);
  if(!result.ok){
    console.error('BLOCKED: Test state diverges from the independently restored archive.');
    for(const reason of result.reasons)console.error(' - '+reason);
    process.exitCode=1;return;
  }
  console.log('PASS: fresh Test counts match the preserved archive; no reset authorization.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
