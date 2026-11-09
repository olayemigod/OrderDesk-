import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {assessCronMaintenance,EXPECTED_JOBS,TEST_PROJECT} from './oa5-test-cron-maintenance-gate.mjs';

const now=new Date('2026-11-09T12:00:00Z');
const safe=()=>({schema_version:2,project_ref:TEST_PROJECT,captured_at_utc:'2026-11-09T11:59:00Z',all_jobs_count:4,pending_pg_net_http_requests:0,jobs:EXPECTED_JOBS.map(j=>({...j,active:false,unfinished_runs:0}))});
test('reports only maintenance precondition when an exact recent Test snapshot is paused',()=>{
  assert.deepEqual(assessCronMaintenance(safe(),now),{ok:true,reasons:[]});
});
test('fails closed for missing, wrong project or malformed census',()=>{
  for(const snapshot of [null,{}, {...safe(),project_ref:'eujxswjspolugrzlsjnn'}, {...safe(),schema_version:1}, {...safe(),jobs:[]}, {...safe(),all_jobs_count:5}])
    assert.equal(assessCronMaintenance(snapshot,now).ok,false);
});
test('rejects stale/future/bad timestamp and does not trust an operator clock hint',()=>{
  for(const at of ['2026-11-09T11:49:00Z','2026-11-09T12:00:01Z','2026-11-09T11:59:00+00:00','not-a-date',null])
    assert.equal(assessCronMaintenance({...safe(),captured_at_utc:at},now).ok,false);
});
test('every active job blocks Test maintenance, including daily and minutely jobs',()=>{
  for(let i=0;i<EXPECTED_JOBS.length;i++){
    const s=safe();s.jobs[i].active=true;
    assert.match(assessCronMaintenance(s,now).reasons.join('\n'),/still active/);
  }
});
test('unfinished or unknown running jobs block even if every schedule is paused',()=>{
  for(const value of [1,3,undefined,-1,'0']){
    const s=safe();s.jobs[2].unfinished_runs=value;
    assert.match(assessCronMaintenance(s,now).reasons.join('\n'),/unfinished or unknown/);
  }
});
test('rejects job command changes, job IDs, schedule edits and duplicates',()=>{
  for(const change of [j=>{j.command_sha256='a'.repeat(64);}, j=>{j.jobid=5;},j=>{j.schedule='*/2 * * * *';},j=>{j.jobname='bogus';}]){
    const s=safe();change(s.jobs[0]);assert.equal(assessCronMaintenance(s,now).ok,false);
  }
  const s=safe();s.jobs[0]={...s.jobs[1]};assert.equal(assessCronMaintenance(s,now).ok,false);
});
test('rejects unknown fifth job even if deactivated',()=>{
  const s=safe();s.jobs.push({...s.jobs[0],jobname:'unreviewed',jobid:8});s.all_jobs_count=5;
  assert.equal(assessCronMaintenance(s,now).ok,false);
});
test('CLI refuses missing snapshot without secrets, network or mutation',()=>{
  const dir=mkdtempSync(join(tmpdir(),'oa5-cron-gate-'));
  try{
    const file=join(dir,'snapshot.json');writeFileSync(file,JSON.stringify({...safe(),jobs:safe().jobs.map(j=>({...j,active:true}))}));
    const run=spawnSync(process.execPath,[new URL('./oa5-test-cron-maintenance-gate.mjs',import.meta.url).pathname,'--check',file],{encoding:'utf8'});
    assert.equal(run.status,1);
    assert.match(run.stderr,/BLOCKED/);
    assert.doesNotMatch(run.stderr,/sk_live_|service_role/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('rejects asynchronous pg_net queued work and unavailable queue census, even if cron is paused',()=>{
  for(const pending of [1,7,null,undefined,-1,'0',0.25]){
    const s=safe();s.pending_pg_net_http_requests=pending;
    assert.match(assessCronMaintenance(s,now).reasons.join('\\n'),/pg_net HTTP request queue/);
  }
});

test('v1 cron-only snapshots cannot claim outbound HTTP quiescence',()=>{
 const s=safe();delete s.pending_pg_net_http_requests;s.schema_version=1;
 assert.equal(assessCronMaintenance(s,now).ok,false);
});
