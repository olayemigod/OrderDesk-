#!/usr/bin/env node
/**
 * OA5 standalone Test: read-only PRE-PAUSE candidate identity and quiescence.
 * Uses an independently captured private JSON snapshot. No network/API/SQL
 * execution, cron mutation or authorization, regardless of a passing result.
 * The mandatory *post-pause* v2 cron+pg_net guard is separate and unchanged.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPECTED_JOBS, TEST_PROJECT } from './oa5-test-cron-maintenance-gate.mjs';

export const PURPOSE='pre-pause-readonly-candidate';
const FRESH_MS=10*60*1000;
const exact=(obj,keys)=>obj!==null&&typeof obj==='object'&&!Array.isArray(obj)&&
 Object.keys(obj).sort().join('|')===[...keys].sort().join('|');

export function assessTestCronFreezeCandidate(snapshot,now=new Date()){
 const reasons=[];
 const result=()=>({
   candidate_identity_consistent:reasons.length===0,
   cron_pause_authorized:false,
   post_pause_quiescence_verified:false,
   destructive_execution_authorized:false,
   reasons
 });
 if(!exact(snapshot,['schema_version','project_ref','purpose','captured_at_utc',
                        'all_jobs_count','pending_pg_net_http_requests','jobs'])){
  reasons.push('Missing, secret-bearing or overbroad Test pre-pause job inventory');
  return result();
 }
 if(snapshot.schema_version!==1||snapshot.project_ref!==TEST_PROJECT||snapshot.purpose!==PURPOSE)
  reasons.push('Incorrect Test project, inventory schema or read-only purpose');
 const ts=typeof snapshot.captured_at_utc==='string'&&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(snapshot.captured_at_utc)
  ?Date.parse(snapshot.captured_at_utc):NaN;
 if(!Number.isFinite(ts)||ts>now.getTime()||now.getTime()-ts>FRESH_MS)
  reasons.push('Pre-pause inventory is missing, future-dated or over ten minutes old');
 if(snapshot.all_jobs_count!==EXPECTED_JOBS.length)
  reasons.push('Unexpected total cron job count');
 if(snapshot.pending_pg_net_http_requests!==0)
  reasons.push('Unknown or queued pg_net HTTP work; cannot assert pre-pause quiescence');
 if(!Array.isArray(snapshot.jobs)||snapshot.jobs.length!==EXPECTED_JOBS.length){
  reasons.push('Missing, incomplete or expanded Test cron job roster');
  return result();
 }
 const found=new Set();
 for(const j of snapshot.jobs){
  if(!exact(j,['jobid','jobname','schedule','command_sha256','active',
                'unfinished_runs','running_runs'])){
   reasons.push('Unexpected or secret-bearing cron job field');continue;
  }
  const expected=EXPECTED_JOBS.find(x=>x.jobid===j.jobid&&x.jobname===j.jobname);
  if(!expected||found.has(j.jobid)){
   reasons.push('Unknown or duplicate cron job identity');continue;
  }
  found.add(j.jobid);
  if(j.schedule!==expected.schedule||j.command_sha256!==expected.command_sha256)
   reasons.push('Cron schedule/command fingerprint changed: '+j.jobname);
  if(j.active!==true)reasons.push('Pre-pause snapshot must describe active job: '+j.jobname);
  if(!Number.isSafeInteger(j.unfinished_runs)||j.unfinished_runs!==0||
     !Number.isSafeInteger(j.running_runs)||j.running_runs!==0)
   reasons.push('Cron job has unfinished/running or unknown historic work: '+j.jobname);
 }
 if(found.size!==EXPECTED_JOBS.length)
  reasons.push('Unreviewed or missing expected cron job identity');
 return result();
}

function main(){
 if(process.argv.length!==4||process.argv[2]!=='--check'){
  console.error('Usage: node scripts/qa/oa5-test-cron-freeze-candidate.mjs --check <private-Test-pre-pause-census.json>');
  process.exitCode=2;return;
 }
 let snapshot;
 try{snapshot=JSON.parse(readFileSync(resolve(process.argv[3]),'utf8'));}
 catch{
  console.error('BLOCKED: missing/invalid private Test pre-pause cron census');
  process.exitCode=1;return;
 }
 const out=assessTestCronFreezeCandidate(snapshot);
 if(!out.candidate_identity_consistent){
  console.error('BLOCKED: Test cron freeze candidate drift or evidence failure');
  for(const reason of out.reasons)console.error(' - '+reason);
  process.exitCode=1;return;
 }
 console.log('PASS: fresh Test-only PRE-pause job fingerprints and zero-work census match known historical snapshot.');
 console.log('NOT AUTHORIZED: never pause, unschedule, delete, reset or reactivate jobs from this check.');
 console.log('NOT VERIFIED: provider isolation, live callback sinks, or the required separate post-pause quiescence and approval.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
