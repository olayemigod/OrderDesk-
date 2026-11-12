import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {
 BASELINE_SCOPE,RECHECK_SCOPE,assessExistingVercelProtection
} from './oa5-vercel-project-protection.mjs';

const now=new Date('2026-11-09T22:06:00Z');
const baseline=JSON.parse(readFileSync(
 new URL('../../docs/qa/oa5-existing-vercel-project-protection-2026-11-09.json',import.meta.url)));
const clone=()=>structuredClone(baseline);
function evaluate(change,mode='baseline',date=now){
 const s=clone();if(change)change(s);
 return assessExistingVercelProtection(s,date,mode);
}
test('read-only Merchant and Admin project metadata matches Standard Authentication pre-binding baseline',()=>{
 const r=evaluate();
 assert.equal(r.protection_metadata_consistent,true,r.reasons.join('\n'));
 assert.equal(r.signed_out_preview_challenge_verified,false);
 assert.equal(r.production_public_http_verified,false);
 assert.equal(r.historical_reviewer_access_verified,false);
 assert.equal(r.test_domains_ready,false);
 assert.equal(r.preview_compiled_backend_verified,false);
 assert.equal(r.hosted_change_authorized,false);
 assert.equal(r.destructive_execution_authorized,false);
});
test('wrong project, scope, schema or secret-bearing field fails closed',()=>{
 for(const change of [
  s=>s.scope=RECHECK_SCOPE,
  s=>s.schema_version=2,
  s=>s.access_token='secret',
  s=>s.projects[0].project_id=s.projects[1].project_id,
  s=>s.projects[0].name='unrelated-project',
  s=>s.projects[0].project_envs='secret',
  s=>s.projects[1].surface='merchant',
  s=>s.projects.pop(),
  s=>s.projects.push({...s.projects[0],surface:'unexpected'})
 ]){
  assert.equal(evaluate(change).protection_metadata_consistent,false);
 }
 assert.equal(assessExistingVercelProtection(null,now,'baseline').protection_metadata_consistent,false);
});
test('weakened Preview authentication or Production custom domain detachment blocks',()=>{
 for(const change of [
  s=>s.projects[0].sso_enabled=false,
  s=>s.projects[1].sso_deployment_type='all_previews',
  s=>s.projects[0].sso_deployment_type='none',
  s=>s.projects[0].domains=s.projects[0].domains.filter(x=>x!=='app.sellertray.com'),
  s=>s.projects[1].domains=s.projects[1].domains.filter(x=>x!=='admin.sellertray.com'),
  s=>s.projects[1].domains.push('admin.sellertray.com'),
  s=>s.projects[0].domains.push('admin.sellertray.com')
 ]){
  assert.equal(evaluate(change).protection_metadata_consistent,false);
 }
});
test('premature Test domain attachment blocks pre-binding guard even when authentication is configured',()=>{
 for(const name of ['test.sellertray.com','test-admin.sellertray.com']){
  const r=evaluate(s=>s.projects[0].domains.push(name));
  assert.equal(r.protection_metadata_consistent,false);
  assert.match(r.reasons.join(' '),/Test custom domain unexpectedly attached/);
 }
});
test('fresh and exact private Test pre-binding recheck only validates protection metadata',()=>{
 const s=clone();s.scope=RECHECK_SCOPE;s.captured_at_utc='2026-11-09T22:05:55Z';
 const r=assessExistingVercelProtection(s,now,'recheck');
 assert.equal(r.protection_metadata_consistent,true,r.reasons.join('\n'));
 assert.equal(r.hosted_change_authorized,false);
 assert.equal(r.test_domains_ready,false);
 assert.equal(assessExistingVercelProtection(clone(),now,'recheck').protection_metadata_consistent,false);
});
test('stale/future/unexpected time and mode cannot pass recheck',()=>{
 for(const stamp of [
  '2026-11-09T21:55:00Z','2026-11-09T22:06:01Z',
  '2026-11-09T22:05:00+00:00','invalid',null
 ]){
  assert.equal(evaluate(s=>{s.scope=RECHECK_SCOPE;s.captured_at_utc=stamp},'recheck').protection_metadata_consistent,false);
 }
 assert.equal(evaluate(null,'unknown').protection_metadata_consistent,false);
});
test('offline CLI baseline passes; stale/missing private recheck fails with no side effects',()=>{
 const dir=mkdtempSync(join(tmpdir(),'oa5-vercel-guard-'));
 try{
  const path=join(dir,'baseline.json');writeFileSync(path,JSON.stringify(clone()));
  const cli=new URL('./oa5-vercel-project-protection.mjs',import.meta.url).pathname;
  const b=spawnSync(process.execPath,[cli,'--baseline',path,'--offline'],{encoding:'utf8'});
  assert.equal(b.status,0,b.stderr);
  assert.match(b.stdout,/NOT AUTHORIZED/);
  const wrong=spawnSync(process.execPath,[cli,'--check',path,'--offline'],{encoding:'utf8'});
  assert.equal(wrong.status,1);
  const absent=spawnSync(process.execPath,[cli,'--check','/not-present-oa5-private-protection.json','--offline'],{encoding:'utf8'});
  assert.equal(absent.status,1);
  assert.doesNotMatch(absent.stderr,/service_role|sk_live_|access_token/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
