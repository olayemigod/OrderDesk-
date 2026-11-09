#!/usr/bin/env node
/**
 * OA5 five historical Preview compiled-asset content inspection.
 * OFFLINE ONLY. The operator privately captures served HTML + JS; this checker
 * cannot verify browser origin, completeness, authorization or provider routing.
 * No network requests, deployment actions or secrets ever accepted or output.
 */
import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {resolve,join,relative,isAbsolute,sep,extname,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const TEST_REF='iukgsukdoowvnhlfmpml';
export const PROD_REF='eujxswjspolugrzlsjnn';
export const EXPECTED=Object.freeze([
 Object.freeze({id:'dpl_Cfh7oAt9nHQkdUZtbXShj7jfhMfw',sha:'3f0df8f16455572cd0d1c079a3ac2327cc5bcd88',surface:'merchant'}),
 Object.freeze({id:'dpl_Gh9s6Rm2dJibEKuBDDcm7jZ3bGmz',sha:'bbee34e999971b5c87e7274428ee655e4ff36d4d',surface:'merchant'}),
 Object.freeze({id:'dpl_5UfqxbGpPuQqGkSu1rU4bpCFrQWZ',sha:'7ba66274068ee75a2341a9adcccde338b1545f90',surface:'admin'}),
 Object.freeze({id:'dpl_H1suGYapnAjZR9rAKBq8WLtHu5Uo',sha:'3f0df8f16455572cd0d1c079a3ac2327cc5bcd88',surface:'admin'}),
 Object.freeze({id:'dpl_J9nL3wiNKyXcJEoVjbb65kUw4JnA',sha:'3c6e338ef7743c270023e791034c321294c70e6f',surface:'admin'}),
]);
const MAX_FILES=2000,MAX_BYTES=80*1024*1024;
const own=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join('|')===[...keys].sort().join('|');
const goodRef=x=>typeof x==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$/.test(x);
const allowDir=x=>typeof x==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_/-]*$/.test(x)&&
 !isAbsolute(x)&&x.split('/').every(seg=>seg!=='.'&&seg!=='..'&&seg!=='');
