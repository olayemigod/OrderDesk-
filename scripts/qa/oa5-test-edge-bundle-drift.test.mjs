import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {
 TEST_PROJECT,KNOWN,BASELINE_PURPOSE,RECHECK_PURPOSE,assessTestEdgeBundleDrift
} from './oa5-test-edge-bundle-drift.mjs';

const observation=new Date('2026-11-09T21:39:00Z');
const baseline=JSON.parse(readFileSync(new URL('../../docs/qa/oa5-test-edge-bundle-custody-2026-11-09.json',import.meta.url)));
const clone=()=>structuredClone(baseline);
const check=(mutate,mode='baseline',now=observation)=>{
 const b=clone();
 if(mutate)mutate(b);
 return assessTestEdgeBundleDrift(b,now,mode);
};

test('five authentic historical read-only bundle hashes match frozen custody but never authorize action',()=>{
 const result=check();
 assert.equal(result.metadata_matches_historical_baseline,true,result.reasons.join('\n'));
 assert.equal(KNOWN.length,5);
 assert.equal(result.deployed_source_provenance_verified,false);
 assert.equal(result.external_provider_isolation_verified,false);
 assert.equal(result.edge_deployment_authorized,false);
 assert.equal(result.cron_pause_authorized,false);
 assert.equal(result.destructive_execution_authorized,false);
});
test('wrong project, purpose and unknown added fields fail closed',()=>{
 for(const fn of [
  x=>x.project_ref='eujxswjspolugrzlsjnn',
  x=>x.project_ref='test',
  x=>x.purpose=RECHECK_PURPOSE,
  x=>x.purpose='authorize-edge-deploy',
  x=>x.schema_version=2,
  x=>x.service_role_key='private',
  x=>x.functions[0].secret='private',
  x=>x.functions[0].callback_url='https://example.invalid',
 ]){
  assert.equal(check(fn).metadata_matches_historical_baseline,false);
 }
 assert.equal(assessTestEdgeBundleDrift(null,observation,'baseline').metadata_matches_historical_baseline,false);
});
test('function hash, version, status, jwt and slug drift fail closed',()=>{
 for(const fn of [
  x=>x.functions[1].bundle_sha256='f'.repeat(64),
  x=>x.functions[1].bundle_sha256=null,
  x=>x.functions[0].version+=1,
  x=>x.functions[0].status='INACTIVE',
  x=>x.functions[4].verify_jwt=false,
  x=>x.functions[4].slug='unreviewed-production-webhook',
  x=>x.functions[0].slug=x.functions[1].slug,
  x=>x.functions.pop(),
  x=>x.functions.push({...x.functions[0],slug:'new-sender'})
 ]){
  const r=check(fn);
  assert.equal(r.metadata_matches_historical_baseline,false);
  assert.equal(r.destructive_execution_authorized,false);
 }
});
test('fresh Test-only recheck accepts exact hashes while baseline file is not itself a recheck',()=>{
 const snapshot=clone();
 assert.equal(assessTestEdgeBundleDrift(snapshot,observation,'recheck').metadata_matches_historical_baseline,false);
 snapshot.purpose=RECHECK_PURPOSE;
 snapshot.observed_at_utc='2026-11-09T21:38:45Z';
 const r=assessTestEdgeBundleDrift(snapshot,observation,'recheck');
 assert.equal(r.metadata_matches_historical_baseline,true);
 assert.equal(r.edge_deployment_authorized,false);
 assert.equal(r.destructive_execution_authorized,false);
});
test('stale, future, timezone malformed or unknown evidence cannot pass recheck',()=>{
 for(const stamp of [
  '2026-11-09T21:28:59Z','2026-11-09T21:39:01Z',
  '2026-11-09T21:38:45+00:00', 'not-date',null
 ]){
  const r=check(x=>{x.purpose=RECHECK_PURPOSE;x.observed_at_utc=stamp},'recheck');
  assert.equal(r.metadata_matches_historical_baseline,false,String(stamp));
 }
 assert.equal(check(x=>x.observed_at_utc='2050-01-01T00:00:00Z').metadata_matches_historical_baseline,false);
 assert.equal(check(null,'unknown').metadata_matches_historical_baseline,false);
});
test('CLI validates local baseline offline; rejects missing private recheck evidence',()=>{
 const dir=mkdtempSync(join(tmpdir(),'oa5-edge-bundle-'));
 try{
  const file=join(dir,'baseline.json');
  writeFileSync(file,JSON.stringify(clone()));
  const cli=new URL('./oa5-test-edge-bundle-drift.mjs',import.meta.url).pathname;
  const base=spawnSync(process.execPath,[cli,'--baseline',file,'--offline'],{encoding:'utf8'});
  assert.equal(base.status,0,base.stderr);
  assert.match(base.stdout,/NOT AUTHORIZED/);
  const reused=spawnSync(process.execPath,[cli,'--check',file,'--offline'],{encoding:'utf8'});
  assert.equal(reused.status,1);
  assert.match(reused.stderr,/BLOCKED/);
  const missing=spawnSync(process.execPath,[cli,'--check','/not-a-real-private-test-edge-file.json','--offline'],{encoding:'utf8'});
  assert.equal(missing.status,1);
  assert.doesNotMatch(missing.stderr,/service_role|sk_live_/);
 } finally{rmSync(dir,{recursive:true,force:true});}
});
