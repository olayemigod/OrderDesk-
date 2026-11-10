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
import {htmlScripts,importedLiterals,localPath,classifyUnsupportedImport,VERCEL_TOOLBAR_SCRIPT} from './oa5-preview-module-graph.mjs';
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

/**
 * Inspect an existing failed capture's HTML script sources, not its JS.
 * Reports only bounded counts/types; never original src attributes, hosts,
 * file paths, HTML, credentials or compiled bytes. Does not fetch or write.
 */
export function diagnoseSavedPreviewHTML(root,index){
 if(!Number.isInteger(index)||index<0||index>4)
  throw Error('BLOCKED: original capture index must be 0..4');
 const result={...NO_AUTH,capture_index:index,
  capture_directory_present:false,root_html_present:false,
  html_script_src_count:0,html_script_without_src_count:0,
  safe_local_js_src_count:0,safe_local_js_already_saved_count:0,
  unsafe_or_nonlocal_src_count:0,query_or_fragment_src_count:0,
  exact_vercel_toolbar_script_src_count:0,
  external_toolbar_runtime_attested:false,
  // Provider-family hints are not trust or authorization to fetch.
  outside_https_script_signals:{
   total:0,module_tags:0,classic_tags:0,async_tags:0,
   defer_tags:0,integrity_tags:0,crossorigin_tags:0,nonce_tags:0,
   exact_host_family_hints:{
    analytics_telemetry:0,payment_widget:0,captcha_security:0,
    unknown_or_other:0
   }
  },
  src_shape_counts:{
   root_relative_js:0,dot_relative_js:0,bare_relative_js:0,
   absolute_https_vercel_app:0,absolute_https_other:0,
   absolute_http:0,protocol_relative:0,other_scheme:0,
   non_js_target:0,unsafe_or_unclassified:0
  },
  original_source_accepted:false,
  html_entrypoint_gate_passed:false
 };
 const captureRoot=resolve(root);
 if(!existsSync(captureRoot)||lstatSync(captureRoot).isSymbolicLink()||
    !lstatSync(captureRoot).isDirectory())
  throw Error('BLOCKED: private capture root is not a normal existing directory');
 const dir=join(captureRoot,'capture_'+index);
 if(!existsSync(dir))return result;
 if(lstatSync(dir).isSymbolicLink()||!lstatSync(dir).isDirectory())
  throw Error('BLOCKED: partial capture directory is unsafe');
 result.capture_directory_present=true;
 const file=join(dir,'index.html');
 if(!existsSync(file))return result;
 const st=lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||st.size>2*1024*1024)
  throw Error('BLOCKED: partial HTML source is unsafe or oversized');
 result.root_html_present=true;
 const html=readFileSync(file,'utf8');
 const srcs=htmlScripts(html);
 result.html_script_src_count=srcs.length;
 result.html_script_without_src_count=Math.max(
  0,[...html.matchAll(/<script\b[^>]*>/gi)].length-srcs.length
 );
 for(const raw of srcs){
  if(typeof raw!=='string'||raw.length>4096){
   result.src_shape_counts.unsafe_or_unclassified++;
   result.unsafe_or_nonlocal_src_count++;
   continue;
  }
  if(/[?#]/.test(raw))result.query_or_fragment_src_count++;
  if(raw===VERCEL_TOOLBAR_SCRIPT)result.exact_vercel_toolbar_script_src_count++;
  const local=localPath('index.html',raw,true);
  if(local){
   result.safe_local_js_src_count++;
   const shape=raw.startsWith('/')?'root_relative_js':
    raw.startsWith('.')?'dot_relative_js':'bare_relative_js';
   result.src_shape_counts[shape]++;
   const asset=join(dir,...local.split('/'));
   if(existsSync(asset)){
    const as=lstatSync(asset);
    if(as.isFile()&&!as.isSymbolicLink())result.safe_local_js_already_saved_count++;
   }
   continue;
  }
  result.unsafe_or_nonlocal_src_count++;
  let kind='unsafe_or_unclassified';
  if(raw.startsWith('//'))kind='protocol_relative';
  else if(/^https?:\/\//i.test(raw)){
   try{
    const u=new URL(raw);
    if(u.protocol==='http:')kind='absolute_http';
    else if(u.protocol==='https:'){
     kind=/^[a-z0-9-]+\.vercel\.app$/.test(u.hostname)?
      'absolute_https_vercel_app':'absolute_https_other';
    }
   }catch{/* an invalid URL must stay unsafe */}
  }else if(/^[a-z][a-z0-9+.-]*:/i.test(raw))kind='other_scheme';
  else if(!/\.(?:m?js)(?:[?#].*)?$/i.test(raw))kind='non_js_target';
  result.src_shape_counts[kind]++;
 }
 // Report only bounded tag attribute counts and exact-host family hints.
 // Never report full src, host, path, URL, query, tokens, or script contents.
 const signal=result.outside_https_script_signals;
 for(const match of html.matchAll(/<script\b[^>]*>/gi)){
  const tag=match[0];
  const srcMatch=tag.match(/\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
  const src=srcMatch?.[1]??srcMatch?.[2];
  if(typeof src!=='string'||src.length>4096)continue;
  let host;
  try{
   const url=new URL(src);
   if(url.protocol!=='https:'||/^[a-z0-9-]+\.vercel\.app$/.test(url.hostname))
    continue;
   host=url.hostname;
  }catch{continue;}
  signal.total++;
  if(/\btype\s*=\s*(?:"module"|'module')/i.test(tag))
   signal.module_tags++;
  else signal.classic_tags++;
  if(/\sasync(?:\s|=|>)/i.test(tag))signal.async_tags++;
  if(/\sdefer(?:\s|=|>)/i.test(tag))signal.defer_tags++;
  if(/\bintegrity\s*=\s*["'][^"']+["']/i.test(tag))
   signal.integrity_tags++;
  if(/\bcrossorigin(?:\s|=|>)/i.test(tag))signal.crossorigin_tags++;
  if(/\bnonce\s*=\s*["'][^"']+["']/i.test(tag))signal.nonce_tags++;
  // Exact host comparison; a recognized family is NOT an allowlist.
  const family=[
   'www.googletagmanager.com','www.google-analytics.com',
   'static.cloudflareinsights.com','va.vercel-scripts.com'
  ].includes(host)?'analytics_telemetry':
   ['js.paystack.co','checkout.flutterwave.com',
    'js.stripe.com','checkout.paystack.com'].includes(host)?
    'payment_widget':
   ['www.google.com','www.recaptcha.net',
    'challenges.cloudflare.com','js.hcaptcha.com'].includes(host)?
    'captcha_security':'unknown_or_other';
  signal.exact_host_family_hints[family]++;
 }
 // These are diagnostic-only. A matching suffix is not origin proof.
 return result;
}

function main(){
 const [mode,privateRoot,indexRaw]=process.argv.slice(2);
 if((mode!=='--check'&&mode!=='--check-html')||
    (mode==='--check'&&process.argv.length!==4)||
    (mode==='--check-html'&&process.argv.length!==5)){
  console.error('Usage: node scripts/qa/oa5-partial-preview-diagnose.mjs --check <existing-private-capture-root> | --check-html <existing-private-capture-root> <capture-index 0..4>');
  process.exitCode=2;return;
 }
 try{
  const root=resolve(privateRoot);
  // Only read existing local files, never create them or contact a provider.
  if(!existsSync(root)||!lstatSync(root).isDirectory()||lstatSync(root).isSymbolicLink())
   throw Error('BLOCKED: private capture root missing or unsafe');
  let result;
  if(mode==='--check-html'){
   if(!/^[0-4]$/.test(indexRaw))throw Error('BLOCKED: invalid original capture index');
   result=diagnoseSavedPreviewHTML(root,Number(indexRaw));
  }else result=diagnosePartialPreview(root);
  console.log(JSON.stringify(result,null,2));
  console.log('NOT VERIFIED: original HTML script origin, historical reviewer access or full compiled content.');
  console.log('NOT AUTHORIZED: no external asset fetch, remote retry, hosted change, cron pause or Test reset.');
 }catch{
  console.error('BLOCKED: private capture cannot be inspected safely; original HTML, URLs and local paths were not printed.');
  process.exitCode=1;
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
