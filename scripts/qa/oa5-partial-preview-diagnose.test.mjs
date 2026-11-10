import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {TEST_REF,PROD_REF} from './oa5-historical-preview-bundle-inspection.mjs';
import {diagnosePartialPreview} from './oa5-partial-preview-diagnose.mjs';

function withPrivateFixture(run){
 const root=mkdtempSync(join(tmpdir(),'oa5-partial-inspect-'));
 try{
  const first=join(root,'capture_0');
  mkdirSync(join(first,'assets'),{recursive:true});
  return run({root,first,assets:join(first,'assets')});
 }finally{rmSync(root,{recursive:true,force:true});}
}
test('reported state of capture_0 HTML plus two JS gives only count-based partial graph signals',()=>withPrivateFixture(({root,first,assets})=>{
 writeFileSync(join(first,'index.html'),'<html><script type="module" src="/assets/index.js"></script></html>');
 writeFileSync(join(assets,'index.js'),'import "./vendor.js";import "./missing.js";export const x="https://'+TEST_REF+'.supabase.co";');
 writeFileSync(join(assets,'vendor.js'),'export const count=123;');
 const r=diagnosePartialPreview(root);
 assert.equal(r.capture_0_exists,true);
 assert.equal(r.root_html_exists,true);
 assert.equal(r.saved_js_files,2);
 assert.equal(r.html_script_entries,1);
 assert.equal(r.html_entries_missing_or_unsafe,0);
 assert.equal(r.scanned_literal_js_imports,2);
 assert.equal(r.local_imports_already_saved,1);
 assert.equal(r.local_imports_missing_from_capture,1);
 assert.equal(r.unsupported_or_remote_imports,0);
 assert.equal(r.saved_js_with_test_ref,1);
 assert.equal(r.saved_js_with_production_ref,0);
 assert.equal(r.failure_stage_inferred,'LOCAL_JS_IMPORT_NOT_CAPTURED');
 assert.equal(r.original_vercel_origin_attested,false);
 assert.equal(r.authorized_reviewer_verified,false);
 assert.equal(r.hosted_compiled_bundle_accepted,false);
 assert.equal(r.destructive_execution_authorized,false);
 assert.equal(JSON.stringify(r).includes('index.js'),false);
 assert.equal(JSON.stringify(r).includes(TEST_REF),false);
 assert.equal(JSON.stringify(r).includes('vendor'),false);
}));
test('unknown remote/computed-style imported URL is counted, never fetched or revealed',()=>withPrivateFixture(({root,first,assets})=>{
 writeFileSync(join(first,'index.html'),'<html><script src="/assets/a.js"></script></html>');
 writeFileSync(join(assets,'a.js'),'import "https://secret.external.invalid/lib.js";export const x=1;');
 const r=diagnosePartialPreview(root);
 assert.equal(r.unsupported_or_remote_imports,1);
 assert.equal(r.failure_stage_inferred,'UNSUPPORTED_IMPORT_PRESENT');
 assert.equal(JSON.stringify(r).includes('secret.external.invalid'),false);
}));
test('an HTML entrypoint not yet downloaded is distinguishable without exposing its filename',()=>withPrivateFixture(({root,first})=>{
 writeFileSync(join(first,'index.html'),'<html><script type="module" src="/assets/missing.js"></script></html>');
 const r=diagnosePartialPreview(root);
 assert.equal(r.html_entries_missing_or_unsafe,1);
 assert.equal(r.saved_js_files,0);
 assert.equal(r.failure_stage_inferred,'HTML_JS_ENTRY_NOT_CAPTURED_OR_UNSAFE');
 assert.equal(JSON.stringify(r).includes('missing.js'),false);
}));
test('no initial HTML safely returns a bounded absence code',()=>withPrivateFixture(({root})=>{
 const r=diagnosePartialPreview(root);
 assert.equal(r.root_html_exists,false);
 assert.equal(r.failure_stage_inferred,'ROOT_HTML_NOT_SAVED');
 assert.equal(r.original_vercel_origin_attested,false);
}));
test('saved Production ref becomes boolean/count only, never accepted',()=>withPrivateFixture(({root,first,assets})=>{
 writeFileSync(join(first,'index.html'),'<html><script src="/assets/a.js"></script></html>');
 writeFileSync(join(assets,'a.js'),'console.log("https://'+PROD_REF+'.supabase.co")');
 const r=diagnosePartialPreview(root);
 assert.equal(r.saved_js_with_production_ref,1);
 assert.equal(r.hosted_compiled_bundle_accepted,false);
 assert.equal(JSON.stringify(r).includes(PROD_REF),false);
}));
test('symbolic links in partial capture fail closed',()=>withPrivateFixture(({root,first,assets})=>{
 writeFileSync(join(first,'index.html'),'<html><script src="/assets/a.js"></script></html>');
 symlinkSync(join(first,'index.html'),join(assets,'a.js'));
 assert.throws(()=>diagnosePartialPreview(root),/BLOCKED/);
}));
test('a real CLI offline inspection prints only bounded counts and no secret source string',()=>withPrivateFixture(({root,first,assets})=>{
 const secret='VERY_PRIVATE_CAPTURE_TOKEN_DO_NOT_PRINT';
 writeFileSync(join(first,'index.html'),'<html><script src="/assets/a.js"></script></html>');
 writeFileSync(join(assets,'a.js'),'export const secret="'+secret+'";');
 const bin=new URL('./oa5-partial-preview-diagnose.mjs',import.meta.url).pathname;
 const r=spawnSync(process.execPath,[bin,'--check',root],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
 const report=JSON.parse(r.stdout.split('\nNOT VERIFIED:')[0]);
 assert.equal(report.saved_js_files,1);
 assert.equal(report.failure_stage_inferred,'NO_OBVIOUS_UNRESOLVED_REFERENCE_IN_SAVED_FILES');
 assert.equal(r.stdout.includes(secret),false);
 assert.equal(r.stdout.includes(root),false);
 assert.match(r.stdout,/NOT AUTHORIZED:/);
}));
test('CLI rejects missing or unexpected flags without reading provider data',()=>{
 const bin=new URL('./oa5-partial-preview-diagnose.mjs',import.meta.url).pathname;
 for(const args of [['--capture','anything'],['--check'],['--check','/this-private-root-does-not-exist']]){
  const r=spawnSync(process.execPath,[bin,...args],{encoding:'utf8'});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/(Usage:|BLOCKED:)/);
 }
});
