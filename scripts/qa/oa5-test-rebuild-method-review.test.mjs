import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {assessRebuildMethodCandidate,BOUNDARIES,IRREVERSIBLE,STAGES,TEST_REF,INTENT,MIGRATIONS} from './oa5-test-rebuild-method-review.mjs';

const sha='a'.repeat(40),hash='b'.repeat(64);
const inventory={structural_source_check_passed:true,source_migrations_scanned:MIGRATIONS,source_inventory_sha256:hash};
const candidate=()=>({
 schema_version:1,project_ref:TEST_REF,intent:INTENT,source_sha:sha,
 migration_inventory_sha256:hash,migration_count:MIGRATIONS,
 method:'retain_managed_auth_quarantine_clean_canonical',
 boundaries:{...BOUNDARIES},irreversible_assumptions:{...IRREVERSIBLE},stages:[...STAGES]
});
const check=r=>assessRebuildMethodCandidate(r,{sourceSha:sha,sourceInventory:inventory});
test('synthetic complete method candidate is never an authorization or proof of a hosted dry run',()=>{
 const r=check(candidate());assert.equal(r.candidate_method_structurally_consistent,true,r.reasons.join('\\n'));
 for(const k of ['method_independently_approved','exact_remote_cli_side_effects_dry_run_verified',
 'historical_auth_post_replay_quarantine_verified','provider_console_quiescence_verified',
 'hosted_test_reconstruction_authorized','cron_pause_authorized','production_cutover_authorized'])
  assert.equal(r[k],false);
});
test('reject Production target, wrong strategy, changed source and missing 461 migrations',()=>{
 for(const modify of [
  x=>x.project_ref='eujxswjspolugrzlsjnn',x=>x.project_ref='user',
  x=>x.method='delete_all_managed_auth',x=>x.intent='production-release',
  x=>x.source_sha='c'.repeat(40),x=>x.migration_count=MIGRATIONS-1,
  x=>x.migration_inventory_sha256='c'.repeat(64),x=>x.version=2,
  x=>x.private_project_url='secret',x=>x.irreversible_assumptions.live_keys='hidden',
 ]){
  const x=candidate();modify(x);
  assert.equal(check(x).candidate_method_structurally_consistent,false);
 }
 assert.equal(check(null).candidate_method_structurally_consistent,false);
 assert.equal(assessRebuildMethodCandidate(candidate(),{sourceSha:sha,sourceInventory:{...inventory,source_migrations_scanned:MIGRATIONS-1}}).candidate_method_structurally_consistent,false);
});
test('every managed service and preserved artifact has a mandatory immutable disposition',()=>{
 for(const [k] of Object.entries(BOUNDARIES)){
   const x=candidate();delete x.boundaries[k];
   assert.equal(check(x).candidate_method_structurally_consistent,false,k);
   const y=candidate();y.boundaries[k]='delete_or_assume_reset';
   assert.equal(check(y).candidate_method_structurally_consistent,false,k);
 }
});
test('unsafe recovery claims and incomplete rollback assumptions cannot pass review',()=>{
 for(const [k] of Object.entries(IRREVERSIBLE)){
  const x=candidate();x.irreversible_assumptions[k]=true;
  assert.equal(check(x).candidate_method_structurally_consistent,false,k);
  const y=candidate();delete y.irreversible_assumptions[k];
  assert.equal(check(y).candidate_method_structurally_consistent,false,k);
 }
});
test('stage reordering and missing provider, authorized pause, quarantine or synthetic QA stage fail',()=>{
 for(let i=0;i<STAGES.length;i++){
  const x=candidate();x.stages.splice(i,1);
  assert.equal(check(x).candidate_method_structurally_consistent,false,STAGES[i]);
 }
 const x=candidate();[x.stages[5],x.stages[7]]=[x.stages[7],x.stages[5]];
 assert.equal(check(x).candidate_method_structurally_consistent,false);
});
test('offline CLI missing private method file fails before any SQL, shell or provider action',()=>{
 const script=new URL('./oa5-test-rebuild-method-review.mjs',import.meta.url).pathname;
 const secret='/private/rebuild-plan-credentials.txt';
 const p=spawnSync(process.execPath,[script,'--check',secret,'/missing/migrations'],{encoding:'utf8'});
 assert.equal(p.status,1);assert.match(p.stderr,/BLOCKED/);assert.equal(p.stderr.includes(secret),false);
});

