import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {assessRebuildPreflight,REQUIRED_EVIDENCE} from './oa5-test-rebuild-preflight.mjs';
import {assessTestLiveCensus,ARCHIVED_COUNTS,TEST_REF,REVIEWED_SESSION_LOSS_SCOPE} from './oa5-test-live-census.mjs';
const ref='iukgsukdoowvnhlfmpml',sha='a'.repeat(40);
const record=()=>({schema_version:2,project_ref:ref,reviewed_source_sha:sha,purpose:'pre-reset-human-review',
 evidence:Object.fromEntries(REQUIRED_EVIDENCE.map((k,i)=>[k,{reviewed:true,evidence_ref:'private-review-'+String(i+1).padStart(4,'0')}]))});
const proof={sourceSha:sha,archive:{ok:true},cron:{ok:true},liveCensus:{ok:true},managedBoundary:{ok:true},edgeBundles:{metadata_matches_historical_baseline:true,destructive_execution_authorized:false},vercelProtection:{protection_metadata_consistent:true,hosted_change_authorized:false},workerEgress:{worker_route_counts_quiescent:true,destructive_execution_authorized:false},archiveTransition:{review_package_consistent:true},historicAuthLineage:{historical_baseline_consistent:true}};
test('complete synthetic review never authorizes destructive Test execution',()=>{
  const result=assessRebuildPreflight(record(),proof);
  assert.equal(result.preconditions_met,true);
  assert.equal(result.destructive_execution_authorized,false);
});
test('missing/wrong project, purpose, source, schema and unexpected fields block',()=>{
  for(const change of [
    x=>x.project_ref='eujxswjspolugrzlsjnn',x=>x.schema_version=1,
    x=>x.purpose='destructive-reset',x=>x.reviewed_source_sha='b'.repeat(40),
    x=>x.project_ref='test',x=>x.secret='do-not-save-secrets',
  ]){
    const r=record();change(r);
    assert.equal(assessRebuildPreflight(r,proof).preconditions_met,false);
  }
  assert.equal(assessRebuildPreflight(null,proof).preconditions_met,false);
  assert.equal(assessRebuildPreflight(record(),{...proof,sourceSha:'b'.repeat(40)}).preconditions_met,false);
});
test('each missing or unreviewed evidence category is a stop condition',()=>{
  for(const key of REQUIRED_EVIDENCE){
    const r=record();delete r.evidence[key];
    assert.equal(assessRebuildPreflight(r,proof).preconditions_met,false,key);
    const t=record();t.evidence[key].reviewed=false;
    assert.equal(assessRebuildPreflight(t,proof).preconditions_met,false,key);
  }
});
test('unknown evidence and secret-bearing fields are refused',()=>{
  for(const change of [
    x=>x.evidence.unreviewed={reviewed:true,evidence_ref:'private-review-0001'},
    x=>x.evidence.archive_restore_reviewed.access_token='secret',
    x=>x.evidence.archive_restore_reviewed.evidence_ref='http://public.example/secrets',
    x=>x.evidence.archive_restore_reviewed.evidence_ref='p',
  ]){
    const r=record();change(r);
    assert.equal(assessRebuildPreflight(r,proof).preconditions_met,false);
  }
});
test('backup/restore and fresh cron/pg_net evidence are mandatory, independent stop conditions',()=>{
  for(const q of [
    {...proof,archive:{ok:false,errors:['invalid checksum']}},
    {...proof,cron:{ok:false,reasons:['4 active jobs']}},
    {...proof,archive:null},{...proof,cron:null},
    {...proof,liveCensus:null},{...proof,liveCensus:{ok:false,reasons:['6 Auth sessions']}},
    {...proof,managedBoundary:null},{...proof,managedBoundary:{ok:false,reasons:['stale managed state']}},
    {...proof,edgeBundles:null},{...proof,edgeBundles:{metadata_matches_historical_baseline:false,reasons:['hash changed']}},
    {...proof,vercelProtection:null},{...proof,vercelProtection:{protection_metadata_consistent:false,reasons:['SSO disabled']}},
    {...proof,workerEgress:null},{...proof,workerEgress:{worker_route_counts_quiescent:false,reasons:['indirect URL configured']}},
    {...proof,archiveTransition:null},{...proof,archiveTransition:{review_package_consistent:false}},
    {...proof,historicAuthLineage:null},{...proof,historicAuthLineage:{historical_baseline_consistent:false}},
  ]){
    const r=assessRebuildPreflight(record(),q);
    assert.equal(r.preconditions_met,false);
    assert.equal(r.destructive_execution_authorized,false);
  }
});
test('CLI without private operator evidence cannot contact any hosted resource or approve reset',()=>{
  const run=spawnSync(process.execPath,[new URL('./oa5-test-rebuild-preflight.mjs',import.meta.url).pathname,'--check','/nonexistent-record.json','/nonexistent-archive','/nonexistent-cron.json','/nonexistent-live.json','/nonexistent-managed.json','/nonexistent-edge-bundles.json','/nonexistent-vercel-protection.json','/nonexistent-worker-egress.json','/nonexistent-transition-review.json','/nonexistent-auth-lineage.json'],{encoding:'utf8'});
  assert.equal(run.status,1);
  assert.match(run.stderr,/BLOCKED/);
  assert.doesNotMatch(run.stderr,/service_role|sk_live_/);
});

