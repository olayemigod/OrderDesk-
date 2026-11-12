#!/usr/bin/env node
/**
 * OA5 historical Agreement Test archive -> clean canonical Test transition.
 * OFFLINE REVIEW ONLY. Never reads business rows, calls a provider, connects
 * to hosted Supabase, applies SQL, manipulates cron or authorizes a reset.
 *
 * Input is a privately kept, count-only human reconciliation record. A valid
 * record is not proof that SQL contents/managed Auth or Storage are restorable.
 */
import {readFileSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkTestArchive} from './oa5-test-backup-manifest.mjs';
import {inventoryOa5SourceMigrationScope} from './oa5-migration-scope-inventory.mjs';

export const TEST_REF='iukgsukdoowvnhlfmpml';
export const SOURCE_MIGRATIONS=457;
export const PRESERVE_COUNTS=Object.freeze({
  applied_migration_ledger:54,
  agreement_packages:5,
  order_form_confirmations:5,
  commercial_orders:5,
  platform_admin_audit_events:14,
  auth_users:5,
  auth_sessions:5,
  storage_buckets:3,
  storage_objects:0,
  deployed_edge_functions:5,
  historical_vercel_previews:5
});
// Managed service state and reviewer access must NOT be implicitly removed
// because an old SQL archive has been checksummed.
export const PRESERVE_DISPOSITIONS=Object.freeze({
  applied_migration_ledger:'encrypted_archive_only',
  agreement_packages:'encrypted_archive_only',
  order_form_confirmations:'encrypted_archive_only',
  commercial_orders:'encrypted_archive_only',
  platform_admin_audit_events:'encrypted_archive_only',
  auth_users:'retain_hosted_pending_separate_auth_review',
  auth_sessions:'retain_hosted_pending_separate_auth_review',
  storage_buckets:'retain_hosted_pending_separate_storage_review',
  storage_objects:'retain_hosted_pending_separate_storage_review',
  deployed_edge_functions:'retain_hosted_and_preserve_bundle',
  historical_vercel_previews:'retain_reviewer_access_and_preserve_capture'
});
const exact=(o,keys)=>o!==null && typeof o==='object' && !Array.isArray(o) &&
  Object.keys(o).sort().join('|')===[...keys].sort().join('|');
const digest=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const sha=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
const opaque=s=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(s);

