import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {
 EXPECTED,TEST_REF,PROD_REF,inspectPreviewBundleCapture
} from './oa5-historical-preview-bundle-inspection.mjs';

const now=new Date('2026-11-09T21:00:00Z');
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'sellertray-oa5-bundle-'));
 const manifest={
  schema_version:1,scope:'historical-preview-bundle-content-only',
  captured_at_utc:'2026-11-09T20:55:00Z',
  deployments:EXPECTED.map((x,i)=>({
    id:x.id,sha:x.sha,surface:x.surface,
    directory:'capture_'+i,capture_evidence_ref:'private-review-'+i+'-0001'
  }))
 };
 for(let i=0;i<EXPECTED.length;i++){
  const folder=join(dir,'capture_'+i);
  mkdirSync(join(folder,'assets'),{recursive:true});
  writeFileSync(join(folder,'index.html'),'<html><script type="module" src="/assets/site.js"></script></html>');
  writeFileSync(join(folder,'assets','site.js'),'const api="https://'+TEST_REF+'.supabase.co";');
 }
 return {dir,manifest,done:()=>rmSync(dir,{recursive:true,force:true})};
}
function inspectChange(fn){
 const f=fixture();
 try{fn(f);return inspectPreviewBundleCapture(f.manifest,f.dir,now);}
 finally{f.done();}
}
test('all five synthetic compiled captures are Test-only but never proof of Vercel origin',()=>{
 const r=inspectChange(()=>{});
 assert.equal(r.content_consistent_with_test,true);
 assert.equal(r.details.length,5);
 assert.equal(r.historical_artifact_origin_verified,false);
 assert.equal(r.hosted_compiled_bundle_accepted,false);
 assert.equal(r.destructive_execution_authorized,false);
});
test('a single embedded production ref among five captures blocks',()=>{
 const r=inspectChange(f=>{
   writeFileSync(join(f.dir,'capture_2','assets','extra.js'),'const x="'+PROD_REF+'";');
 });
 assert.equal(r.content_consistent_with_test,false);
 assert.match(r.errors.join(' '),/Production project ref/);
});
test('unknown Supabase URL blocks even if the valid Test URL exists',()=>{
 const r=inspectChange(f=>{
  writeFileSync(join(f.dir,'capture_1','assets','extra.mjs'),
   'const endpoint="https://aaaaaaaaaaaaaaaaaaaa.supabase.co";');
 });
 assert.equal(r.content_consistent_with_test,false);
 assert.match(r.errors.join(' '),/Unexpected Supabase project URL/);
});
test('missing Test identity or missing HTML or JS blocks',()=>{
 for(const variant of ['ref','html','js']){
  const r=inspectChange(f=>{
   if(variant==='ref')writeFileSync(join(f.dir,'capture_0','assets','site.js'),'const x=1;');
   if(variant==='html')unlinkSync(join(f.dir,'capture_0','index.html'));
   if(variant==='js')unlinkSync(join(f.dir,'capture_0','assets','site.js'));
  });
  assert.equal(r.content_consistent_with_test,false,variant);
 }
});
test('replaced, duplicated or incomplete historical deployment roster blocks',()=>{
 for(const change of [
  m=>m.deployments[0].sha='b'.repeat(40),
  m=>m.deployments[0].id='dpl_not_expected',
  m=>m.deployments[1].id=m.deployments[0].id,
  m=>m.deployments.pop(),
  m=>m.deployments[0].surface='admin',
  m=>m.deployments[0].url='https://secret.invalid',
  m=>m.deployments[0].capture_evidence_ref='a'
 ]){
  const r=inspectChange(f=>change(f.manifest));
  assert.equal(r.content_consistent_with_test,false);
  assert.equal(r.destructive_execution_authorized,false);
 }
});
test('manifest wrong scope, schema, future time or extra credentials blocks',()=>{
 for(const change of [
  m=>m.scope='destructive-cleanup',
  m=>m.schema_version=2,
  m=>m.captured_at_utc='2026-11-09T21:05:00Z',
  m=>m.captured_at_utc='not-a-date',
  m=>m.access_token='secret',
 ]){
  const r=inspectChange(f=>change(f.manifest));
  assert.equal(r.content_consistent_with_test,false);
 }
});
test('directory traversal and duplicate directory are rejected',()=>{
 for(const change of [
  m=>m.deployments[0].directory='../escape',
  m=>m.deployments[0].directory='/tmp',
  m=>m.deployments[0].directory=m.deployments[1].directory,
 ]){
  const r=inspectChange(f=>change(f.manifest));
  assert.equal(r.content_consistent_with_test,false);
 }
});
test('symlink under captured assets fails safe',()=>{
 const r=inspectChange(f=>{
  symlinkSync('/not-present/private-secret',join(f.dir,'capture_4','assets','external.js'));
 });
 assert.equal(r.content_consistent_with_test,false);
 assert.match(r.errors.join(' '),/unsafe/);
});
test('missing private CLI manifest yields failure without network or secrets',()=>{
 const run=spawnSync(process.execPath,[
  new URL('./oa5-historical-preview-bundle-inspection.mjs',import.meta.url).pathname,
  '--check','/not-present/private-capture.json','/not-present/captures'
 ],{encoding:'utf8'});
 assert.equal(run.status,1);
 assert.match(run.stderr,/BLOCKED/);
 assert.doesNotMatch(run.stderr,/sk_live_|service_role/);
});
