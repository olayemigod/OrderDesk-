#!/usr/bin/env node
/**
 * OA5 historical standalone-Test Edge *bundle-metadata* drift precondition.
 * Offline-only: reads a sanitized private or committed JSON snapshot.
 * No network, function source download, deploy, callbacks, secrets or writes.
 * Bundle hashes are Supabase metadata, NOT a source-provenance attestation.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const TEST_PROJECT='iukgsukdoowvnhlfmpml';
export const BASELINE_PURPOSE='historical-test-edge-bundle-baseline';
export const RECHECK_PURPOSE='pre-maintenance-test-edge-bundle-recheck';
const MAX_AGE_MS=10*60*1000;

export const KNOWN=Object.freeze([
 Object.freeze({slug:'agreement-pdf-runtime-probe',status:'ACTIVE',version:5,verify_jwt:true,bundle_sha256:'10e9119e1358628b83216e570588817de8b01234ec071936303b2d3b01f522d8'}),
 Object.freeze({slug:'commercial-agreements',status:'ACTIVE',version:4,verify_jwt:true,bundle_sha256:'23a06cf3c81130b64ff5c4ef72b17db346ec26f1c8072624dec1e93c7a767b76'}),
 Object.freeze({slug:'master-agreements',status:'ACTIVE',version:6,verify_jwt:true,bundle_sha256:'a5864bb52957f82c2aef6f19564a153b6fb74c4c385d80defb92b320ee435412'}),
 Object.freeze({slug:'platform-admin',status:'ACTIVE',version:5,verify_jwt:true,bundle_sha256:'c70bd4f0bbf51e052509376811187460c8f67eb53f4d9117800bc8054273144e'}),
 Object.freeze({slug:'platform-admin-settlement',status:'ACTIVE',version:4,verify_jwt:true,bundle_sha256:'fa1004e5b91aa3d7d9e5ae536ae837a99b32499ad07a4cb02a7d0484839d527c'})
]);
const exact=(obj,keys)=>obj!==null&&typeof obj==='object'&&!Array.isArray(obj)&&
 Object.keys(obj).sort().join('|')===[...keys].sort().join('|');
const validDate=(v)=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(v)
 ?Date.parse(v):NaN;

export function assessTestEdgeBundleDrift(snapshot,now=new Date(),mode='recheck'){
 const reasons=[];
 const output=()=>({
  metadata_matches_historical_baseline:reasons.length===0,
  deployed_source_provenance_verified:false,
  external_provider_isolation_verified:false,
  edge_deployment_authorized:false,
  cron_pause_authorized:false,
  destructive_execution_authorized:false,
  reasons
 });
 if(!exact(snapshot,['schema_version','project_ref','purpose','observed_at_utc','functions'])){
  reasons.push('Malformed or secret-bearing Test Edge bundle metadata snapshot');
  return output();
 }
 if(mode!=='baseline'&&mode!=='recheck'){
  reasons.push('Unknown offline Edge bundle validation mode');
  return output();
 }
 const purpose=mode==='baseline'?BASELINE_PURPOSE:RECHECK_PURPOSE;
 if(snapshot.schema_version!==1||snapshot.project_ref!==TEST_PROJECT||snapshot.purpose!==purpose)
  reasons.push('Wrong Test project, schema or approved snapshot purpose');
 const stamp=validDate(snapshot.observed_at_utc);
 if(!Number.isFinite(stamp)||stamp>now.getTime()){
  reasons.push('Invalid or future Edge metadata observation timestamp');
 } else if(mode==='recheck'&&now.getTime()-stamp>MAX_AGE_MS){
  reasons.push('Test Edge metadata recheck older than ten minutes');
 }
 if(!Array.isArray(snapshot.functions)||snapshot.functions.length!==KNOWN.length){
  reasons.push('Test Edge inventory requires precisely five historic functions');
  return output();
 }
 const slugs=new Set();
 for(const item of snapshot.functions){
  if(!exact(item,['slug','status','version','verify_jwt','bundle_sha256'])){
   reasons.push('Unreviewed or secret-bearing Edge function metadata field');
   continue;
  }
  if(typeof item.slug!=='string'||slugs.has(item.slug)){
   reasons.push('Invalid or duplicated historic Edge function slug');
   continue;
  }
  slugs.add(item.slug);
  const want=KNOWN.find(x=>x.slug===item.slug);
  if(!want){
   reasons.push('Unrecognized Test Edge function deployed: '+item.slug);
   continue;
  }
  if(item.status!==want.status||item.version!==want.version||
     item.verify_jwt!==want.verify_jwt||item.bundle_sha256!==want.bundle_sha256)
   reasons.push('Test Edge bundle/version/JWT metadata drift: '+item.slug);
 }
 if(slugs.size!==KNOWN.length)reasons.push('Missing historical Edge function in Test inventory');
 return output();
}
function main(){
 if(process.argv.length!==5||!['--baseline','--check'].includes(process.argv[2])){
  console.error('Usage: node scripts/qa/oa5-test-edge-bundle-drift.mjs --baseline|--check <sanitized-json> --offline');
  process.exitCode=2;return;
 }
 if(process.argv[4]!=='--offline'){
  console.error('BLOCKED: offline-only Edge bundle drift check');
  process.exitCode=2;return;
 }
 let snapshot;
 try{snapshot=JSON.parse(readFileSync(resolve(process.argv[3]),'utf8'));}
 catch{console.error('BLOCKED: unavailable private Test Edge metadata');process.exitCode=1;return;}
 const result=assessTestEdgeBundleDrift(snapshot,new Date(),process.argv[2]==='--baseline'?'baseline':'recheck');
 if(!result.metadata_matches_historical_baseline){
  console.error('BLOCKED: hosted Test Edge bundle identity differs from reviewed historical custody');
  for(const reason of result.reasons)console.error(' - '+reason);
  process.exitCode=1;return;
 }
 console.log('PASS: supplied Test Edge provider-metadata identity matches the five historical bundle hashes.');
 console.log('NOT VERIFIED: bundled source provenance, external provider routing, function reachability or authorized deployment.');
 console.log('NOT AUTHORIZED: no cron pause, cleanup, Edge deploy, provider callback or Production operation.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