export function assessArchiveCanonicalTransition(record,{archive,sourceInventory,sourceSha}={}){
  const reasons=[];
  const report=()=>({
    review_package_consistent:reasons.length===0,
    historical_live_data_migration_approved:false,
    canonical_ci_independently_verified:false,
    managed_auth_storage_recovery_verified:false,
    provider_isolation_verified:false,
    hosted_test_reconstruction_authorized:false,
    production_cutover_authorized:false,
    reasons
  });
  if(!exact(record,['schema_version','project_ref','purpose','source','preservation','transition']))
    return {...report(),review_package_consistent:false,
      reasons:['Missing or unexpected private archive-to-canonical review fields']};
  if(record.schema_version!==1||record.project_ref!==TEST_REF||
     record.purpose!=='archive-historical-evidence-and-reseed-synthetic-test')
    reasons.push('Wrong project, schema or archival-only transition purpose');
  if(!archive?.ok)reasons.push('Original five-file encrypted-archive/restore evidence check did not pass');
  if(!exact(record.source,[
    'git_sha','migration_count','migration_inventory_sha256','database_ci_run_id',
    'database_ci_success_reviewed','legacy_business_authority_reviewed',
    'c2_runtime_not_activated_reviewed','evidence_ref'
  ]))reasons.push('Exact canonical replay/source CI evidence is incomplete');
  const src=record.source||{};
  if(!sha(sourceSha)||src.git_sha!==sourceSha)
    reasons.push('Source SHA differs from the reviewed local checkout');
  if(!sourceInventory?.structural_source_check_passed||
     sourceInventory.source_migrations_scanned!==SOURCE_MIGRATIONS||
     src.migration_count!==SOURCE_MIGRATIONS||
     !digest(src.migration_inventory_sha256)||
     src.migration_inventory_sha256!==sourceInventory?.source_inventory_sha256)
    reasons.push('Canonical SQL source count/content fingerprint mismatch');
  if(!Number.isSafeInteger(src.database_ci_run_id)||src.database_ci_run_id<=0||
     src.database_ci_success_reviewed!==true||
     src.legacy_business_authority_reviewed!==true||
     src.c2_runtime_not_activated_reviewed!==true||
     !opaque(src.evidence_ref))
    reasons.push('Reviewed clean Database CI / pre-C2 coexistence proof is missing');
  if(!exact(record.preservation,Object.keys(PRESERVE_COUNTS)))
    reasons.push('Every historical Agreement/merchant/Auth/Storage/Edge/Preview class needs a disposition');
  const usedRefs=new Set();
  for(const [category,count] of Object.entries(PRESERVE_COUNTS)){
    const row=record.preservation?.[category];
    if(!exact(row,['archive_count','disposition','custody_reviewed','evidence_ref'])||
       row.archive_count!==count||row.disposition!==PRESERVE_DISPOSITIONS[category]||
       row.custody_reviewed!==true||!opaque(row.evidence_ref)){
      reasons.push('Unaccepted historical evidence disposition: '+category);
      continue;
    }
    if(usedRefs.has(row.evidence_ref))
      reasons.push('Distinct historical evidence classes need independent review references: '+category);
    usedRefs.add(row.evidence_ref);
  }
  if(!exact(record.transition,[
    'strategy','migration_ledger_policy','managed_auth_storage_policy',
    'fixture_policy','legacy_sql_rows_imported','historical_auth_identities_reused',
    'historical_provider_destinations_reused','historical_storage_objects_reused',
    'execution_scope','rehearsal_evidence_ref'
  ]))reasons.push('Exact archive-only to synthetic canonical transition policy is missing');
  const t=record.transition||{};
  if(t.strategy!=='retain-historical-evidence-build-clean-canonical'||
     t.migration_ledger_policy!=='archive-only-never-repair'||
     t.managed_auth_storage_policy!=='independent-approval-required'||
     t.fixture_policy!=='synthetic-only'||
     t.execution_scope!=='disposable-local-review-only'||
     !opaque(t.rehearsal_evidence_ref)||
     t.legacy_sql_rows_imported!==0||
     t.historical_auth_identities_reused!==0||
     t.historical_provider_destinations_reused!==0||
     t.historical_storage_objects_reused!==0)
    reasons.push('Historical rows, identities, destinations or objects cannot silently become canonical QA truth');
  if(usedRefs.has(t.rehearsal_evidence_ref)||t.rehearsal_evidence_ref===src.evidence_ref)
    reasons.push('Migration rehearsal evidence must have its own independent reference');
  return report();
}

function privateRecord(path){
  const file=resolve(path),stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>131072)throw Error('unsafe');
  return JSON.parse(readFileSync(file,'utf8'));
}
function main(){
  if(process.argv.length!==6||process.argv[2]!=='--check'){
    console.error('Usage: node scripts/qa/oa5-archive-canonical-transition.mjs --check <private-transition-record.json> <protected-archive-directory> <canonical-migrations-directory>');
    process.exitCode=2;return;
  }
  let record,sourceSha;
  try{
    record=privateRecord(process.argv[3]);
    sourceSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',timeout:10000}).trim();
  }catch{
    console.error('BLOCKED: private record or exact local Git identity missing; no details disclosed');
    process.exitCode=1;return;
  }
  const result=assessArchiveCanonicalTransition(record,{
    archive:checkTestArchive(process.argv[4]),
    sourceInventory:inventoryOa5SourceMigrationScope(process.argv[5]),
    sourceSha
  });
  console.log(JSON.stringify(result,null,2));
  if(!result.review_package_consistent)process.exitCode=1;
  console.log('NOT PROVED: historical rows import parity, managed Auth/Storage recovery or independent hosted provider isolation.');
  console.log('NOT AUTHORIZED: no Test cleanup, cron pause, reset, deployment or C2 Production cutover.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
