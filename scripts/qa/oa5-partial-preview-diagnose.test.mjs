import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {TEST_REF,PROD_REF} from './oa5-historical-preview-bundle-inspection.mjs';
import {diagnosePartialPreview,diagnoseSavedPreviewHTML} from './oa5-partial-preview-diagnose.mjs';
import {classifyUnsupportedImport} from './oa5-preview-module-graph.mjs';

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
 assert.equal(r.rejected_import_shape_counts.remote_http,1);
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

test('rejected JS import shape classifier never emits a secret-bearing URL, bare package or path',()=>{
 const fixtures=[
  ['https://private.example.invalid/token?api_key=secret','remote_http'],
  ['//private.example.invalid/secret.js','protocol_relative'],
  ['data:text/javascript,secret','other_scheme'],
  ['@secret/package','bare_specifier'],
  ['passwords/private-package','bare_specifier'],
  ['../outside/../../../private.js','invalid_or_outside_local_path'],
  ['./secret\\.js','unsafe_local_path'],
  ['./secret.css','non_js_local_target'],
  ['./invalid%ZZ.js','malformed_encoded_path'],
  [' ','malformed']
 ];
 for(const [raw,expected] of fixtures){
  const kind=classifyUnsupportedImport(raw);
  assert.equal(kind,expected,raw);
  assert.equal(kind.includes('secret'),false);
  assert.equal(kind.includes('private'),false);
  assert.equal(kind.includes('example'),false);
 }
});
test('partial original capture classifies a bare module without disclosing package name',()=>withPrivateFixture(({root,first,assets})=>{
 const packageName='extremely-private-test-package';
 writeFileSync(join(first,'index.html'),'<html><script src="/assets/a.js"></script></html>');
 writeFileSync(join(assets,'a.js'),'import "'+packageName+'";console.log("safe")');
 const r=diagnosePartialPreview(root);
 assert.equal(r.unsupported_or_remote_imports,1);
 assert.equal(r.rejected_import_shape_counts.bare_specifier,1);
 assert.equal(r.failure_stage_inferred,'UNSUPPORTED_IMPORT_PRESENT');
 assert.equal(JSON.stringify(r).includes(packageName),false);
}));

