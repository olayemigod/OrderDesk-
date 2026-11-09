import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {assessRebuildPreflight,REQUIRED_EVIDENCE} from './oa5-test-rebuild-preflight.mjs';
import {assessTestLiveCensus,ARCHIVED_COUNTS,TEST_REF,REVIEWED_SESSION_LOSS_SCOPE} from './oa5-test-live-census.mjs';
const ref='iukgsukdoowvnhlfmpml',sha='a'.repeat(40);
const record=()=>({schema_version:1,project_ref:ref,reviewed_source_sha:sha,purpose:'pre-reset-human-review',
 evidence:Object.fromEntries(REQUIRED_EVIDENCE.map(k=>[k,{reviewed:true,evidence_ref:'private-review-0001'}]))});
const proof={sourceSha:sha,archive:{ok:true},cron:{ok:true},liveCensus:{ok:true},managedBoundary:{ok:true}};
test('complete synthetic review never authorizes destructive Test execution',()=>{
  const result=assessRebuildPreflight(record(),proof);
  assert.equal(result.preconditions_met,true);
  assert.equal(result.destructive_execution_authorized,false);
});
test('missing/wrong project, purpose, source, schema and unexpected fields block',()=>{
  for(const change of [
    x=>x.project_ref='eujxswjspolugrzlsjnn',x=>x.schema_version=2,
    x=>x.purpose='destructive-reset',x=>x.reviewed_source_sha='b'.repeat(40),
    x=>x.project_ref='test',x=>x.secret='do-not-save-secrets',
  ]){
    const r=record();change(r);
    assert.equal(assessRebuildPreflight(r,proof).preconditions_met,false);
  }
  assert.equal(assessRebuildPreflight(null,proof).preconditions_met,false);
  assert.equal(assessRebuildPreflight(record(),{...proof,sourceSha:'b'.repeat(40)}).preconditions_met,false);
});
test('each missing or unreviewed evidence category is a stop condition',()=>{
  for(const key of REQUIRED_EVIDENCE){
    const r=record();delete r.evidence[key];
    assert.equal(assessRebuildPreflight(r,proof).preconditions_met,false,key);
    const t=record();t.evidence[key].reviewed=false;
    assert.equal(assessRebuildPreflight(t,proof).preconditions_met,false,key);
  }
});
test('unknown evidence and secret-bearing fields are refused',()=>{
  for(const change of [
    x=>x.evidence.unreviewed={reviewed:true,evidence_ref:'private-review-0001'},
    x=>x.evidence.archive_restore_reviewed.access_token='secret',
    x=>x.evidence.archive_restore_reviewed.evidence_ref='http://public.example/secrets',
    x=>x.evidence.archive_restore_reviewed.evidence_ref='p',
  ]){
    const r=record();change(r);
    assert.equal(assessRebuildPreflight(r,proof).preconditions_met,false);
  }
});
test('backup/restore and fresh cron/pg_net evidence are mandatory, independent stop conditions',()=>{
  for(const q of [
    {...proof,archive:{ok:false,errors:['invalid checksum']}},
    {...proof,cron:{ok:false,reasons:['4 active jobs']}},
    {...proof,archive:null},{...proof,cron:null},
    {...proof,liveCensus:null},{...proof,liveCensus:{ok:false,reasons:['6 Auth sessions']}},
    {...proof,managedBoundary:null},{...proof,managedBoundary:{ok:false,reasons:['stale managed state']}},
  ]){
    const r=assessRebuildPreflight(record(),q);
    assert.equal(r.preconditions_met,false);
    assert.equal(r.destructive_execution_authorized,false);
  }
});
test('CLI without private operator evidence cannot contact any hosted resource or approve reset',()=>{
  const run=spawnSync(process.execPath,[new URL('./oa5-test-rebuild-preflight.mjs',import.meta.url).pathname,'--check','/nonexistent-record.json','/nonexistent-archive','/nonexistent-cron.json','/nonexistent-live.json','/nonexistent-managed.json'],{encoding:'utf8'});
  assert.equal(run.status,1);
  assert.match(run.stderr,/BLOCKED/);
  assert.doesNotMatch(run.stderr,/service_role|sk_live_/);
});

test('preflight can consume narrowly reviewed one-session count but never authorizes cleanup',()=>{
 const now=new Date('2026-11-09T11:05:00Z');
 const s={schema_version:1,project_ref:TEST_REF,captured_at_utc:'2026-11-09T11:04:10Z',
   counts:{...ARCHIVED_COUNTS,auth_sessions:6}};
 const a={schema_version:1,project_ref:TEST_REF,scope:REVIEWED_SESSION_LOSS_SCOPE,
   archive_auth_sessions:5,current_auth_sessions:6,approved_loss:true,
   reviewed_at_utc:'2026-11-09T11:04:45Z',evidence_ref:'private-review-0001'};
 const counted=assessTestLiveCensus(s,now,a);
 assert.equal(counted.ok,true);
 const gate=assessRebuildPreflight(record(),{...proof,liveCensus:counted});
 assert.equal(gate.preconditions_met,true);
 assert.equal(gate.destructive_execution_authorized,false);
 assert.equal(assessRebuildPreflight(record(),{...proof,cron:{ok:false},liveCensus:counted}).preconditions_met,false);
});