test('preflight can consume narrowly reviewed one-session count but never authorizes cleanup',()=>{
 const now=new Date('2026-11-09T11:05:00Z');
 const s={schema_version:1,project_ref:TEST_REF,captured_at_utc:'2026-11-09T11:04:10Z',
   counts:{...ARCHIVED_COUNTS,auth_sessions:6}};
 const a={schema_version:1,project_ref:TEST_REF,scope:REVIEWED_SESSION_LOSS_SCOPE,
   archive_auth_sessions:5,current_auth_sessions:6,approved_loss:true,
   reviewed_at_utc:'2026-11-09T11:04:45Z',evidence_ref:'private-review-0001'};
 const counted=assessTestLiveCensus(s,now,a);
 assert.equal(counted.ok,true);
 const gate=assessRebuildPreflight(record(),{...proof,liveCensus:counted});
 assert.equal(gate.preconditions_met,true);
 assert.equal(gate.destructive_execution_authorized,false);
 assert.equal(assessRebuildPreflight(record(),{...proof,cron:{ok:false},liveCensus:counted}).preconditions_met,false);
});

test('legacy combined provider review schema cannot satisfy seven independent provider evidence gates',()=>{
 const old=record();
 old.schema_version=1;
 old.evidence.test_only_provider_callbacks_and_sinks={reviewed:true,evidence_ref:'private-review-old'};
 for(const key of [
  'meta_test_app_phone_webhook_ownership','paystack_test_keys_callbacks_and_replay',
  'flutterwave_test_disabled_or_sandbox_only','smtp_safe_sink_recipients_and_auth_redirects',
  'firebase_fcm_test_sender_and_qa_devices','ai_parser_and_notification_worker_egress',
  'test_admin_merchant_domains_and_auth_redirects',
 ])delete old.evidence[key];
 const result=assessRebuildPreflight(old,proof);
 assert.equal(result.preconditions_met,false);
 assert.equal(result.destructive_execution_authorized,false);
});
test('each provider surface requires independent evidence even when all other categories pass',()=>{
 for(const key of [
  'meta_test_app_phone_webhook_ownership','paystack_test_keys_callbacks_and_replay',
  'flutterwave_test_disabled_or_sandbox_only','smtp_safe_sink_recipients_and_auth_redirects',
  'firebase_fcm_test_sender_and_qa_devices','ai_parser_and_notification_worker_egress',
  'test_admin_merchant_domains_and_auth_redirects',
 ]){
  const missing=record();delete missing.evidence[key];
  assert.equal(assessRebuildPreflight(missing,proof).preconditions_met,false,key);
  const unchecked=record();unchecked.evidence[key].reviewed=false;
  assert.equal(assessRebuildPreflight(unchecked,proof).preconditions_met,false,key);
 }
});
test('a single reused opaque ref cannot stand in for multiple independent provider and custody reviews',()=>{
 const duplicate=record();
 duplicate.evidence.meta_test_app_phone_webhook_ownership.evidence_ref=
    duplicate.evidence.paystack_test_keys_callbacks_and_replay.evidence_ref;
 const result=assessRebuildPreflight(duplicate,proof);
 assert.equal(result.preconditions_met,false);
 assert.equal(result.destructive_execution_authorized,false);
 assert.match(result.reasons.join(' '),/cannot reuse one evidence reference/);
});

test('historical Edge bundles are a separate mandatory evidence precondition, not a deployment approval',()=>{
 const r=assessRebuildPreflight(record(),{
  ...proof,edgeBundles:{metadata_matches_historical_baseline:false,
                       edge_deployment_authorized:false,
                       destructive_execution_authorized:false}
 });
 assert.equal(r.preconditions_met,false);
 assert.equal(r.destructive_execution_authorized,false);
 assert.match(r.reasons.join(' '),/Edge bundle SHA/);
 const a=assessRebuildPreflight(record(),proof);
 assert.equal(a.preconditions_met,true);
 assert.equal(a.destructive_execution_authorized,false);
});

test('Vercel Standard Authentication and domain metadata is mandatory, not actual HTTP or reviewer approval',()=>{
 const missing=assessRebuildPreflight(record(),{...proof,vercelProtection:undefined});
 assert.equal(missing.preconditions_met,false);
 assert.match(missing.reasons.join('\n'),/Vercel protection metadata/);
 const weakened=assessRebuildPreflight(record(),{...proof,
  vercelProtection:{protection_metadata_consistent:false,
                    signed_out_preview_challenge_verified:false,hosted_change_authorized:false}
 });
 assert.equal(weakened.preconditions_met,false);
 const ok=assessRebuildPreflight(record(),proof);
 assert.equal(ok.preconditions_met,true);
 assert.equal(ok.destructive_execution_authorized,false);
});

test('direct cron has no URL but indirectly callable worker URL settings are an independent blocker',()=>{
 const missing=assessRebuildPreflight(record(),{...proof,workerEgress:null});
 assert.equal(missing.preconditions_met,false);
 assert.match(missing.reasons.join(' '),/indirect pg_net worker/);
 const configured=assessRebuildPreflight(record(),{
  ...proof,workerEgress:{worker_route_counts_quiescent:false,
                         reasons:['notification_worker_url configured']}
 });
 assert.equal(configured.preconditions_met,false);
 assert.equal(configured.destructive_execution_authorized,false);
 const safe=assessRebuildPreflight(record(),proof);
 assert.equal(safe.preconditions_met,true);
 assert.equal(safe.destructive_execution_authorized,false);
});

test('historical Test Auth/admin/merchant membership grant lineage is independently required',()=>{
 const missing=assessRebuildPreflight(record(),{...proof,historicAuthLineage:null});
 assert.equal(missing.preconditions_met,false);
 assert.match(missing.reasons.join(' '),/Historical Test Auth/);
 assert.equal(missing.destructive_execution_authorized,false);
 const allowed=assessRebuildPreflight(record(),proof);
 assert.equal(allowed.preconditions_met,true);
 assert.equal(allowed.destructive_execution_authorized,false);
});
