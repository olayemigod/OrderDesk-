#!/usr/bin/env node
/**
 * Offline-only pre-reset pg_cron maintenance guard. This validates a recent,
 * Test-only, READ-ONLY inventory snapshot. It cannot pause a job, inspect
 * provider dashboards or authorize a destructive Test rebuild.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const TEST_PROJECT='iukgsukdoowvnhlfmpml';
export const EXPECTED_JOBS=Object.freeze([
  Object.freeze({jobid:1,jobname:'sellertray-prepare-usage-settlements',schedule:'15 1 * * *',command_sha256:'19adca9347f95ae6df6caaf31f45b2c7a2a102375aaa44227456ddea992ebaac'}),
  Object.freeze({jobid:2,jobname:'sellertray-whatsapp-notification-retry',schedule:'* * * * *',command_sha256:'5271a0ecf65418ef0943a49e187a79c7c66733f2418e5c4c067342f5073fc3be'}),
  Object.freeze({jobid:3,jobname:'sellertray-merchant-push-retry',schedule:'* * * * *',command_sha256:'9415cef3fdd4acc626406791c201d275fb49fe3ac89d0f4dbee3218fb49aeb37'}),
  Object.freeze({jobid:4,jobname:'sellertray-agreement-package-retry',schedule:'* * * * *',command_sha256:'280ed1badf510aceee14117efad11d008fa0b4eaf589d9721650970077c5bc36'}),
]);
const FRESH_MS=10*60*1000;

export function assessCronMaintenance(snapshot, now=new Date()) {
  const reasons=[];
  if (!snapshot || typeof snapshot!=='object' || Array.isArray(snapshot)) {
    return {ok:false,reasons:['Missing valid Test cron snapshot']};
  }
  if(snapshot.schema_version!==1 || snapshot.project_ref!==TEST_PROJECT)
    reasons.push('Wrong or unknown Test project identity');
  const captured=snapshot.captured_at_utc;
  const ts=typeof captured==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(captured)?Date.parse(captured):NaN;
  if(!Number.isFinite(ts) || ts>now.getTime() || now.getTime()-ts>FRESH_MS)
    reasons.push('Snapshot missing, from future, or older than ten minutes');
  const jobs=snapshot.jobs;
  if(!Array.isArray(jobs) || jobs.length!==EXPECTED_JOBS.length)
    reasons.push('Unexpected number of scheduled jobs (expected exactly four)');
  const present=new Map();
  for(const j of Array.isArray(jobs)?jobs:[]){
    if(!j || typeof j!=='object' || typeof j.jobname!=='string' || present.has(j.jobname)){
      reasons.push('Malformed or duplicate scheduled job');continue;
    }
    present.set(j.jobname,j);
  }
  for(const spec of EXPECTED_JOBS){
    const j=present.get(spec.jobname);
    if(!j){reasons.push('Missing expected job '+spec.jobname);continue;}
    if(j.jobid!==spec.jobid || j.schedule!==spec.schedule || j.command_sha256!==spec.command_sha256)
      reasons.push('Job ID, schedule or command fingerprint drift: '+spec.jobname);
    if(j.active!==false) reasons.push('Scheduled job still active: '+spec.jobname);
    if(!Number.isSafeInteger(j.unfinished_runs) || j.unfinished_runs!==0)
      reasons.push('Job has unfinished or unknown runs: '+spec.jobname);
  }
  for(const name of present.keys()) if(!EXPECTED_JOBS.some(s=>s.jobname===name))
    reasons.push('Unreviewed scheduled job exists: '+name);
  if(snapshot.all_jobs_count!==EXPECTED_JOBS.length)
    reasons.push('All-job census missing or inconsistent');
  // Passing checks only the observed database cron precondition.
  // It NEVER approves destructive operations, provider secrets or callbacks.
  return {ok:reasons.length===0,reasons};
}

function main(){
  if(process.argv.length!==4 || process.argv[2]!=='--check'){
    console.error('Usage: node scripts/qa/oa5-test-cron-maintenance-gate.mjs --check <protected-readonly-test-snapshot.json>');
    process.exitCode=2;return;
  }
  let snapshot;
  try {snapshot=JSON.parse(readFileSync(resolve(process.argv[3]),'utf8'));}
  catch {console.error('BLOCKED: Test cron snapshot missing or invalid');process.exitCode=1;return;}
  const result=assessCronMaintenance(snapshot);
  if(!result.ok){
    console.error('BLOCKED: Test cron has not met maintenance quiescence prerequisites:');
    for(const reason of result.reasons) console.error(' - '+reason);
    process.exitCode=1;return;
  }
  console.log('Test cron snapshot meets only the offline scheduled-job precondition.');
  console.log('NOT a Test reset approval or proof of provider/callback quiescence.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
