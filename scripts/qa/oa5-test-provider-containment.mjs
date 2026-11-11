#!/usr/bin/env node
/**
 * Offline-only OA5 Test provider ingress and delivery containment record.
 * Validates a private, independently reviewed provider-console snapshot.
 * No provider API/HTTP/SQL call, secret/URL/recipient read, mutation or approval.
 * A structurally consistent review record is not proof of actual provider safety.
 */
import {readFileSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const TEST_REF='iukgsukdoowvnhlfmpml';
export const PRODUCTION_REF='eujxswjspolugrzlsjnn';
export const PURPOSE='oa5-pre-rebuild-external-provider-containment';
export const MAX_AGE_MS=24*60*60*1000;
export const PROVIDER_MODES=Object.freeze({
  meta_whatsapp:['disabled','isolated_test_app'],
  paystack:['disabled','sandbox_only'],
  flutterwave:['disabled','sandbox_only'],
  smtp_auth:['disabled','captive_test_sink'],
  fcm:['disabled','qa_project_only'],
  ai_workers:['disabled','mock_only'],
  merchant_admin_auth_redirects:['disabled','test_only']
});
const exact=(obj,keys)=>obj!==null&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).sort().join('|')===[...keys].sort().join('|');
const opaque=(x)=>typeof x==='string'&&/^[A-Za-z][A-Za-z0-9_-]{7,79}$/.test(x);
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const timestamp=t=>typeof t==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(t)?Date.parse(t):NaN;

export function assessTestProviderContainment(record,{sourceSha,now=new Date()}={}){
  const reasons=[];
  const result=()=>({
    provider_review_record_consistent:reasons.length===0,
    provider_console_configuration_independently_verified:false,
    actual_external_delivery_quiescence_verified:false,
    historical_preview_reviewer_continuity_verified:false,
    hosted_test_reconstruction_authorized:false,
    cron_pause_authorized:false,
    production_cutover_authorized:false,
    reasons
  });
  if(!exact(record,['schema_version','project_ref','purpose','reviewed_source_sha','captured_at_utc',
     'production_unchanged_reviewed','production_invariance_evidence_ref','providers'])){
    reasons.push('Missing or unexpected private Test-only provider review fields');
    return result();
  }
  if(record.schema_version!==1||record.project_ref!==TEST_REF||record.purpose!==PURPOSE)
    reasons.push('Provider containment record is not scoped to historical SellerTray Test');
  if(!sha(sourceSha)||record.reviewed_source_sha!==sourceSha)
    reasons.push('Provider review must target this exact canonical source SHA');
  const t=timestamp(record.captured_at_utc);
  if(!Number.isFinite(t)||t>now.getTime()||now.getTime()-t>MAX_AGE_MS)
    reasons.push('Provider-console snapshot is stale, malformed or future-dated');
  if(record.production_unchanged_reviewed!==true||!opaque(record.production_invariance_evidence_ref))
    reasons.push('Independent Production webhook/phone/payment/domain invariance review missing');
  const expected=Object.keys(PROVIDER_MODES);
  if(!exact(record.providers,expected)){
    reasons.push('All seven separate provider and redirect boundaries are required');
    return result();
  }
  const used=new Set();
  if(opaque(record.production_invariance_evidence_ref))used.add(record.production_invariance_evidence_ref);
  for(const key of expected){
    const entry=record.providers[key];
    if(!exact(entry,['mode','ingress','outbound','destination','credentials',
      'production_unchanged','no_real_recipient','provider_owner_reviewed','evidence_ref'])){
      reasons.push('Missing or unexpected provider configuration evidence: '+key);
      continue;
    }
    const allowed=PROVIDER_MODES[key];
    if(!allowed.includes(entry.mode))reasons.push('Unapproved Test provider operating mode: '+key);
    if(entry.ingress!=='quarantined'||entry.outbound!=='quarantined')
      reasons.push('Provider ingress or external delivery is not quarantined: '+key);
    if(entry.production_unchanged!==true||entry.no_real_recipient!==true||
       entry.provider_owner_reviewed!==true)
      reasons.push('Owner, real-recipient or Production-invariance review missing: '+key);
    if(entry.mode==='disabled'){
      if(entry.destination!=='none'||entry.credentials!=='none')
        reasons.push('A disabled provider cannot retain an unreviewed active Test route/secret: '+key);
    }else if(key==='ai_workers'&&entry.mode==='mock_only'){
      if(entry.destination!=='none'||entry.credentials!=='none')
        reasons.push('Mock AI/worker mode must have no external destinations/credentials');
    }else{
      if(entry.destination!=='test_only'||entry.credentials!=='nonproduction_only')
        reasons.push('Connected provider must use solely Test destinations/credentials: '+key);
    }
    if(!opaque(entry.evidence_ref)||used.has(entry.evidence_ref))
      reasons.push('Missing or repeated independent private provider evidence reference: '+key);
    else used.add(entry.evidence_ref);
  }
  // Even a synthetic all-true record cannot substitute for a provider-console
  // screen read, a Test-only callback probe or an approved maintenance window.
  return result();
}
function main(){
  if(process.argv.length!==4||process.argv[2]!=='--check'){
    console.error('Usage: node scripts/qa/oa5-test-provider-containment.mjs --check <private-Test-provider-review.json>');
    process.exitCode=2;return;
  }
  let snapshot,sourceSha;
  try{
    const file=resolve(process.argv[3]),st=lstatSync(file);
    if(!st.isFile()||st.isSymbolicLink()||st.size>65536)throw Error('unsafe');
    snapshot=JSON.parse(readFileSync(file,'utf8'));
    sourceSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',timeout:10000}).trim();
  }catch{
    console.error('BLOCKED: no safe private provider evidence or Git identity; contents not disclosed');
    process.exitCode=1;return;
  }
  const review=assessTestProviderContainment(snapshot,{sourceSha});
  console.log(JSON.stringify(review,null,2));
  if(!review.provider_review_record_consistent)process.exitCode=1;
  console.log('NOT VERIFIED: live provider console or deliveries, protected historical Previews, or callback traffic.');
  console.log('NOT AUTHORIZED: no cron pause, hosted Test reset, provider write, preview, APK or Production cutover.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
