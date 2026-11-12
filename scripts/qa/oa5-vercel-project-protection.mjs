#!/usr/bin/env node
/**
 * OA5 existing Vercel Merchant/Admin project protection metadata guard.
 * OFFLINE, PRE-Test-domain-binding only. No network, browser, Vercel API,
 * deployment, secret access, DNS, login, project mutation or authorized reset.
 * Operator supplies sanitized Vercel get_project metadata with no URL tokens.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const BASELINE_SCOPE='existing-vercel-project-protection-baseline';
export const RECHECK_SCOPE='pre-test-domain-binding-vercel-protection-recheck';
const MAX_AGE_MS=10*60*1000;
const want=[
 {surface:'merchant',project_id:'prj_ArmFvWkLeNRLRieJLGV5YVY4nRf4',name:'sellertray-merchant',production:'app.sellertray.com'},
 {surface:'admin',project_id:'prj_Dewd7IMRMjDpUCcZmBjvV6o0uxvO',name:'sellertray-admin',production:'admin.sellertray.com'},
];
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join('|')===[...keys].sort().join('|');

export function assessExistingVercelProtection(snapshot,now=new Date(),mode='recheck'){
 const reasons=[];
 const output=()=>({
  protection_metadata_consistent:reasons.length===0,
  signed_out_preview_challenge_verified:false,
  production_public_http_verified:false,
  historical_reviewer_access_verified:false,
  test_domains_ready:false,
  preview_compiled_backend_verified:false,
  hosted_change_authorized:false,
  destructive_execution_authorized:false,
  reasons
 });
 if(!exact(snapshot,['schema_version','scope','captured_at_utc','projects'])){
  reasons.push('Missing, malformed or secret-bearing Vercel project metadata inventory');
  return output();
 }
 if(mode!=='baseline'&&mode!=='recheck'){
  reasons.push('Unsupported offline Vercel metadata check mode');
  return output();
 }
 const scope=mode==='baseline'?BASELINE_SCOPE:RECHECK_SCOPE;
 if(snapshot.schema_version!==1||snapshot.scope!==scope)
  reasons.push('Unexpected Vercel project protection scope/schema');
 const stamp=typeof snapshot.captured_at_utc==='string'&&
   /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(snapshot.captured_at_utc)
   ?Date.parse(snapshot.captured_at_utc):NaN;
 if(!Number.isFinite(stamp)||stamp>now.getTime()||
    (mode==='recheck'&&now.getTime()-stamp>MAX_AGE_MS))
   reasons.push('Invalid, future-dated or stale Vercel protection snapshot');
 if(!Array.isArray(snapshot.projects)||snapshot.projects.length!==want.length){
  reasons.push('Both existing Merchant and Admin Vercel projects are required');
  return output();
 }
 const seen=new Set();
 for(const item of snapshot.projects){
  if(!exact(item,['surface','project_id','name','sso_enabled','sso_deployment_type','domains'])){
   reasons.push('Unsupported or secret-bearing Vercel project field');
   continue;
  }
  const expected=want.find(x=>x.surface===item.surface);
  if(!expected||seen.has(item.surface)){
   reasons.push('Duplicate or unexpected existing Vercel project');
   continue;
  }
  seen.add(item.surface);
  if(item.project_id!==expected.project_id||item.name!==expected.name)
   reasons.push('Vercel project identity drift: '+item.surface);
  if(item.sso_enabled!==true||
     item.sso_deployment_type!=='prod_deployment_urls_and_all_previews')
   reasons.push('Vercel Standard Authentication protection weakened: '+item.surface);
  if(!Array.isArray(item.domains)||item.domains.some(x=>typeof x!=='string')||
     new Set(item.domains).size!==item.domains.length){
   reasons.push('Incomplete/duplicated Vercel domain inventory: '+item.surface);
   continue;
  }
  if(!item.domains.includes(expected.production))
   reasons.push('Canonical Production domain detached: '+item.surface);
  if(item.domains.includes('test.sellertray.com')||
     item.domains.includes('test-admin.sellertray.com'))
   reasons.push('Test custom domain unexpectedly attached before isolated QA review');
  if(item.domains.some(d=>d===want.find(w=>w.surface!==item.surface).production))
   reasons.push('Other surface Production domain attached to wrong project');
 }
 if(seen.size!==want.length)reasons.push('Missing expected Vercel project metadata');
 return output();
}
function main(){
 if(process.argv.length!==5||!['--baseline','--check'].includes(process.argv[2])||
    process.argv[4]!=='--offline'){
  console.error('Usage: node scripts/qa/oa5-vercel-project-protection.mjs --baseline|--check <sanitized-projects.json> --offline');
  process.exitCode=2;return;
 }
 let s;
 try{s=JSON.parse(readFileSync(resolve(process.argv[3]),'utf8'));}
 catch{console.error('BLOCKED: no private Vercel project metadata snapshot');process.exitCode=1;return;}
 const r=assessExistingVercelProtection(s,new Date(),
   process.argv[2]==='--baseline'?'baseline':'recheck');
 if(!r.protection_metadata_consistent){
  console.error('BLOCKED: existing Vercel project protection is unknown or drifted');
  for(const reason of r.reasons)console.error(' - '+reason);
  process.exitCode=1;return;
 }
 console.log('PASS: supplied Merchant/Admin project-level deployment protection and custom domain attachment match pre-binding baseline.');
 console.log('NOT VERIFIED: signed-out challenges, Production HTTP, reviewer continuity, Test-domain binding or compiled backend identity.');
 console.log('NOT AUTHORIZED: no Vercel operation, Supabase cleanup, cron pause, Test reset or Production change.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