function contentFiles(root,subdir){
 const dir=resolve(root,subdir),base=resolve(root);
 if(dir===base||!dir.startsWith(base+sep))throw Error('Capture directory outside private root');
 const files=[];let total=0;
 function walk(p){
   if(files.length>=MAX_FILES)throw Error('Too many capture files');
   const st=lstatSync(p);
   if(st.isSymbolicLink())throw Error('Symlink in captured artifacts');
   if(st.isDirectory()){
     for(const item of readdirSync(p))walk(join(p,item));
     return;
   }
   if(!st.isFile())throw Error('Unsupported capture node');
   total+=st.size;
   if(total>MAX_BYTES)throw Error('Capture too large');
   files.push({path:p,type:extname(p).toLowerCase(),relative:relative(dir,p).replaceAll('\\','/')});
 }
 walk(dir);
 return files;
}
export function inspectPreviewBundleCapture(manifest,root,now=new Date()){
 const errors=[],details=[];
 const outcome=()=>({
   content_consistent_with_test:errors.length===0,
   historical_artifact_origin_verified:false,
   hosted_compiled_bundle_accepted:false,
   destructive_execution_authorized:false,
   errors,details,
 });
 if(!own(manifest,['schema_version','scope','captured_at_utc','deployments'])||
    manifest.schema_version!==1||manifest.scope!=='historical-preview-bundle-content-only'){
   errors.push('Missing or invalid private compiled-asset review manifest');
   return outcome();
 }
 const ts=typeof manifest.captured_at_utc==='string'&&
 /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(manifest.captured_at_utc)
 ?Date.parse(manifest.captured_at_utc):NaN;
 if(!Number.isFinite(ts)||ts>now.getTime())errors.push('Invalid/future capture timestamp');
 if(!Array.isArray(manifest.deployments)||manifest.deployments.length!==EXPECTED.length){
   errors.push('Exactly five original historical deployments required');
   return outcome();
 }
 const seen=new Set(),dirs=new Set();
 for(const entry of manifest.deployments){
   if(!own(entry,['id','sha','surface','directory','capture_evidence_ref'])){
     errors.push('Malformed or secret-bearing historical deployment record');continue;
   }
   const want=EXPECTED.find(w=>w.id===entry.id);
   if(!want||seen.has(entry.id)||want.sha!==entry.sha||want.surface!==entry.surface){
     errors.push('Unrecognized, duplicated or mismatched historical deployment identity');continue;
   }
   seen.add(entry.id);
   if(!allowDir(entry.directory)||dirs.has(entry.directory)||!goodRef(entry.capture_evidence_ref)){
     errors.push('Unsafe, duplicated or unreviewed private capture directory');continue;
   }
   dirs.add(entry.directory);
   let files;
   try{files=contentFiles(root,entry.directory);}
   catch{errors.push('Missing/unsafe/incomplete private artifact tree: '+entry.id);continue;}
   const textFiles=files.filter(x=>['.html','.js','.mjs'].includes(x.type));
   const byRelative=new Map(files.map(file=>[file.relative,file]));
   if(!byRelative.has('index.html')) {
     errors.push('Historical capture missing original root index.html: '+entry.id);continue;
   }
   if(!textFiles.some(x=>x.type==='.html')||!textFiles.some(x=>x.type==='.js')){
     errors.push('Historical capture requires HTML and compiled JS: '+entry.id);continue;
   }
   // Ensure a Test string in an unrelated captured file cannot satisfy this gate.
   // The operator must still independently prove original deployment provenance.
   const linkedScripts=new Set();
   const scriptPath=(htmlFile,raw)=>{
     if(typeof raw!=='string'||!raw||/^(?:https?:)?\/\//i.test(raw)
       ||raw.startsWith('data:')||raw.startsWith('javascript:'))return null;
     let decoded;
     try{decoded=decodeURIComponent(raw.split(/[?#]/)[0]);}catch{return null;}
     if(!decoded||decoded.includes('\\')||decoded.includes('\0'))return null;
     const rel=decoded.startsWith('/')?decoded.slice(1):join(dirname(htmlFile.relative),decoded);
     const normalized=rel.replaceAll('\\','/');
     if(!normalized||normalized.startsWith('../')||normalized==='..'||isAbsolute(normalized))return null;
     return normalized.replace(/^\.\//,'');
   };
   for(const page of textFiles.filter(f=>f.type==='.html')){
     let html;
     try{html=readFileSync(page.path,'utf8');}
     catch{errors.push('Unreadable original HTML: '+entry.id);continue;}
     for(const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>/gi)){
       const linked=scriptPath(page,m[1]??m[2]);
       if(!linked||!byRelative.has(linked)||!['.js','.mjs'].includes(byRelative.get(linked).type))
         errors.push('Historical HTML references absent/unsafe compiled script: '+entry.id);
       else linkedScripts.add(linked);
     }
   }
   if(linkedScripts.size===0)errors.push('Historical page has no captured linked JavaScript entrypoint: '+entry.id);
   let matchedTest=0,matchedTestJS=0,linkedTest=0,matchedOther=0,production=false, unreadable=false;
   for(const f of textFiles){
     let t;
     try{t=readFileSync(f.path,'utf8');}
     catch{unreadable=true;break;}
     if(t.includes(TEST_REF)){
       matchedTest++;
       if(f.type==='.js'||f.type==='.mjs')matchedTestJS++;
       if(linkedScripts.has(f.relative))linkedTest++;
     }
     if(t.includes(PROD_REF))production=true;
     // Unrecognized Supabase project URLs must not be treated as Test.
     const urls=t.matchAll(/https?:\/\/([a-z0-9]{20})\.supabase\.co\b/g);
     for(const m of urls)if(m[1]!==TEST_REF)matchedOther++;
   }
   if(unreadable)errors.push('Unreadable compiled text asset: '+entry.id);
   if(!matchedTest||!matchedTestJS)errors.push('Test backend project ref not visible in compiled JavaScript: '+entry.id);
   if(!linkedTest)errors.push('Test backend project ref not visible in an HTML-linked entrypoint: '+entry.id);
   if(production)errors.push('Production project ref found in historical compiled capture: '+entry.id);
   if(matchedOther)errors.push('Unexpected Supabase project URL in compiled capture: '+entry.id);
   details.push({id:entry.id,surface:entry.surface,scanned_files:files.length,compiled_text_files:textFiles.length,
      test_ref_file_count:matchedTest,html_linked_entrypoints:linkedScripts.size,linked_test_entrypoints:linkedTest,
      contains_production_ref:production});
 }
 if(seen.size!==EXPECTED.length)errors.push('Incomplete historical deployment roster');
 return outcome();
}
function main(){
 if(process.argv.length!==5||process.argv[2]!=='--check'){
  console.error('Usage: node scripts/qa/oa5-historical-preview-bundle-inspection.mjs --check <private-capture-manifest.json> <private-artifact-root>');
  process.exitCode=2;return;
 }
 let manifest;
 try{manifest=JSON.parse(readFileSync(resolve(process.argv[3]),'utf8'));}
 catch{console.error('BLOCKED: private capture manifest unavailable');process.exitCode=1;return;}
 const out=inspectPreviewBundleCapture(manifest,resolve(process.argv[4]));
 if(!out.content_consistent_with_test){
  console.error('BLOCKED: private historical compiled assets are not content-consistent with Test:');
  for(const error of out.errors)console.error(' - '+error);
  process.exitCode=1;return;
 }
 console.log('PASS: supplied historical HTML/JS content contains only the expected Test Supabase project identity.');
 console.log('NOT VERIFIED: original Vercel artifact provenance, complete loaded chunks, authorized reviewer access, hosted backend, or Test reset permission.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