test('V8 offline module parser separates real static bare imports from regex hits in comments and strings',()=>withPrivateFixture(({root,first,assets})=>{
 writeFileSync(join(first,'index.html'),'<html><script type="module" src="/assets/app.js"></script></html>');
 writeFileSync(join(assets,'app.js'),[
   "import 'actual-bare-package';",
   "const text = 'import \"fake-package\"';",
   "// import 'another-fake-package'",
   "import './another.js';",
   'export const configured="https://'+TEST_REF+'.supabase.co";'
 ].join('\n'));
 writeFileSync(join(assets,'another.js'),'export const value=3;');
 const bin=new URL('./oa5-partial-preview-diagnose.mjs',import.meta.url).pathname;
 const proc=spawnSync(process.execPath,['--experimental-vm-modules',bin,'--check',root],{encoding:'utf8'});
 assert.equal(proc.status,0,proc.stderr);
 const report=JSON.parse(proc.stdout.split('\nNOT VERIFIED:')[0]);
 assert.equal(report.static_module_parser_available,true);
 assert.equal(report.static_module_files_parsed,2);
 assert.equal(report.static_module_parse_errors,0);
 assert.equal(report.proven_static_bare_imports,1);
 assert.equal(report.proven_static_local_imports,1);
 assert.equal(report.proven_static_external_imports,0);
 assert.equal(report.hosted_compiled_bundle_accepted,false);
 assert.equal(report.destructive_execution_authorized,false);
 for(const str of ['actual-bare-package','fake-package','another-fake-package',TEST_REF,root]){
  assert.equal(proc.stdout.includes(str),false,str);
 }
}));
test('V8 parser treats captured dynamic import as non-static; cannot excuse unsupported literal',()=>withPrivateFixture(({root,first,assets})=>{
 writeFileSync(join(first,'index.html'),'<html><script type="module" src="/assets/app.js"></script></html>');
 writeFileSync(join(assets,'app.js'),"const fetchModule=()=>import('private-dynamic-package');");
 const bin=new URL('./oa5-partial-preview-diagnose.mjs',import.meta.url).pathname;
 const proc=spawnSync(process.execPath,['--experimental-vm-modules',bin,'--check',root],{encoding:'utf8'});
 assert.equal(proc.status,0,proc.stderr);
 const report=JSON.parse(proc.stdout.split('\nNOT VERIFIED:')[0]);
 assert.equal(report.proven_static_bare_imports,0);
 assert.equal(report.static_module_files_parsed,1);
 assert.equal(report.rejected_import_shape_counts.bare_specifier,1);
 assert.equal(report.failure_stage_inferred,'UNSUPPORTED_IMPORT_PRESENT');
 assert.equal(report.hosted_compiled_bundle_accepted,false);
 assert.equal(proc.stdout.includes('private-dynamic-package'),false);
}));
test('V8 parser errors never print the private JS syntax or weaken blocked capture',()=>withPrivateFixture(({root,first,assets})=>{
 writeFileSync(join(first,'index.html'),'<html><script type="module" src="/assets/app.js"></script></html>');
 writeFileSync(join(assets,'app.js'),"import { secretMarker from 'private-broken-package';");
 const bin=new URL('./oa5-partial-preview-diagnose.mjs',import.meta.url).pathname;
 const proc=spawnSync(process.execPath,['--experimental-vm-modules',bin,'--check',root],{encoding:'utf8'});
 assert.equal(proc.status,0,proc.stderr);
 const report=JSON.parse(proc.stdout.split('\nNOT VERIFIED:')[0]);
 assert.equal(report.static_module_files_parsed,0);
 assert.equal(report.static_module_parse_errors,1);
 assert.equal(report.original_vercel_origin_attested,false);
 assert.equal(report.hosted_compiled_bundle_accepted,false);
 assert.equal(proc.stdout.includes('secretMarker'),false);
 assert.equal(proc.stdout.includes('private-broken-package'),false);
}));

