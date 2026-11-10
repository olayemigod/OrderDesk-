import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import * as vm from 'node:vm';
import {createHash} from 'node:crypto';
import {auditedImportLiterals,localPath} from './oa5-preview-module-graph.mjs';
import {captureOriginalPreviewPlan} from './oa5-protected-preview-capture.mjs';
import {EXPECTED,TEST_REF,PROD_REF} from './oa5-historical-preview-bundle-inspection.mjs';

test('V8 parse-only audit removes inert bare regex match but retains all eight real static local dependencies',()=>{
 assert.equal(typeof vm.SourceTextModule,'function');
 const refs=Array.from({length:8},(_,n)=>'./chunk'+n+'.js');
 const source=refs.map(ref=>'import "'+ref+'";').join('\n')+
   '\nconst sample = "import(\\\'not-an-active-import\\\')";';
 // String above is not active ESM import syntax.
 const actual=auditedImportLiterals(source,{requireParser:true});
 assert.deepEqual(actual,refs);
 assert.equal(actual.some(x=>!localPath('assets/app.js',x,false)),false);
});
test('V8 parse-only audit still rejects real dynamic bare and remote module requests',()=>{
 for(const ref of ['bare-dependency','https://private.example.invalid/secret.js']){
  const source='export async function load(){return import("'+ref+'");}';
  const actual=auditedImportLiterals(source,{requireParser:true});
  assert.equal(actual.includes(ref),true);
  assert.equal(localPath('assets/app.js',ref,false),null);
 }
});
test('V8 audit preserves real dynamic local dependency and does not follow inert local references',()=>{
 const source="const f=()=>import('./lazy.js');"+
   'const text="import(\\\'./not-real.js\\\')";'+
   "export const ready=true;";
 const actual=auditedImportLiterals(source,{requireParser:true});
 assert.equal(actual.includes('./lazy.js'),true);
 assert.equal(actual.includes('./not-real.js'),false);
});
test('V8 parse-only audit fails closed on invalid module syntax rather than evaluating source',()=>{
 assert.throws(()=>auditedImportLiterals("import {", {requireParser:true}),/BLOCKED/);
 // This function is never invoked. V8 compilation cannot execute its body.
 globalThis.__oa5_no_eval_test='safe';
 auditedImportLiterals('globalThis.__oa5_no_eval_test="unsafe";export const fine=true;', {requireParser:true});
 assert.equal(globalThis.__oa5_no_eval_test,'safe');
 delete globalThis.__oa5_no_eval_test;
});
test('synthetic protected five-Preview capture succeeds with inert regex hit and complete local original chunks',()=>{
 const expected=EXPECTED.map((x,i)=>({...x,
  origin:'https://sellertray-'+x.surface+'-git-synthetic-vm-'+i+'.vercel.app',
  capture_evidence_ref:'offline-test-proof-'+i}));
 const privateDigests=Object.fromEntries(expected.map(x=>[
  x.id,createHash('sha256').update(x.id+'\n'+new URL(x.origin).hostname).digest('hex')
 ]));
 const plan={schema_version:1,purpose:'read-only-original-preview-capture',deployments:expected};
 const src=Array.from({length:8},(_,i)=>'./chunk'+i+'.js')
   .map(r=>'import "'+r+'";').join('\n')+
   '\nconst docs="import(\\\'not-an-active-bare-import\\\')";'+
   '\nexport const backend="https://'+TEST_REF+'.supabase.co";';
 const work=mkdtempSync(join(tmpdir(),'oa5-vm-audit-'));
 try{
  const root=join(work,'private-originals');
  const count=[];
  const output=captureOriginalPreviewPlan(plan,root,url=>{
   const path=new URL(url).pathname;
   count.push(path);
   if(path==='/')return Buffer.from('<!doctype html><html><script type="module" src="/assets/app.js"></script></html>');
   if(path==='/assets/app.js')return Buffer.from(src);
   if(/^\/assets\/chunk[0-7]\.js$/.test(path))return Buffer.from('export const code=1;');
   throw Error('Unexpected path in mock capture');
  },new Date('2026-11-10T00:00:00Z'),privateDigests);
  assert.equal(output.capture_count,5);
  assert.equal(output.total_file_count,50);
  assert.equal(output.content_consistent_with_test,true);
  assert.equal(output.hosted_compiled_bundle_accepted,false);
  assert.equal(output.original_vercel_origin_attested,false);
  assert.equal(count.length,50);
  assert.equal(count.every(x=>!x.includes('not-an-active')),true);
 }finally{rmSync(work,{recursive:true,force:true});}
});
test('synthetic protected capture with real bare dynamic import remains BLOCKED and does not fetch arbitrary origin',()=>{
 const expected=EXPECTED.map((x,i)=>({...x,
  origin:'https://sellertray-'+x.surface+'-git-synthetic-vm-'+i+'.vercel.app',
  capture_evidence_ref:'offline-test-proof-'+i}));
 const privateDigests=Object.fromEntries(expected.map(x=>[
  x.id,createHash('sha256').update(x.id+'\n'+new URL(x.origin).hostname).digest('hex')
 ]));
 const plan={schema_version:1,purpose:'read-only-original-preview-capture',deployments:expected};
 const work=mkdtempSync(join(tmpdir(),'oa5-vm-audit-blocked-'));
 const paths=[];
 try{
  assert.throws(()=>captureOriginalPreviewPlan(plan,join(work,'private-originals'),url=>{
   const path=new URL(url).pathname;
   paths.push(path);
   if(path==='/')return Buffer.from('<html><script src="/assets/app.js"></script></html>');
   if(path==='/assets/app.js')return Buffer.from('import("a-real-dynamic-bare-dependency");export const value="https://'+TEST_REF+'.supabase.co";');
   throw Error('Unexpected external request in mock');
  },new Date('2026-11-10T00:00:00Z'),privateDigests),/BLOCKED/);
  assert.deepEqual(paths,['/','/assets/app.js']);
 }finally{rmSync(work,{recursive:true,force:true});}
});
