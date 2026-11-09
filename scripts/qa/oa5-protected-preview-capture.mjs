#!/usr/bin/env node
/**
 * OA5: explicitly invoked read-only original Vercel Preview asset capture.
 * Requires existing local Vercel CLI authentication and independently
 * verified original deployment aliases. No deployment, bypass, SSO change,
 * login, project-link, provider callback, Supabase write or paid resource.
 *
 * URL-to-deployment provenance and historical reviewer authorization are
 * HUMAN evidence; this tool NEVER attests either, even if files look correct.
 */
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync} from 'node:fs';
import {resolve,dirname,join,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {EXPECTED,inspectPreviewBundleCapture} from './oa5-historical-preview-bundle-inspection.mjs';
import {localPath,htmlScripts,importedLiterals} from './oa5-preview-module-graph.mjs';

const MAX_FILES=2000;
const MAX_BYTES=80*1024*1024;
const MAX_ITEM=12*1024*1024;
const exact=(obj,keys)=>!!obj&&typeof obj==='object'&&!Array.isArray(obj)&&
 Object.keys(obj).sort().join('|')===[...keys].sort().join('|');
const refGood=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(x);
const sha256=buffer=>createHash('sha256').update(buffer).digest('hex');
const aliasCensus=JSON.parse(readFileSync(
 new URL('../../docs/qa/oa5-original-preview-alias-fingerprints-2026-11-09.json',import.meta.url),'utf8'));
if(aliasCensus.schema_version!==1||
   aliasCensus.purpose!=='original-five-vercel-preview-alias-fingerprints'||
   aliasCensus.hash_input_format!=='sha256(utf8(deployment_id + LF + lowercase_preview_hostname))'||
   !Array.isArray(aliasCensus.aliases)||aliasCensus.aliases.length!==EXPECTED.length||
   aliasCensus.aliases.some(x=>!EXPECTED.some(d=>d.id===x.id&&d.surface===x.surface)||
     !/^[a-f0-9]{64}$/.test(x.sha256))||
   new Set(aliasCensus.aliases.map(x=>x.id)).size!==EXPECTED.length)
 throw Error('BLOCKED: original Vercel alias fingerprint census is invalid');
export const EXPECTED_ALIAS_DIGESTS=Object.freeze(Object.fromEntries(aliasCensus.aliases.map(x=>[x.id,x.sha256])));
const aliasDigest=(id,hostname)=>sha256(Buffer.from(id+'\n'+hostname.toLowerCase(),'utf8'));
const checkoutRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const insideCheckout=path=>existsSync(join(checkoutRoot,'.git'))&&
  (path===checkoutRoot||path.startsWith(checkoutRoot+sep));


export function validatePrivateCapturePlan(input,expectedAliasDigests=EXPECTED_ALIAS_DIGESTS){
 const reasons=[],normalized=[];
 const outcome=()=>({valid:reasons.length===0,reasons,deployments:normalized,
  original_vercel_origin_attested:false,authorized_reviewer_verified:false,
  capture_authorized_by_tool:false});
 if(!exact(input,['schema_version','purpose','deployments'])||
    input.schema_version!==1||input.purpose!=='read-only-original-preview-capture'){
  reasons.push('Invalid private capture plan schema or purpose');
  return outcome();
 }
 if(!Array.isArray(input.deployments)||input.deployments.length!==EXPECTED.length){
  reasons.push('The five immutable original deployments are required');
  return outcome();
 }
 const seenIds=new Set(),seenOrigins=new Set(),seenEvidence=new Set();
 for(const [i,d] of input.deployments.entries()){
  if(!exact(d,['id','sha','surface','origin','capture_evidence_ref'])){
   reasons.push('Unexpected or credential-bearing deployment capture fields');
   continue;
  }
  const want=EXPECTED.find(x=>x.id===d.id);
  if(!want||seenIds.has(d.id)||want.sha!==d.sha||want.surface!==d.surface){
   reasons.push('Wrong or duplicate original deployment ID/source identity');
   continue;
  }
  seenIds.add(d.id);
  if(!refGood(d.capture_evidence_ref)||seenEvidence.has(d.capture_evidence_ref)){
   reasons.push('Missing or duplicate independent private capture reference');
   continue;
  }
  seenEvidence.add(d.capture_evidence_ref);
  let url;
  try{url=new URL(d.origin);}catch{
   reasons.push('Invalid original protected Vercel Preview origin');
   continue;
  }
  const prefix=d.surface==='merchant'?'sellertray-merchant-':'sellertray-admin-';
  // Only immutable, branch-specific Vercel Preview aliases, not production
  // domains, custom test domains, arbitrary hosts or shared root aliases.
  if(url.protocol!=='https:'||url.username||url.password||url.port||
     (url.pathname!==''&&url.pathname!=='/')||url.search||url.hash||
     !url.hostname.startsWith(prefix)||
     !/^[a-z0-9-]+\.vercel\.app$/.test(url.hostname)||
     seenOrigins.has(url.origin)||
     aliasDigest(d.id,url.hostname)!==expectedAliasDigests[d.id]){
   reasons.push('Unsafe, shared or duplicated non-original Vercel Preview origin');
   continue;
  }
  seenOrigins.add(url.origin);
  normalized.push({...d,directory:'capture_'+i,origin:url.origin});
 }
 if(seenIds.size!==EXPECTED.length||normalized.length!==EXPECTED.length)
  reasons.push('Incomplete five-deployment original-Preview capture mapping');
 return outcome();
}

/**
 * Windows npm CLIs normally use a .cmd launcher. Node execFileSync cannot
 * launch a .cmd file directly. cmd.exe is needed only on Windows, and only
 * with a strictly validated, argument-free-of-shell-metacharacters read.
 * The standalone Vercel CLI authenticates and may manage a short-lived
 * deployment-protection bypass token internally; this runner never prints it.
 */
export function planVercelReadOnlyCommand(action,url=null,platform=process.platform){
 if(action!=='curl'&&action!=='whoami')
  throw Error('BLOCKED: unsupported Vercel CLI action');
 if(action==='whoami'&&url!==null)
  throw Error('BLOCKED: whoami does not take a target URL');
 if(action==='curl'){
  if(typeof url!=='string'||
     !/^https:\/\/[a-z0-9-]+\.vercel\.app\/[A-Za-z0-9._/-]*$/.test(url)||
     url.split('/').some(segment=>segment==='..'||segment==='.')||
     url.includes('//',8))
   throw Error('BLOCKED: unsafe Vercel read target');
 }
 const args=action==='curl'
  ?['curl',url,'--fail','--silent','--show-error','--max-time','30']
  :['whoami'];
 if(platform==='win32'){
  // All arguments are fixed literals or already constrained to a simple
  // HTTPS Vercel URL without spaces, shell operators, quotes or percent.
  return {file:'cmd.exe',args:['/d','/s','/c','vercel.cmd '+args.join(' ')]};
 }
 return {file:'vercel',args};
}
function protectedVercelCurl(url,maxBytes=MAX_ITEM){
 try{
  const {file,args}=planVercelReadOnlyCommand('curl',url);
  const out=execFileSync(file,args,{
   timeout:45000,maxBuffer:maxBytes+1024,
   windowsHide:true,stdio:['ignore','pipe','pipe']
  });
  if(!Buffer.isBuffer(out)||out.length===0||out.length>maxBytes)
   throw Error('empty or oversized');
  return out;
 }catch{
  throw new Error('Authenticated read-only Vercel capture failed; inspect original Preview access privately');
 }
}

export function captureOriginalPreviewPlan(input,privateRoot,request=protectedVercelCurl,now=new Date(),syntheticTestAliasDigests=null){
 if(syntheticTestAliasDigests&&request===protectedVercelCurl)
  throw Error('BLOCKED: alias fingerprint override requires an injected synthetic test transport');
 const plan=validatePrivateCapturePlan(input,syntheticTestAliasDigests||EXPECTED_ALIAS_DIGESTS);
 if(!plan.valid)throw Error('BLOCKED: invalid original Preview capture mapping: '+plan.reasons.join('; '));
 if(typeof request!=='function')throw Error('BLOCKED: missing read-only capture transport');
 const root=resolve(privateRoot);
 if(insideCheckout(root))throw Error('BLOCKED: historical compiled assets must never be stored inside the Git repository');
 if(existsSync(root)){
  if(readdirSync(root).length)throw Error('BLOCKED: never overwrite existing private historical capture');
 }else{
  // Caller must create a private parent workspace with safe permissions.
  if(!existsSync(dirname(root)))throw Error('BLOCKED: private parent workspace is missing');
  mkdirSync(root,{recursive:false});
 }
 const hashes=[],manifest={
  schema_version:1,scope:'historical-preview-bundle-content-only',
  captured_at_utc:now.toISOString().replace(/\.\d{3}Z$/,'Z'),
  deployments:[],
 };
 for(const d of plan.deployments){
  const dir=join(root,d.directory);
  if(existsSync(dir))throw Error('BLOCKED: historical capture directory already exists');
  mkdirSync(dir);
  let bytes=0;
  const fileHashes=[];
  function fetchLocal(rel){
   const cap=rel==='index.html'?2*1024*1024:MAX_ITEM;
   const endpoint=new URL(rel==='index.html'?'/':'/'+rel,d.origin).href;
   let buffer;
   try{buffer=request(endpoint,cap);}
   catch{throw Error('BLOCKED: missing/unauthorized original Preview asset for '+d.id);}
   if(!Buffer.isBuffer(buffer)||buffer.length===0||buffer.length>cap)
    throw Error('BLOCKED: empty, oversize or invalid protected Preview file for '+d.id);
   bytes+=buffer.length;
   if(bytes>MAX_BYTES||fileHashes.length>=MAX_FILES)
    throw Error('BLOCKED: original Preview file count/size exceeded for '+d.id);
   const text=buffer.toString('utf8');
   if(rel==='index.html'){
    if(!/<(?:!doctype\s+html|html)\b/i.test(text)||!htmlScripts(text).length)
     throw Error('BLOCKED: root document is not original application HTML for '+d.id);
   }else if(/^\s*(?:<!doctype\s+html|<html\b)/i.test(text)){
    throw Error('BLOCKED: compiled JS is an HTML challenge/redirect for '+d.id);
   }
   const file=join(dir,...rel.split('/'));
   mkdirSync(dirname(file),{recursive:true});
   writeFileSync(file,buffer,{flag:'wx',mode:0o600});
   fileHashes.push({file:rel,sha256:sha256(buffer),bytes:buffer.length});
   return text;
  }
  const html=fetchLocal('index.html');
  const jsPaths=htmlScripts(html).map(src=>localPath('index.html',src,true));
  if(!jsPaths.length||jsPaths.some(x=>!x))
   throw Error('BLOCKED: original HTML has missing/unsafe JavaScript entrypoints for '+d.id);
  const visited=new Set(),queue=[...jsPaths];
  while(queue.length){
   const rel=queue.pop();
   if(visited.has(rel))continue;
   visited.add(rel);
   if(visited.size>MAX_FILES)throw Error('BLOCKED: excessive original module graph for '+d.id);
   const source=fetchLocal(rel);
   for(const raw of importedLiterals(source)){
    const child=localPath(rel,raw,false);
    if(!child)throw Error('BLOCKED: unsupported/unsafe original local module dependency for '+d.id);
    if(!visited.has(child))queue.push(child);
   }
  }
  manifest.deployments.push({id:d.id,sha:d.sha,surface:d.surface,
   directory:d.directory,capture_evidence_ref:d.capture_evidence_ref});
  hashes.push({deployment_id:d.id,surface:d.surface,files:fileHashes});
 }
 const inspection=inspectPreviewBundleCapture(manifest,root,now);
 if(!inspection.content_consistent_with_test){
  // Keep authentic bytes privately for operator review, but do not emit
  // a complete/accepted manifest on any missing/unexpected backend asset.
  throw Error('BLOCKED: captured original Preview content failed offline Test-only inspection');
 }
 const manifestPath=join(root,'private-capture-manifest.json');
 const hashesPath=join(root,'private-capture-hashes.json');
 writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
 writeFileSync(hashesPath,JSON.stringify({schema_version:1,
  purpose:'historical-preview-private-sha256-inventory',captures:hashes},null,2)+'\n',
  {flag:'wx',mode:0o600});
 return {content_consistent_with_test:true,
  original_vercel_origin_attested:false,
  authorized_reviewer_verified:false,
  hosted_compiled_bundle_accepted:false,
  destructive_execution_authorized:false,
  capture_count:hashes.length,total_file_count:hashes.reduce((sum,h)=>sum+h.files.length,0),
  manifest_path:manifestPath,hash_inventory_path:hashesPath};
}
function main(){
 if(process.argv.length!==4&&process.argv.length!==5){
  console.error('Usage: node scripts/qa/oa5-protected-preview-capture.mjs --check-plan <private-plan.json> | --capture <private-plan.json> <new-private-output-directory>');
  process.exitCode=2;return;
 }
 const [mode,privatePlan,privateRoot]=process.argv.slice(2);
 if(!['--check-plan','--capture'].includes(mode)||
    (mode==='--capture'&&!privateRoot)||(mode==='--check-plan'&&privateRoot)){
  console.error('BLOCKED: explicit capture mode and private plan/root required');
  process.exitCode=2;return;
 }
 if(insideCheckout(resolve(privatePlan))){
  console.error('BLOCKED: do not store the private original Preview alias plan inside Git');
  process.exitCode=1;return;
 }
 let plan;
 try{plan=JSON.parse(readFileSync(resolve(privatePlan),'utf8'));}
 catch{console.error('BLOCKED: missing or invalid private original Preview plan');process.exitCode=1;return;}
 if(mode==='--check-plan'){
  const check=validatePrivateCapturePlan(plan);
  if(!check.valid){console.error('BLOCKED: '+check.reasons.join('; '));process.exitCode=1;return;}
  console.log('PASS: exact five original deployment IDs, source commits and restricted Vercel Preview origins.');
  console.log('NOT VERIFIED: original Vercel aliases are genuinely bound to IDs or the caller has reviewer access.');
  return;
 }
 const check=validatePrivateCapturePlan(plan);
 if(!check.valid){console.error('BLOCKED: '+check.reasons.join('; '));process.exitCode=1;return;}
 try{
  // The CLI must already be signed in with the owner's authorized account.
  // No auth refresh, login or Vercel project mutation is attempted.
  const {file,args}=planVercelReadOnlyCommand('whoami');
  execFileSync(file,args,{timeout:10000,maxBuffer:4096,
   stdio:['ignore','pipe','pipe'],windowsHide:true});
 }catch{
  console.error('BLOCKED: local Vercel CLI is not authenticated as a reviewer');
  process.exitCode=1;return;
 }
 try{
  const result=captureOriginalPreviewPlan(plan,privateRoot);
  console.log('PASS: privately captured '+result.capture_count+' supplied Preview trees and '+result.total_file_count+' local files.');
  console.log('Private manifest and checksums written only under the requested protected output directory.');
  console.log('NOT VERIFIED: true original alias-to-deployment provenance or authorized reviewer access.');
  console.log('NOT AUTHORIZED: no deployment, Test reset, provider callback, cron pause or Production change.');
 }catch{
  // Refuse to print URL-bearing provider errors or the contents of captures.
  console.error('BLOCKED: original protected Preview capture is missing, unsafe, or content-inconsistent. Review the private workspace without publishing it.');
  process.exitCode=1;
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
