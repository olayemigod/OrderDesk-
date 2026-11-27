import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {TEST_URL,TEST_REF,assertTarget,quietSql,batchActions} from './oa5-method-b-replay-runner.mjs';
import {planReplay} from './oa5-method-b-replay-package.mjs';
const dir=fileURLToPath(new URL('../../supabase/migrations/',import.meta.url));
test('only exact direct Test endpoint with full TLS verification is accepted',()=>{
 assert.doesNotThrow(()=>assertTarget(TEST_URL));
 for(const url of [
 TEST_URL.replace(TEST_REF,'eujxswjspolugrzlsjnn'),
 TEST_URL.replace('verify-full','require'),
 TEST_URL.replace('postgres@','postgres:secret@'),
 TEST_URL+'&host=localhost',
 'postgresql://postgres@localhost/postgres'
 ]) assert.throws(()=>assertTarget(url),/Only exact/);
});
test('native batches use explicit target and guarded batches record only after SQL and checks',()=>{
 for(const b of planReplay(dir).batches){
  const a=batchActions(b);
  if(b.mode==='native'){
   assert.deepEqual(a,[{kind:'native-up',args:['migration','up','--db-url',TEST_URL,'--yes']}]);
  }else{
   assert.deepEqual(a.map(x=>x.kind),['guarded-sql','quiet-after-sql-before-record','record-executed-version']);
   assert.deepEqual(a[2].args,['migration','repair',b.file.slice(0,14),'--status','applied','--db-url',TEST_URL,'--yes']);
  }
 }
 assert.throws(()=>batchActions({mode:'guarded',end:8,before:0,file:'unknown.sql'}));
});
test('runtime checks require empty retirement, historical cron and lifecycle transition',()=>{
 const start=quietSql(0),before=quietSql(373),after=quietSql(374);
 assert.match(start,/Retirement incomplete or partial replay/);
 assert.doesNotMatch(before,/Retirement incomplete or partial replay/);
 assert.match(before,/FROM cron.job\)<>4/);
 assert.match(after,/FROM cron.job\)<>5/);
 assert.match(after,/sellertray-lifecycle-notifications/);
 for(const sql of [start,before,after]){
  assert.match(sql,/auth.sessions\)<>7/);
  assert.match(sql,/pg_stat_ssl/);
  assert.match(sql,/net.http_request_queue/);
  assert.match(sql,/vault.secrets/);
  assert.match(sql,/sellertray-agreement-package-retry/);
 }
});
test('default execution and missing operator authorization refuse before any network',()=>{
 const path=fileURLToPath(new URL('./oa5-method-b-replay-runner.mjs',import.meta.url));
 const env={...process.env};delete env.SELLERTRAY_TEST_REPLAY_APPROVAL;
 for(const args of [[],['--execute-approved-test-replay',dir,'/unused',TEST_REF]]){
  const result=spawnSync(process.execPath,[path,...args],{env,encoding:'utf8'});
  assert.equal(result.status,1);
  assert.match(result.stderr,/BLOCKED: No explicit/);
 }
});
