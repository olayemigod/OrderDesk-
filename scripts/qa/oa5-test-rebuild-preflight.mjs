#!/usr/bin/env node
/**
 * SellerTray OA5: OFFLINE PRE-RESET OPERATOR EVIDENCE GATE.
 * No network, SQL, migrations, provider calls, Vercel actions, or reset.
 * All true evidence flags are operator assertions requiring independent review.
 * A pass is NOT destructive execution authorization.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkTestArchive} from './oa5-test-backup-manifest.mjs';
import {assessCronMaintenance,TEST_PROJECT} from './oa5-test-cron-maintenance-gate.mjs';
import {assessTestLiveCensus} from './oa5-test-live-census.mjs';

export const REQUIRED_EVIDENCE=Object.freeze([
  'archive_restore_reviewed',
  'five_historical_previews_preserved',
  'historical_reviewer_continuity',
  'historical_compiled_backend_boundary',
  'production_custom_domains_public',
  'vercel_preview_auth_protection',
  'test_only_ingress_freeze_reviewed',
  'test_only_provider_callbacks_and_sinks',
  'test_auth_sessions_storage_scope',
  'reversible_four_job_pause_approved',
  'reviewed_cleanup_method_and_scope',
  'rollback_operator_and_recovery_plan',
  'exact_source_migration_order_and_parity',
  'synthetic_fixture_and_retention_plan',
  'archive_to_current_live_state_reconciled',
]);
const exactKeys=(obj,keys)=>!!obj&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).sort().join('|')===[...keys].sort().join('|');
const sha=x=>typeof x==='string'&&/^[0-9a-f]{40}$/.test(x);

export function assessRebuildPreflight(record,{sourceSha,archive,cron,liveCensus}={}){
  const reasons=[];
  if(!exactKeys(record,['schema_version','project_ref','reviewed_source_sha','purpose','evidence']))
    return {preconditions_met:false,destructive_execution_authorized:false,
      reasons:['Missing or malformed private Test operator record']};
  if(record.schema_version!==1||record.project_ref!==TEST_PROJECT||
     record.purpose!=='pre-reset-human-review')
    reasons.push('Wrong Test project, purpose or schema');
  if(!sha(sourceSha)||record.reviewed_source_sha!==sourceSha)
    reasons.push('Reviewed Git source commit must equal the exact local checkout');
  if(!exactKeys(record.evidence,REQUIRED_EVIDENCE))
    reasons.push('Every named manual evidence category is required; no extras');
  for(const key of REQUIRED_EVIDENCE){
    const x=record.evidence?.[key];
    if(!exactKeys(x,['reviewed','evidence_ref'])||
       x.reviewed!==true||
       typeof x.evidence_ref!=='string'||
       !/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$/.test(x.evidence_ref))
      reasons.push('Independent protected evidence not reviewed: '+key);
  }
  if(!archive?.ok)reasons.push('Encrypted Test archive or disposable restore offline guard failed');
  if(!cron?.ok)reasons.push('Test cron all-age run / pg_net quiescence guard failed');
  if(!liveCensus?.ok)reasons.push('Archived Test dataset diverges from current hosted Test census');
  const preconditions_met=reasons.length===0;
  return {preconditions_met,destructive_execution_authorized:false,reasons,
    next:'A human must separately authorize the exact Test-only operation and verify provider quiescence immediately before execution'};
}

function main(){
  if(process.argv.length!==7||process.argv[2]!=='--check'){
    console.error('Usage: node scripts/qa/oa5-test-rebuild-preflight.mjs --check <private-record.json> <private-archive-directory> <private-fresh-cron-snapshot.json> <private-fresh-live-census.json>');
    process.exitCode=2;return;
  }
  let record,cronSnapshot,liveSnapshot,sourceSha;
  try{
    record=JSON.parse(readFileSync(resolve(process.argv[3]),'utf8'));
    cronSnapshot=JSON.parse(readFileSync(resolve(process.argv[5]),'utf8'));
    liveSnapshot=JSON.parse(readFileSync(resolve(process.argv[6]),'utf8'));
    sourceSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',timeout:10000}).trim();
  }catch{
    console.error('BLOCKED: private operator evidence, cron snapshot or Git identity unavailable');
    process.exitCode=1;return;
  }
  const archive=checkTestArchive(resolve(process.argv[4]));
  const cron=assessCronMaintenance(cronSnapshot);
  const liveCensus=assessTestLiveCensus(liveSnapshot);
  const result=assessRebuildPreflight(record,{sourceSha,archive,cron,liveCensus});
  if(!result.preconditions_met){
    console.error('BLOCKED: OA5 Test rebuild pre-reset evidence is incomplete.');
    for(const reason of result.reasons)console.error(' - '+reason);
    for(const reason of [...(archive.errors||[]),...(cron.reasons||[]),...(liveCensus.reasons||[])])
      console.error(' - '+reason);
    process.exitCode=1;return;
  }
  console.log('PASS: offline operator evidence preconditions recorded; independently review assertions.');
  console.log('NOT AUTHORIZED: no Test reset, SQL mutation, cron pause, provider callback, deployment or production change may be inferred.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
