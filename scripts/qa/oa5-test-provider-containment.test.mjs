import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {PROVIDER_MODES,TEST_REF,PURPOSE,assessTestProviderContainment} from './oa5-test-provider-containment.mjs';

const head='a'.repeat(40),now=new Date('2026-11-11T20:25:00Z');
const record=()=>({
  schema_version:1,project_ref:TEST_REF,purpose:PURPOSE,
  reviewed_source_sha:head,captured_at_utc:'2026-11-11T20:24:00Z',
  production_unchanged_reviewed:true,production_invariance_evidence_ref:'private-production-invariance',
  providers:Object.fromEntries(Object.keys(PROVIDER_MODES).map((key,i)=>[key,{
    mode:'disabled',ingress:'quarantined',outbound:'quarantined',
    destination:'none',credentials:'none',production_unchanged:true,
    no_real_recipient:true,provider_owner_reviewed:true,
    evidence_ref:'private-provider-'+String(i).padStart(3,'0')
  }]))
});
const check=x=>assessTestProviderContainment(x,{sourceSha:head,now});
test('a full synthetic provider record never proves external provider isolation or authorizes a mutation',()=>{
 const a=check(record());
 assert.equal(a.provider_review_record_consistent,true,a.reasons.join('\n'));
 for(const k of ['provider_console_configuration_independently_verified',
   'actual_external_delivery_quiescence_verified','historical_preview_reviewer_continuity_verified',
   'hosted_test_reconstruction_authorized','cron_pause_authorized','production_cutover_authorized'])
  assert.equal(a[k],false);
});
test('wrong Test project, source SHA, purpose, schema, unknown keys, and outdated snapshot are stopped',()=>{
 for(const change of [x=>x.project_ref='eujxswjspolugrzlsjnn',
  x=>x.purpose='production-ready',x=>x.schema_version=2,
  x=>x.reviewed_source_sha='b'.repeat(40),
  x=>x.secret='live-token',x=>x.providers.meta_whatsapp.endpoint='https://live.example',
  x=>x.captured_at_utc='2026-11-10T18:00:00Z',
  x=>x.captured_at_utc='2026-11-11T20:25:01Z']){
  const a=record();change(a);
  assert.equal(check(a).provider_review_record_consistent,false);
 }
 assert.equal(check(null).provider_review_record_consistent,false);
 assert.equal(assessTestProviderContainment(record(),{sourceSha:'b'.repeat(40),now}).provider_review_record_consistent,false);
});
test('missing, duplicate or unverified providers cannot satisfy seven-surface containment',()=>{
 for(const k of Object.keys(PROVIDER_MODES)){
  const a=record();delete a.providers[k];assert.equal(check(a).provider_review_record_consistent,false,k);
  const b=record();b.providers[k].ingress='active';assert.equal(check(b).provider_review_record_consistent,false,k);
  const c=record();c.providers[k].outbound='qa_allowlist_only';assert.equal(check(c).provider_review_record_consistent,false,k);
  const d=record();d.providers[k].production_unchanged=false;assert.equal(check(d).provider_review_record_consistent,false,k);
  const e=record();e.providers[k].no_real_recipient=false;assert.equal(check(e).provider_review_record_consistent,false,k);
  const f=record();f.providers[k].provider_owner_reviewed=false;assert.equal(check(f).provider_review_record_consistent,false,k);
  const g=record();g.providers[k].mode='production_live';assert.equal(check(g).provider_review_record_consistent,false,k);
 }
});
test('disabled route cannot retain a production destination, credentials or unreviewed callback',()=>{
 for(const key of Object.keys(PROVIDER_MODES)){
  for(const [field,value] of [['destination','test_only'],['credentials','nonproduction_only'],['destination','production']]){
   const a=record();a.providers[key][field]=value;
   assert.equal(check(a).provider_review_record_consistent,false,key+':'+field);
  }
 }
});
test('configured test providers require isolated target and credentials, still no external send',()=>{
 for(const key of Object.keys(PROVIDER_MODES)){
  const a=record();a.providers[key].mode=PROVIDER_MODES[key][1];
  if(key!=='ai_workers'){
    a.providers[key].destination='test_only';a.providers[key].credentials='nonproduction_only';
  }
  assert.equal(check(a).provider_review_record_consistent,true,key);
  const bad=structuredClone(a);bad.providers[key].credentials='production';
  assert.equal(check(bad).provider_review_record_consistent,false,key);
 }
});
test('no evidence reference can attest Meta, PSP, SMTP or Production invariance twice',()=>{
 const x=record();x.providers.meta_whatsapp.evidence_ref=x.production_invariance_evidence_ref;
 assert.equal(check(x).provider_review_record_consistent,false);
 const y=record();y.providers.paystack.evidence_ref=y.providers.flutterwave.evidence_ref;
 assert.equal(check(y).provider_review_record_consistent,false);
 const z=record();z.production_unchanged_reviewed=false;
 assert.equal(check(z).provider_review_record_consistent,false);
});
test('CLI fails closed and cannot leak path when protected review file is absent',()=>{
 const script=new URL('./oa5-test-provider-containment.mjs',import.meta.url).pathname;
 const secret='/private/qa-provider-console-live-keys.json';
 const p=spawnSync(process.execPath,[script,'--check',secret],{encoding:'utf8'});
 assert.equal(p.status,1);assert.match(p.stderr,/BLOCKED/);
 assert.equal(p.stderr.includes(secret),false);
});
