import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {EXPECTED,TEST_REF,PROD_REF} from './oa5-historical-preview-bundle-inspection.mjs';
import {validatePrivateCapturePlan,captureOriginalPreviewPlan} from './oa5-protected-preview-capture.mjs';

const at=new Date('2026-11-09T23:50:00Z');
const plan=()=>({
 schema_version:1,purpose:'read-only-original-preview-capture',
 deployments:EXPECTED.map((d,i)=>({...d,
  origin:'https://sellertray-'+d.surface+'-git-oa5-evidence-'+i+'.vercel.app',
  capture_evidence_ref:'private-original-review-'+i}))
});
const makeWorkspace=()=>{
 const parent=mkdtempSync(join(tmpdir(),'oa5-original-preview-'));
 return {parent,root:join(parent,'protected-capture'),
  cleanup:()=>rmSync(parent,{recursive:true,force:true})};
};
function mockedRequest(url){
 const parsed=new URL(url);
 if(parsed.pathname==='/')return Buffer.from(
  '<!doctype html><html><script type="module" src="/assets/site.js"></script></html>');
 if(parsed.pathname==='/assets/site.js')return Buffer.from(
  'import "./sub.js";console.log("original");');
 if(parsed.pathname==='/assets/sub.js')return Buffer.from(
  'export const configured="https://'+TEST_REF+'.supabase.co";');
 throw Error('Unexpected network path in synthetic test: '+parsed.pathname);
}
test('private five-deployment plan accepts exact IDs and restricted Vercel hostnames but never claims historical origin',()=>{
 const r=validatePrivateCapturePlan(plan());
 assert.equal(r.valid,true,r.reasons.join('\n'));
 assert.equal(r.deployments.length,5);
 assert.equal(r.original_vercel_origin_attested,false);
 assert.equal(r.authorized_reviewer_verified,false);
 assert.equal(r.capture_authorized_by_tool,false);
});
test('original ID, SHA, surface, evidence and duplicate aliases are fail-closed',()=>{
 for(const mutate of [
  x=>x.deployments[0].id='dpl_wrong',
  x=>x.deployments[0].sha='a'.repeat(40),
  x=>x.deployments[0].surface='admin',
  x=>x.deployments[0].origin=x.deployments[1].origin,
  x=>x.deployments[1].capture_evidence_ref=x.deployments[0].capture_evidence_ref,
  x=>x.deployments.pop(),
  x=>x.deployments.push({...x.deployments[0],origin:'https://other.vercel.app'}),
  x=>x.deployments[0].token='private',
  x=>x.api_key='private',
  x=>x.purpose='write-production',
  x=>x.schema_version=2
 ]){
  const x=plan();mutate(x);
  assert.equal(validatePrivateCapturePlan(x).valid,false);
 }
});
test('only original project-specific Preview URLs; no Production, custom, arbitrary, tokenized or unsafe origins',()=>{
 for(const origin of [
  'https://app.sellertray.com','https://admin.sellertray.com',
  'https://test.sellertray.com','https://sellertray-merchant.vercel.app',
  'https://sellertray-admin-git-example.vercel.app',
  'http://sellertray-merchant-git-safe.vercel.app',
  'https://evil.example.invalid',
  'https://user:password@sellertray-merchant-git-safe.vercel.app',
  'https://sellertray-merchant-git-safe.vercel.app:8443',
  'https://sellertray-merchant-git-safe.vercel.app/api',
  'https://sellertray-merchant-git-safe.vercel.app/?token=a',
  'https://sellertray-merchant-git-safe.vercel.app/#fragment',
  'https://sellertray-merchant-git-safe.vercel.app.evil.invalid',
 ]){
  const x=plan();x.deployments[0].origin=origin;
  assert.equal(validatePrivateCapturePlan(x).valid,false,origin);
 }
});
test('synthetic original HTML plus reachable JS is privately captured and SHA-hashed without accepting hosted provenance',()=>{
 const w=makeWorkspace();
 try{
  const requests=[];
  const r=captureOriginalPreviewPlan(plan(),w.root,(url,max)=>{
   requests.push(new URL(url).pathname);
   return mockedRequest(url);
  },at);
  assert.equal(r.content_consistent_with_test,true);
  assert.equal(r.capture_count,5);
  assert.equal(r.total_file_count,15);
  assert.equal(r.original_vercel_origin_attested,false);
  assert.equal(r.authorized_reviewer_verified,false);
  assert.equal(r.hosted_compiled_bundle_accepted,false);
  assert.equal(r.destructive_execution_authorized,false);
  assert.equal(requests.length,15);
  const privateManifest=JSON.parse(readFileSync(r.manifest_path,'utf8'));
  const privateHashes=JSON.parse(readFileSync(r.hash_inventory_path,'utf8'));
  assert.equal(privateManifest.deployments.length,5);
  assert.equal(privateHashes.captures.length,5);
  assert.equal(privateHashes.captures[0].files.length,3);
  assert.match(privateHashes.captures[0].files[0].sha256,/^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(privateManifest).includes('vercel.app'),false);
  assert.equal(JSON.stringify(privateHashes).includes('vercel.app'),false);
  assert.equal(existsSync(join(w.root,'capture_4','assets','sub.js')),true);
 }finally{w.cleanup();}
});
test('outside-domain script src blocked without fetching untrusted remote host',()=>{
 const w=makeWorkspace();
 try{
  const calls=[];
  assert.throws(()=>captureOriginalPreviewPlan(plan(),w.root,(url)=>{
   calls.push(url);
   if(url.endsWith('/'))return Buffer.from(
    '<html><script src="https://untrusted.invalid/external.js"></script></html>');
   return mockedRequest(url);
  },at),/BLOCKED/);
  assert.equal(calls.length,1);
  assert.equal(calls.every(x=>x.endsWith('.vercel.app/')),true);
  assert.equal(existsSync(join(w.root,'private-capture-manifest.json')),false);
 }finally{w.cleanup();}
});
test('missing imported compiled chunk fails closed and never produces accepted manifest',()=>{
 const w=makeWorkspace();
 try{
  assert.throws(()=>captureOriginalPreviewPlan(plan(),w.root,(url)=>{
   if(url.endsWith('/assets/sub.js'))throw Error('private 404 URL should not leak');
   return mockedRequest(url);
  },at),/BLOCKED/);
  assert.equal(existsSync(join(w.root,'private-capture-manifest.json')),false);
 }finally{w.cleanup();}
});
test('SSO HTML challenge at root fails without trusting a successful HTTP response',()=>{
 const w=makeWorkspace();
 try{
  assert.throws(()=>captureOriginalPreviewPlan(plan(),w.root,()=>Buffer.from(
   '<html><body>Sign in to Vercel</body></html>'),at),/BLOCKED/);
 }finally{w.cleanup();}
});
test('unexpected Production backend in captured JavaScript fails whole five-deployment content check',()=>{
 const w=makeWorkspace();
 try{
  assert.throws(()=>captureOriginalPreviewPlan(plan(),w.root,url=>{
   if(url.endsWith('/assets/sub.js'))return Buffer.from(
    'export const prod="https://'+PROD_REF+'.supabase.co";'+
    'export const test="https://'+TEST_REF+'.supabase.co";');
   return mockedRequest(url);
  },at),/BLOCKED/);
  assert.equal(existsSync(join(w.root,'private-capture-manifest.json')),false);
 }finally{w.cleanup();}
});
test('no overwritten historical capture; no download occurs if private output is occupied',()=>{
 const w=makeWorkspace();
 try{
  mkdirSync(w.root);
  writeFileSync(join(w.root,'do-not-overwrite.txt'),'original');
  let called=0;
  assert.throws(()=>captureOriginalPreviewPlan(plan(),w.root,()=>{
   called++;return Buffer.from('test');
  },at),/BLOCKED/);
  assert.equal(called,0);
 }finally{w.cleanup();}
});
test('CLI checks private plan offline without vc CLI; malformed capture is rejected before authentication',()=>{
 const w=makeWorkspace();
 try{
  const good=join(w.parent,'private-plan.json');
  writeFileSync(good,JSON.stringify(plan()));
  const cli=new URL('./oa5-protected-preview-capture.mjs',import.meta.url).pathname;
  const check=spawnSync(process.execPath,[cli,'--check-plan',good],{encoding:'utf8'});
  assert.equal(check.status,0,check.stderr);
  assert.match(check.stdout,/NOT VERIFIED/);
  const invalid=plan();invalid.deployments[0].origin='https://app.sellertray.com';
  const bad=join(w.parent,'invalid-plan.json');
  writeFileSync(bad,JSON.stringify(invalid));
  const capture=spawnSync(process.execPath,[cli,'--capture',bad,w.root],{encoding:'utf8'});
  assert.equal(capture.status,1);
  assert.match(capture.stderr,/BLOCKED/);
  assert.equal(existsSync(w.root),false);
 }finally{w.cleanup();}
});

test('never writes private Preview files inside Git and never reads an alias plan from tracked source',()=>{
 let called=0;
 const forbidden=join(process.cwd(),'oa5-no-private-capture-in-source');
 assert.throws(()=>captureOriginalPreviewPlan(plan(),forbidden,()=>{
  called++;return Buffer.from('unreachable');
 },at),/BLOCKED/);
 assert.equal(called,0);
 assert.equal(existsSync(forbidden),false);
 const cli=new URL('./oa5-protected-preview-capture.mjs',import.meta.url).pathname;
 const inRepo=new URL('../../docs/qa/oa5-historical-vercel-preview-custody-2026-11-09.json',import.meta.url).pathname;
 const check=spawnSync(process.execPath,[cli,'--check-plan',inRepo],{encoding:'utf8'});
 assert.equal(check.status,1);
 assert.match(check.stderr,/BLOCKED/);
});
