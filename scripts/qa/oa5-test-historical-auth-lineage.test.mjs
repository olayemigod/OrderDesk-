import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {assessHistoricalTestAuthLineage,HISTORICAL_BASELINE,BEFORE_REBUILD,TEST_PROJECT} from './oa5-test-historical-auth-lineage.mjs';

const now=new Date('2026-11-11T19:55:00Z');
const fresh=()=>({
 schema_version:1,project_ref:TEST_PROJECT,purpose:BEFORE_REBUILD,
 captured_at_utc:'2026-11-11T19:51:31Z',counts:{...HISTORICAL_BASELINE}
});
test('complete synthetic historic authority census is not a quarantine or destructive approval',()=>{
 const x=assessHistoricalTestAuthLineage(fresh(),now);
 assert.equal(x.historical_baseline_consistent,true);
 assert.equal(x.historical_auth_membership_authority_present,true);
 for(const key of ['historical_users_quarantined_in_canonical_schema',
  'historical_reviewer_access_verified','hosted_cleanup_authorized',
  'destructive_execution_authorized'])assert.equal(x[key],false);
});
test('wrong Production project, malformed schema, wrong purpose, and unexpected identity fields block',()=>{
 for(const modify of [x=>x.project_ref='eujxswjspolugrzlsjnn',
  x=>x.purpose='post-rebuild-accepted',x=>x.schema_version=2,
  x=>x.secret='not-allowed',x=>x.counts.user_email='hidden@example.com']){
   const r=fresh();modify(r);
   assert.equal(assessHistoricalTestAuthLineage(r,now).historical_baseline_consistent,false);
 }
 assert.equal(assessHistoricalTestAuthLineage(null,now).historical_baseline_consistent,false);
});
test('every mutable Auth membership, administrator, Branch and Agreement count is reconciled',()=>{
 for(const key of Object.keys(HISTORICAL_BASELINE)){
  const r=fresh();r.counts[key]=HISTORICAL_BASELINE[key]+1;
  assert.equal(assessHistoricalTestAuthLineage(r,now).historical_baseline_consistent,false,key);
  const y=fresh();delete y.counts[key];
  assert.equal(assessHistoricalTestAuthLineage(y,now).historical_baseline_consistent,false,key);
 }
});
test('stale, future-dated, invalid and negative counts fail closed',()=>{
 for(const d of ['2026-11-11T19:44:59Z','2026-11-11T19:56:00Z','invalid-date']){
   const x=fresh();x.captured_at_utc=d;
   assert.equal(assessHistoricalTestAuthLineage(x,now).historical_baseline_consistent,false);
 }
 const x=fresh();x.counts.tenant_members=-1;
 assert.equal(assessHistoricalTestAuthLineage(x,now).historical_baseline_consistent,false);
 const y=fresh();y.counts.platform_admins='3';
 assert.equal(assessHistoricalTestAuthLineage(y,now).historical_baseline_consistent,false);
});
test('CLI with missing private snapshot never reveals its path or sends provider actions',()=>{
 const script=new URL('./oa5-test-historical-auth-lineage.mjs',import.meta.url).pathname;
 const privatePath='/private/sensitive-account-auth-census.json';
 const p=spawnSync(process.execPath,[script,'--check',privatePath],{encoding:'utf8'});
 assert.equal(p.status,1);
 assert.match(p.stderr,/BLOCKED/);
 assert.equal(p.stderr.includes(privatePath),false);
});
