#!/usr/bin/env node
/**
 * Offline independent integrity check of a previously finished private OA5
 * historical Preview capture. No network, Vercel CLI, write, or execution of
 * downloaded scripts. No private URL, HTML, JS, token, path or SHA is printed.
 *
 * A valid local file inventory still does not attest browser origin,
 * historical reviewer authorization, external Vercel Toolbar runtime,
 * dynamic loaded chunks or permission for hosted Test operations.
 */
import {readFileSync,readdirSync,lstatSync,existsSync} from 'node:fs';
import {resolve,join,relative,posix} from 'node:path';
import {createHash} from 'node:crypto';
import * as vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {EXPECTED,inspectPreviewBundleCapture} from './oa5-historical-preview-bundle-inspection.mjs';

const MAX_FILES=2000,MAX_BYTES=80*1024*1024,MAX_ITEM=12*1024*1024;
const own=(obj,keys)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&
 Object.keys(obj).sort().join('|')===[...keys].sort().join('|');
const HEX=/^[0-9a-f]{64}$/;
const safeFile=(name)=>{
 if(typeof name!=='string'||name.length>300||name.includes('\\')||
    name.includes('?')||name.includes('#')||name.startsWith('/')||
    !/^[A-Za-z0-9_.\/-]+$/.test(name))return false;
 const parts=name.split('/');
 if(parts.some(x=>!x||x==='.'||x==='..')||posix.normalize(name)!==name)
  return false;
 return name==='index.html'||/\.(?:js|mjs)$/.test(name);
};
const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
export function checkPrivateCaptureIntegrity(root){
 const reasons=[],counts=[],base=resolve(root);
 const outcome=()=>({local_sha256_inventory_verified:reasons.length===0,
  offline_compiled_test_backend_verified:false,
  file_count:counts.reduce((sum,x)=>sum+x.files,0),
  per_capture_file_counts:counts.map(x=>x.files),
  unverified_external_toolbar_reference_count:counts.reduce((sum,x)=>sum+x.toolbar,0),
  historical_origin_verified:false,
  authorized_reviewer_verified:false,
  hosted_compiled_bundle_accepted:false,
  destructive_execution_authorized:false,
  failure_codes:[...new Set(reasons)]});
 const bad=(why)=>{reasons.push(why);return outcome();};
 try{
  if(!existsSync(base)||lstatSync(base).isSymbolicLink()||!lstatSync(base).isDirectory())
   return bad('PRIVATE_CAPTURE_ROOT_UNAVAILABLE');
  const man=JSON.parse(readFileSync(join(base,'private-capture-manifest.json'),'utf8'));
  const inv=JSON.parse(readFileSync(join(base,'private-capture-hashes.json'),'utf8'));
  if(!own(man,['schema_version','scope','captured_at_utc','deployments'])||
     man.schema_version!==1||man.scope!=='historical-preview-bundle-content-only'||
     !Array.isArray(man.deployments)||man.deployments.length!==5||
     inv.schema_version!==1||inv.purpose!=='historical-preview-private-sha256-inventory'||
     !Array.isArray(inv.captures)||inv.captures.length!==5)
   return bad('PRIVATE_MANIFEST_SHAPE_MISMATCH');
  const foundFiles=new Set(readdirSync(base));
  const expectedRoot=new Set(['private-capture-manifest.json','private-capture-hashes.json',
   'capture_0','capture_1','capture_2','capture_3','capture_4']);
  if(foundFiles.size!==expectedRoot.size||[...foundFiles].some(x=>!expectedRoot.has(x)))
   return bad('PRIVATE_ROOT_HAS_UNEXPECTED_FILES');
  let total=0;
  for(let i=0;i<EXPECTED.length;i++){
   const expected=EXPECTED[i],record=man.deployments[i],capture=inv.captures[i];
   if(!own(record,['id','sha','surface','directory','capture_evidence_ref'])||
      record.id!==expected.id||record.sha!==expected.sha||
      record.surface!==expected.surface||record.directory!=='capture_'+i||
      typeof record.capture_evidence_ref!=='string'||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(record.capture_evidence_ref)||
      !own(capture,['deployment_id','surface','unverified_external_vercel_toolbar_ref_count','files'])||
      capture.deployment_id!==expected.id||capture.surface!==expected.surface||
      ![0,1].includes(capture.unverified_external_vercel_toolbar_ref_count)||
      !Array.isArray(capture.files)||capture.files.length<2||
      capture.files.length>MAX_FILES)
    return bad('FROZEN_DEPLOYMENT_METADATA_MISMATCH');
   const dir=join(base,record.directory);
   if(!existsSync(dir)||lstatSync(dir).isSymbolicLink()||!lstatSync(dir).isDirectory())
    return bad('PRIVATE_TREE_MISSING_OR_UNSAFE');
   const paths=new Set();
   let hasIndex=false;
   for(const file of capture.files){
    if(!own(file,['file','sha256','bytes'])||!safeFile(file.file)||
       paths.has(file.file)||!HEX.test(file.sha256)||
       !Number.isSafeInteger(file.bytes)||file.bytes<=0||
       file.bytes>(file.file==='index.html'?2*1024*1024:MAX_ITEM))
     return bad('INVALID_HASH_INVENTORY_RECORD');
    paths.add(file.file);
    if(file.file==='index.html')hasIndex=true;
    const target=join(dir,...file.file.split('/'));
    if(!existsSync(target)){
     return bad('INVENTORIED_FILE_MISSING');
    }
    const st=lstatSync(target);
    if(st.isSymbolicLink()||!st.isFile()||st.size!==file.bytes)
     return bad('INVENTORIED_FILE_SIZE_OR_TYPE_MISMATCH');
    const actual=readFileSync(target);
    if(sha(actual)!==file.sha256)
     return bad('SHA256_CONTENT_MISMATCH');
    total+=actual.length;
    if(total>5*MAX_BYTES)return bad('TOTAL_CAPTURE_SIZE_EXCEEDED');
   }
   if(!hasIndex)return bad('HTML_NOT_IN_HASH_INVENTORY');
   const visited=new Set();
   function walk(at){
    const entries=readdirSync(at,{withFileTypes:true});
    for(const entry of entries){
     const target=join(at,entry.name),st=lstatSync(target);
     if(st.isSymbolicLink())throw Error('unsafe');
     if(st.isDirectory())walk(target);
     else if(st.isFile()){
      const name=relative(dir,target).replaceAll('\\','/');
      if(!paths.has(name))throw Error('orphan');
      visited.add(name);
     }else throw Error('unsafe');
    }
   }
   try{walk(dir);}catch{return bad('UNINVENTORIED_OR_UNSAFE_PRIVATE_FILE');}
   if(visited.size!==paths.size)return bad('HASH_INVENTORY_UNVERIFIED');
   counts.push({files:capture.files.length,toolbar:capture.unverified_external_vercel_toolbar_ref_count});
  }
  const captureContent=inspectPreviewBundleCapture(man,base,new Date(),true);
  if(!captureContent.content_consistent_with_test)
   return bad('COMPILED_TEST_CONTENT_REPLAY_FAILED');
  const result=outcome();
  result.offline_compiled_test_backend_verified=true;
  return result;
 }catch{
  return bad('PRIVATE_CAPTURE_INTEGRITY_UNVERIFIABLE');
 }
}
function main(){
 if(process.argv.length!==4||process.argv[2]!=='--check'){
  console.error('Usage: node --experimental-vm-modules scripts/qa/oa5-private-capture-integrity.mjs --check <existing-private-capture-root>');
  process.exitCode=2;return;
 }
 const r=checkPrivateCaptureIntegrity(process.argv[3]);
 if(!r.local_sha256_inventory_verified||!r.offline_compiled_test_backend_verified){
  console.error('BLOCKED: local capture integrity check failed: '+r.failure_codes.join(', '));
  console.error('Do not delete, upload, modify, or recapture the preserved historical files.');
  process.exitCode=1;return;
 }
 console.log('PASS: all 5 frozen deployment records, '+r.file_count+' private original file SHA-256 hashes and local Test backend content rechecked.');
 console.log('PER-CAPTURE FILE COUNTS: '+r.per_capture_file_counts.join(', '));
 console.log('NOT VERIFIED: '+r.unverified_external_toolbar_reference_count+' external Vercel Toolbar scripts were not captured or attested.');
 console.log('NOT VERIFIED: original hosted response bytes, reviewer browser continuity, external loaded modules or production safety.');
 console.log('NOT AUTHORIZED: no Test reset, cron pause, provider callback, Preview deployment or Production operation.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
