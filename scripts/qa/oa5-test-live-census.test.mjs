import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {assessTestLiveCensus,ARCHIVED_COUNTS,TEST_REF} from './oa5-test-live-census.mjs';
const now=new Date('2026-11-09T11:05:00Z');
const safe=()=>({schema_version:1,project_ref:TEST_REF,captured_at_utc:'2026-11-09T11:04:10Z',counts:{...ARCHIVED_COUNTS}});
test('archived count match does not authorize reset',()=>{
 const r=assessTestLiveCensus(safe(),now);
 assert.equal(r.ok,true);assert.equal(r.may_reset,false);
});
test('current sixth Auth session blocks archive-to-live parity',()=>{
 const s=safe();s.counts.auth_sessions=6;
 const r=assessTestLiveCensus(s,now);
 assert.equal(r.ok,false);assert.deepEqual(r.drift,[{category:'auth_sessions',archive_count:5,current_count:6}]);
});
test('any count drifting after archive requires review',()=>{
 for(const key of Object.keys(ARCHIVED_COUNTS)){
   const s=safe();s.counts[key]++;
   assert.equal(assessTestLiveCensus(s,now).ok,false,key);
 }
});
test('wrong production project, unknown fields and missing/invalid counts fail closed',()=>{
 for(const change of [
  s=>s.project_ref='eujxswjspolugrzlsjnn',s=>s.schema_version=2,
  s=>s.counts.auth_sessions='5',s=>s.counts.auth_users=-1,
  s=>delete s.counts.public_tables,s=>s.counts.email='private',
  s=>s.jwt='private',s=>s.counts.public_functions=0.1,
 ]){
   const s=safe();change(s);assert.equal(assessTestLiveCensus(s,now).ok,false);
 }
});
test('missing, stale and future timestamps fail closed',()=>{
 for(const t of [null,'','invalid','2026-11-09T10:50:00Z','2026-11-09T11:05:01Z']){
  const s=safe();s.captured_at_utc=t;
  assert.equal(assessTestLiveCensus(s,now).ok,false);
 }
});
test('CLI missing protected JSON refuses access and never calls Supabase',()=>{
 const r=spawnSync(process.execPath,[new URL('./oa5-test-live-census.mjs',import.meta.url).pathname,'--check','/nonexistent-live-counts.json'],{encoding:'utf8'});
 assert.equal(r.status,1);assert.match(r.stderr,/BLOCKED/);
});