test('saved admin capture_2 HTML counts local JS and remote scripts without revealing URL or source',()=>withPrivateFixture(({root})=>{
 const dir=join(root,'capture_2');
 const secret='protected-admin-script-secret';
 mkdirSync(join(dir,'assets'),{recursive:true});
 writeFileSync(join(dir,'index.html'),'<html>'+
  '<script type="module" src="/assets/admin.js"></script>'+
  '<script src="https://third-party.invalid/'+secret+'.js?auth=private"></script>'+
  '<script>window.important="do not print"</script></html>');
 writeFileSync(join(dir,'assets','admin.js'),'export const x="private JS never prints"');
 const report=diagnoseSavedPreviewHTML(root,2);
 assert.equal(report.capture_index,2);
 assert.equal(report.capture_directory_present,true);
 assert.equal(report.root_html_present,true);
 assert.equal(report.html_script_src_count,2);
 assert.equal(report.html_script_without_src_count,1);
 assert.equal(report.safe_local_js_src_count,1);
 assert.equal(report.safe_local_js_already_saved_count,1);
 assert.equal(report.unsafe_or_nonlocal_src_count,1);
 assert.equal(report.query_or_fragment_src_count,1);
 assert.equal(report.src_shape_counts.absolute_https_other,1);
 assert.equal(report.src_shape_counts.root_relative_js,1);
 assert.equal(report.html_entrypoint_gate_passed,false);
 assert.equal(report.original_source_accepted,false);
 assert.equal(report.hosted_compiled_bundle_accepted,false);
 assert.equal(report.destructive_execution_authorized,false);
 for(const secretPart of [secret,'third-party.invalid','do not print','private JS never prints',root]){
  assert.equal(JSON.stringify(report).includes(secretPart),false);
 }
}));
test('saved HTML categorizes immutable Vercel suffix and root, relative, and non-JS refs without accepting them',()=>withPrivateFixture(({root})=>{
 const dir=join(root,'capture_2');
 mkdirSync(dir);
 writeFileSync(join(dir,'index.html'),[
  '<html>',
  '<script src="https://sellertray-admin-git-private.vercel.app/assets/script.js"></script>',
  '<script src="https://sellertray-admin-git-private.vercel.app.evil.invalid/evil.js"></script>',
  '<script src="//hidden.example.invalid/script.js"></script>',
  '<script src="http://hidden.example.invalid/script.js"></script>',
  '<script src="data:application/javascript,private"></script>',
  '<script src="./relative.mjs"></script>',
  '<script src="app.js"></script>',
  '<script src="/assets/app.css"></script>',
  '</html>'
 ].join(''));
 const report=diagnoseSavedPreviewHTML(root,2);
 assert.equal(report.src_shape_counts.absolute_https_vercel_app,1);
 assert.equal(report.src_shape_counts.absolute_https_other,1);
 assert.equal(report.src_shape_counts.protocol_relative,1);
 assert.equal(report.src_shape_counts.absolute_http,1);
 assert.equal(report.src_shape_counts.other_scheme,1);
 assert.equal(report.src_shape_counts.dot_relative_js,1);
 assert.equal(report.src_shape_counts.bare_relative_js,1);
 assert.equal(report.src_shape_counts.non_js_target,1);
 assert.equal(report.safe_local_js_src_count,2);
 assert.equal(report.unsafe_or_nonlocal_src_count,6);
 assert.equal(report.html_entrypoint_gate_passed,false);
}));
test('offline admin HTML CLI emits only whitelisted counts and never the original script src',()=>withPrivateFixture(({root})=>{
 const dir=join(root,'capture_2');
 mkdirSync(dir);
 const secret='secret-query-never-print';
 writeFileSync(join(dir,'index.html'),'<html><script src="https://private.example.invalid/script.js?'+secret+'"></script></html>');
 const bin=new URL('./oa5-partial-preview-diagnose.mjs',import.meta.url).pathname;
 const proc=spawnSync(process.execPath,[bin,'--check-html',root,'2'],{encoding:'utf8'});
 assert.equal(proc.status,0,proc.stderr);
 const report=JSON.parse(proc.stdout.split('\nNOT VERIFIED:')[0]);
 assert.equal(report.capture_index,2);
 assert.equal(report.src_shape_counts.absolute_https_other,1);
 assert.equal(proc.stdout.includes(secret),false);
 assert.equal(proc.stdout.includes('private.example.invalid'),false);
 assert.equal(proc.stdout.includes(root),false);
 assert.match(proc.stdout,/NOT AUTHORIZED:/);
}));
test('offline admin HTML CLI rejects unsafe or absent private source without printing its path',()=>withPrivateFixture(({root})=>{
 const dir=join(root,'capture_2');
 mkdirSync(dir);
 symlinkSync(join(root,'capture_0','index.html'),join(dir,'index.html'),'file');
 const bin=new URL('./oa5-partial-preview-diagnose.mjs',import.meta.url).pathname;
 const proc=spawnSync(process.execPath,[bin,'--check-html',root,'2'],{encoding:'utf8'});
 assert.equal(proc.status,1);
 assert.match(proc.stderr,/BLOCKED:/);
 assert.equal(proc.stderr.includes(root),false);
 for(const value of ['-1','5','./2','2;evil']){
  const bad=spawnSync(process.execPath,[bin,'--check-html',root,value],{encoding:'utf8'});
  assert.equal(bad.status,1,value);
  assert.equal(bad.stderr.includes(root),false);
 }
}));
