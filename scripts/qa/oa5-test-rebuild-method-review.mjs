#!/usr/bin/env node
/**
 * SellerTray OA5: Test-only reconstruction method candidate B, REVIEW ONLY.
 * No network, SQL, CLI database operations, service changes or approvals.
 * The old Auth cohort is retained and must not acquire authority after the
 * clean canonical replay. A structural PASS is only a method description.
 */
import {lstatSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const TEST_REF='iukgsukdoowvnhlfmpml';
export const PRODUCTION_REF='eujxswjspolugrzlsjnn';
export const INTENT='test-only-retain-managed-auth-canonical-replay-method-review';
export const MIGRATIONS=461;
export const STAGES=Object.freeze([
 'archive_and_disposable_restore_proven',
 'legacy_preview_and_reviewer_custody_verified',
 'provider_console_ingress_and_egress_contained',
 'test_specific_four_cron_pause_approved_separately',
 'fresh_post_pause_cron_and_network_zero_queue',
 'cli_v3_exact_target_affected_objects_independently_reviewed',
 'separately_authorized_test_user_schema_retirement_and_full_canonical_replay',
 'retained_historical_auth_zero_authority_and_synthetic_positive_controls',
 'post_replay_merchant_admin_whatsapp_payment_and_offline_acceptance',
 'separately_authorized_test_cron_and_callbacks_reenable'
]);
export const BOUNDARIES=Object.freeze({
  historical_ledger:'encrypted_archive_only',
  user_created_sql:'reviewed_test_only_retirement_and_full_canonical_replay',
  managed_auth_users:'retain_original_five_without_canonical_authority',
  managed_auth_sessions:'retain_original_state_no_revoke_without_separate_approval',
  managed_storage:'preserve_buckets_and_validate_objects_by_storage_api',
  managed_cron:'preserve_four_jobs_paused_only_under_separate_approval',
  edge_functions:'retain_original_five_bundles_until_reviewed_qa_deployment',
  vercel_previews:'preserve_five_original_previews_and_reviewer_access',
  providers:'no_external_delivery_during_reconstruction',
  production:'excluded_completely',
  migration_replay:'all_461_original_order_no_repair_no_omission',
  initial_seed:'no_automatic_seed_only_later_reviewed_synthetic_fixture',
  subscription_runtime:'legacy_business_authority_c2_inert'
});
export const IRREVERSIBLE=Object.freeze({
  sql_archive_recovers_auth_secrets_or_mfa:false,
  sql_archive_restores_actual_storage_object_bytes:false,
  sql_archive_recalls_provider_delivery:false,
  remote_reset_deletes_managed_auth_users_automatically:false,
  remote_reset_proves_historical_preview_access:false,
  source_migration_pass_proves_hosted_provider_isolation:false
});
const exact=(o,k)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).sort().join('|')===[...k].sort().join('|');
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const SHA256=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);

export function assessRebuildMethodCandidate(record,{sourceSha,sourceInventory}={}){
 const reasons=[];
 const result=()=>({
  candidate_method_structurally_consistent:reasons.length===0,
  method_independently_approved:false,
  exact_remote_cli_side_effects_dry_run_verified:false,
  historical_auth_post_replay_quarantine_verified:false,
  provider_console_quiescence_verified:false,
  hosted_test_reconstruction_authorized:false,
  cron_pause_authorized:false,
  production_cutover_authorized:false,
  reasons
 });
 if(!exact(record,['schema_version','project_ref','intent','source_sha','migration_inventory_sha256',
     'migration_count','method','boundaries','irreversible_assumptions','stages'])){
  reasons.push('Missing or unexpected Test-only method review fields');return result();
 }
 if(record.schema_version!==1||record.project_ref!==TEST_REF||record.intent!==INTENT||
    record.method!=='retain_managed_auth_quarantine_clean_canonical')
  reasons.push('Incorrect target or unsupported hosted reconstruction strategy');
 if(!SHA(sourceSha)||record.source_sha!==sourceSha||!SHA256(record.migration_inventory_sha256)||
     record.migration_count!==MIGRATIONS||!sourceInventory?.structural_source_check_passed||
     sourceInventory.source_migrations_scanned!==MIGRATIONS||
     record.migration_inventory_sha256!==sourceInventory.source_inventory_sha256)
  reasons.push('Exact Git SHA and all 457 ordered canonical source migration hashes must match');
 if(!exact(record.boundaries,Object.keys(BOUNDARIES)))
  reasons.push('Every user-created and managed-service scope must be explicitly classified');
 else for(const [k,value] of Object.entries(BOUNDARIES))
   if(record.boundaries[k]!==value)reasons.push('Unreviewed deletion, skipped replay or authority drift: '+k);
 if(!exact(record.irreversible_assumptions,Object.keys(IRREVERSIBLE)))
  reasons.push('Unrecoverable hosted/service side effects are incompletely classified');
 else for(const [k,v] of Object.entries(IRREVERSIBLE))
   if(record.irreversible_assumptions[k]!==v)
     reasons.push('Unsupported managed-service recovery assertion: '+k);
 if(!Array.isArray(record.stages)||record.stages.length!==STAGES.length||
    record.stages.some((s,i)=>s!==STAGES[i]))
  reasons.push('Pre-review, pause, reset, Auth quarantine and reactivation stage order drifted');
 return result();
}
async function main(){
 if(process.argv.length!==5||process.argv[2]!=='--check'){
  console.error('Usage: node scripts/qa/oa5-test-rebuild-method-review.mjs --check <private-Test-method-candidate.json> <canonical-migration-directory>');
  process.exitCode=2;return;
 }
 let record,sourceSha;
 try {
  const file=resolve(process.argv[3]),st=lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size>65536)throw Error('unsafe');
  record=JSON.parse(readFileSync(file,'utf8'));
  sourceSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',timeout:10000}).trim();
 } catch {
  console.error('BLOCKED: protected method record or local Git checkout not available');
  process.exitCode=1;return;
 }
 const {inventoryOa5SourceMigrationScope}=await import('./oa5-migration-scope-inventory.mjs');
 const inventory=inventoryOa5SourceMigrationScope(resolve(process.argv[4]));
 const review=assessRebuildMethodCandidate(record,{sourceSha,sourceInventory:inventory});
 console.log(JSON.stringify(review,null,2));
 if(!review.candidate_method_structurally_consistent)process.exitCode=1;
 console.log('NOT VERIFIED: external providers, historical Preview review, live remote CLI object plan, managed state or old Auth JWT behavior.');
 console.log('NOT AUTHORIZED: no cron pause, remote reset, Auth deletion, hosted seed, provider delivery or Production/C2 release.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();

