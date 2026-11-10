#!/usr/bin/env node
/**
 * Offline partial-preview diagnosis after a FAILED original protected capture.
 *
 * Never fetches URLs, calls the Vercel CLI, changes data, or prints original
 * compiled assets, file paths, access tokens, Supabase keys or URL values.
 * Counts only local captured HTML/JS references, so it cannot explain a
 * failed HTTP request that occurred after the last saved file.
 */
import {existsSync,lstatSync,readdirSync,readFileSync} from 'node:fs';
import {resolve,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as vm from 'node:vm';
import {htmlScripts,importedLiterals,localPath,classifyUnsupportedImport} from './oa5-preview-module-graph.mjs';
import {TEST_REF,PROD_REF} from './oa5-historical-preview-bundle-inspection.mjs';

const MAX_FILES=2000,MAX_BYTES=80*1024*1024,MAX_JS_BYTES=12*1024*1024;
const NO_AUTH=Object.freeze({
 original_vercel_origin_attested:false,
 authorized_reviewer_verified:false,
 hosted_compiled_bundle_accepted:false,
 destructive_execution_authorized:false,
});

export function diagnosePartialPreview(root){
 const output={...NO_AUTH,
  capture_0_exists:false,
  root_html_exists:false,
  saved_js_files:0,
  html_script_entries:0,
  html_entries_missing_or_unsafe:0,
  scanned_literal_js_imports:0,
  local_imports_already_saved:0,
  local_imports_missing_from_capture:0,
  unsupported_or_remote_imports:0,
  // Parse-only V8 module syntax proof is optional and requires
  // --experimental-vm-modules. Construction NEVER links or evaluates code.
  static_module_parser_available:typeof vm.SourceTextModule==='function',
  static_module_files_parsed:0,
  static_module_parse_errors:0,
  proven_static_bare_imports:0,
  proven_static_local_imports:0,
  proven_static_external_imports:0,
  rejected_import_shape_counts:{
   remote_http:0,protocol_relative:0,other_scheme:0,bare_specifier:0,
   unsafe_local_path:0,malformed:0,malformed_encoded_path:0,
   non_js_local_target:0,invalid_or_outside_local_path:0
  },
  saved_js_with_test_ref:0,
  saved_js_with_production_ref:0,
  failure_stage_inferred:'INDETERMINATE',
  incomplete_capture:true
 };
 const base=resolve(root);
 const first=join(base,'capture_0');
 if(!existsSync(first))return output;
 if(lstatSync(first).isSymbolicLink()||!lstatSync(first).isDirectory())
  throw Error('BLOCKED: private capture_0 is not a normal directory');
 output.capture_0_exists=true;
 const files=[];let total=0;
 function walk(at){
  if(files.length>=MAX_FILES)throw Error('BLOCKED: private capture file count limit');
  const st=lstatSync(at);
  if(st.isSymbolicLink())throw Error('BLOCKED: private capture contains a symlink');
  if(st.isDirectory()){
   for(const name of readdirSync(at))walk(join(at,name));
   return;
  }
  if(!st.isFile())throw Error('BLOCKED: unsupported private capture node');
  total+=st.size;
  if(total>MAX_BYTES||st.size>MAX_JS_BYTES)
   throw Error('BLOCKED: private capture file size limit');
  const rel=relative(first,at).replaceAll('\\','/');
  if(!rel||rel==='..'||rel.startsWith('../')||rel.startsWith('/'))
   throw Error('BLOCKED: unsafe private capture relative path');
  files.push({rel,path:at});
 }
 walk(first);
 const map=new Map(files.map(f=>[f.rel,f]));
 const js=files.filter(f=>/\.(?:js|mjs)$/i.test(f.rel));
 output.saved_js_files=js.length;
 const html=map.get('index.html');
 if(!html){
  output.failure_stage_inferred='ROOT_HTML_NOT_SAVED';
  return output;
 }
 output.root_html_exists=true;
 const htmlText=readFileSync(html.path,'utf8');
 const srcs=htmlScripts(htmlText);
 output.html_script_entries=srcs.length;
 for(const raw of srcs){
  const rel=localPath('index.html',raw,true);
  if(!rel||!map.has(rel))output.html_entries_missing_or_unsafe++;
 }
 for(const file of js){
  const text=readFileSync(file.path,'utf8');
  if(text.includes(TEST_REF))output.saved_js_with_test_ref++;
  if(text.includes(PROD_REF))output.saved_js_with_production_ref++;
  // The existing regex intentionally errs on the side of blocking potential
  // imports, but can match comments and strings. V8 can independently prove
  // actual *static* module imports/exports without executing captured code.
  if(output.static_module_parser_available){
   try{
    const mod=new vm.SourceTextModule(text,{identifier:'untrusted-captured-js'});
    output.static_module_files_parsed++;
    for(const dep of mod.dependencySpecifiers){
     const shape=classifyUnsupportedImport(dep);
     if(shape==='bare_specifier')output.proven_static_bare_imports++;
     else if(dep.startsWith('./')||dep.startsWith('../')||dep.startsWith('/'))
      output.proven_static_local_imports++;
     else output.proven_static_external_imports++;
    }
   }catch{
    output.static_module_parse_errors++;
   }
  }
  for(const raw of importedLiterals(text)){
   output.scanned_literal_js_imports++;
   const target=localPath(file.rel,raw,false);
   if(!target){
    output.unsupported_or_remote_imports++;
    const reason=classifyUnsupportedImport(raw);
    output.rejected_import_shape_counts[reason]++;
    continue;
   }
   if(map.has(target))output.local_imports_already_saved++;
   else output.local_imports_missing_from_capture++;
  }
 }
 if(output.html_entries_missing_or_unsafe>0)
  output.failure_stage_inferred='HTML_JS_ENTRY_NOT_CAPTURED_OR_UNSAFE';
 else if(output.unsupported_or_remote_imports>0)
  output.failure_stage_inferred='UNSUPPORTED_IMPORT_PRESENT';
 else if(output.local_imports_missing_from_capture>0)
  output.failure_stage_inferred='LOCAL_JS_IMPORT_NOT_CAPTURED';
 else if(output.saved_js_files>0)
  output.failure_stage_inferred='NO_OBVIOUS_UNRESOLVED_REFERENCE_IN_SAVED_FILES';
 else
  output.failure_stage_inferred='ROOT_HTML_ONLY';
 return output;
}
function main(){
 if(process.argv.length!==4||process.argv[2]!=='--check'){
  console.error('Usage: node scripts/qa/oa5-partial-preview-diagnose.mjs --check <existing-private-capture-root>');
  process.exitCode=2;return;
 }
 try{
  const root=resolve(process.argv[3]);
  // Only read an existing local folder, never create it or fetch files.
  if(!existsSync(root)||!lstatSync(root).isDirectory()||lstatSync(root).isSymbolicLink())
   throw Error('BLOCKED: private capture root missing or unsafe');
  const result=diagnosePartialPreview(root);
  console.log(JSON.stringify(result,null,2));
  console.log('NOT VERIFIED: failure cause, original compiled origin, historical reviewer access.');
  console.log('NOT AUTHORIZED: no remote retry, hosted change, cron pause or Test reset.');
 }catch{
  console.error('BLOCKED: private capture cannot be inspected safely; original files and paths were not printed.');
  process.exitCode=1;
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
