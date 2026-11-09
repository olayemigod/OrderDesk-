import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {EXPECTED_JOBS,TEST_PROJECT,assessCronMaintenance} from './oa5-test-cron-maintenance-gate.mjs';
import {PURPOSE,assessTestCronFreezeCandidate} from './oa5-test-cron-freeze-candidate.mjs';
const now=new Date('2026-11-09T21:25:00Z');
const fresh=()=>({
 schema_version:1,project_ref:TEST_PROJECT,purpose:PURPOSE,
 captured_at_utc:'2026-11-09T21:24:30Z',
 all_jobs_count:4,pending_pg_net_http_requests:0,
 jobs:EXPECTED_JOBS.map(j=>({...j,active:true,unfinished_runs:0,running_runs:0}))
});
test('pre-pause fingerprints match but NEVER authorize cron mutation or Test reset',()=>{
 const r=assessTestCronFreezeCandidate(fresh(),now);
 assert.equal(r.candidate_identity_consistent,true);
 assert.equal(r.cron_pause_authorized,false);
 assert.equal(r.post_pause_quiescence_verified,false);
 assert.equal(r.destructive_execution_authorized,false);
});
test('passing pre-pause census cannot substitute for mandatory post-pause guard',()=>{
 const candidate=fresh();
 assert.equal(assessTestCronFreezeCandidate(candidate,now).candidate_identity_consistent,true);
 const post={...candidate,schema_version:2};
 delete post.purpose;
 post.jobs=post.jobs.map(({running_runs,...j})=>j);
 assert.equal(assessCronMaintenance(post,now).ok,false);
});
test('all unknown, production and malformed project/purpose/schema fail closed',()=>{
 for(const mutate of [
  x=>x.project_ref='eujxswjspolugrzlsjnn',
  x=>x.project_ref='test',
  x=>x.purpose='approve-pause',
  x=>x.schema_version=2,
  x=>x.secret='do-not-commit',
  x=>x.jobs[0].command='sensitive-sql',
 ]){
  const x=fresh();mutate(x);
  assert.equal(assessTestCronFreezeCandidate(x,now).candidate_identity_consistent,false);
 }
 assert.equal(assessTestCronFreezeCandidate(null,now).candidate_identity_consistent,false);
});
test('wrong, stale, future or timezone-dependent timestamps block',()=>{
 for(const ts of [
  '2026-11-09T21:14:00Z','2026-11-09T21:26:00Z',
  '2026-11-09T21:24:30+00:00','garbage'
 ]){
  const x=fresh();x.captured_at_utc=ts;
  assert.equal(assessTestCronFreezeCandidate(x,now).candidate_identity_consistent,false,ts);
 }
});
test('wrong/extra/missing job and changed schedule or fingerprint block',()=>{
 for(const mutate of [
  x=>x.all_jobs_count=5,
  x=>x.jobs.push({...x.jobs[0],jobid:5}),
  x=>x.jobs.pop(),
  x=>x.jobs[0].jobid=7,
  x=>x.jobs[0].jobname='wrong',
  x=>x.jobs[0].schedule='*/2 * * * *',
  x=>x.jobs[0].command_sha256='a'.repeat(64),
  x=>x.jobs[0]={...x.jobs[1]},
 ]){
  const x=fresh();mutate(x);
  assert.equal(assessTestCronFreezeCandidate(x,now).candidate_identity_consistent,false);
 }
});
test('inactive job, unfinished all-age work and running status block',()=>{
 for(const mutate of [
  x=>x.jobs[0].active=false,
  x=>x.jobs[1].unfinished_runs=1,
  x=>x.jobs[2].running_runs=3,
  x=>x.jobs[3].running_runs=null,
  x=>x.jobs[3].unfinished_runs='0'
 ]){
  const x=fresh();mutate(x);
  assert.equal(assessTestCronFreezeCandidate(x,now).candidate_identity_consistent,false);
 }
});
test('queued and invalid pg_net depth block even if cron shows no running',()=>{
 for(const pending of [1,2,-1,null,undefined,'0',0.1]){
  const x=fresh();x.pending_pg_net_http_requests=pending;
  assert.equal(assessTestCronFreezeCandidate(x,now).candidate_identity_consistent,false);
 }
});
test('missing private file cannot invoke a provider, alter cron or pass',()=>{
 const cli=spawnSync(process.execPath,[
 new URL('./oa5-test-cron-freeze-candidate.mjs',import.meta.url).pathname,
 '--check','/missing-private-test-cron-readonly.json'],{encoding:'utf8'});
 assert.equal(cli.status,1);
 assert.match(cli.stderr,/BLOCKED/);
 assert.doesNotMatch(cli.stderr,/service_role|sk_live_/);
});
