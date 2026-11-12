import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {assessArchiveCanonicalTransition,PRESERVE_COUNTS,PRESERVE_DISPOSITIONS,TEST_REF,SOURCE_MIGRATIONS} from './oa5-archive-canonical-transition.mjs';

const sha='a'.repeat(40), inventory='b'.repeat(64);
const src={structural_source_check_passed:true,
  source_migrations_scanned:SOURCE_MIGRATIONS,source_inventory_sha256:inventory};
const checks={archive:{ok:true},sourceInventory:src,sourceSha:sha};
const valid=()=>({
  schema_version:1,project_ref:TEST_REF,
  purpose:'archive-historical-evidence-and-reseed-synthetic-test',
  source:{git_sha:sha,migration_count:SOURCE_MIGRATIONS,
    migration_inventory_sha256:inventory,database_ci_run_id:43069823113,
    database_ci_success_reviewed:true,legacy_business_authority_reviewed:true,
    c2_runtime_not_activated_reviewed:true,evidence_ref:'private-db-ci-evidence'},
  preservation:Object.fromEntries(Object.entries(PRESERVE_COUNTS).map(([key,count],i)=>[
    key,{archive_count:count,disposition:PRESERVE_DISPOSITIONS[key],
      custody_reviewed:true,evidence_ref:'private-archive-class-'+String(i).padStart(3,'0')}
  ])),
  transition:{strategy:'retain-historical-evidence-build-clean-canonical',
    migration_ledger_policy:'archive-only-never-repair',
    managed_auth_storage_policy:'independent-approval-required',
    fixture_policy:'synthetic-only',legacy_sql_rows_imported:0,
    historical_auth_identities_reused:0,historical_provider_destinations_reused:0,
    historical_storage_objects_reused:0,execution_scope:'disposable-local-review-only',
    rehearsal_evidence_ref:'private-transition-rehearsal'}
});
test('complete synthetic review package is still no hosted/recovery/CI acceptance',()=>{
 const r=assessArchiveCanonicalTransition(valid(),checks);
 assert.equal(r.review_package_consistent,true,r.reasons.join(' '));
 for(const field of ['historical_live_data_migration_approved',
   'canonical_ci_independently_verified','managed_auth_storage_recovery_verified',
   'provider_isolation_verified','hosted_test_reconstruction_authorized',
   'production_cutover_authorized'])assert.equal(r[field],false);
});
test('Test identity, format, extra private data and purpose must match exactly',()=>{
 for(const change of [x=>x.project_ref='eujxswjspolugrzlsjnn',
   x=>x.schema_version=2,x=>x.purpose='restore-historical-records',
   x=>x.jwt='private-token',x=>x.preservation.auth_users.email='personal@example.com']){
  const x=valid();change(x);
  assert.equal(assessArchiveCanonicalTransition(x,checks).review_package_consistent,false);
 }
 assert.equal(assessArchiveCanonicalTransition(null,checks).review_package_consistent,false);
});
test('missing archive integrity, changed migration set or wrong SHA block',()=>{
 for(const overrides of [{archive:{ok:false}},{sourceSha:'c'.repeat(40)},
   {sourceInventory:{...src,source_migrations_scanned:456}},
   {sourceInventory:{...src,source_inventory_sha256:'c'.repeat(64)}},
   {sourceInventory:{...src,structural_source_check_passed:false}}]){
  assert.equal(assessArchiveCanonicalTransition(valid(),{...checks,...overrides}).review_package_consistent,false);
 }
});
test('every historical evidence class is retained only in the protected archive',()=>{
 for(const key of Object.keys(PRESERVE_COUNTS)){
  const x=valid();delete x.preservation[key];
  assert.equal(assessArchiveCanonicalTransition(x,checks).review_package_consistent,false,key);
  const y=valid();y.preservation[key].disposition='reimport-into-production';
  assert.equal(assessArchiveCanonicalTransition(y,checks).review_package_consistent,false,key);
  const z=valid();z.preservation[key].archive_count+=1;
  assert.equal(assessArchiveCanonicalTransition(z,checks).review_package_consistent,false,key);
 }
});
test('one custody reference cannot attest two distinct historical evidence classes',()=>{
 const x=valid();
 x.preservation.auth_sessions.evidence_ref=x.preservation.auth_users.evidence_ref;
 assert.equal(assessArchiveCanonicalTransition(x,checks).review_package_consistent,false);
});
test('no legacy identities, SQL rows, provider sinks or Storage objects may be reused',()=>{
 for(const key of ['legacy_sql_rows_imported','historical_auth_identities_reused',
    'historical_provider_destinations_reused','historical_storage_objects_reused']){
   const x=valid();x.transition[key]=1;
   assert.equal(assessArchiveCanonicalTransition(x,checks).review_package_consistent,false,key);
 }
 for(const key of ['database_ci_success_reviewed','legacy_business_authority_reviewed',
    'c2_runtime_not_activated_reviewed']){
  const x=valid();x.source[key]=false;
  assert.equal(assessArchiveCanonicalTransition(x,checks).review_package_consistent,false,key);
 }
});
test('source CI reference and rehearsal evidence must be independent',()=>{
 const x=valid();x.transition.rehearsal_evidence_ref=x.source.evidence_ref;
 assert.equal(assessArchiveCanonicalTransition(x,checks).review_package_consistent,false);
});
test('missing private record CLI fails without printing secret names, paths or contacting providers',()=>{
 const script=new URL('./oa5-archive-canonical-transition.mjs',import.meta.url).pathname;
 const secret='/nonexistent-sellertray-private-personal-email.json';
 const p=spawnSync(process.execPath,[script,'--check',secret,
   '/nonexistent-archive','/nonexistent-migrations'],{encoding:'utf8'});
 assert.equal(p.status,1);
 assert.match(p.stderr,/BLOCKED/);
 assert.equal(p.stderr.includes(secret),false);
});

test('live Auth, Storage, Edge bundles and Preview reviewer access stay preserved',()=>{
 for(const key of ['auth_users','auth_sessions','storage_buckets','storage_objects',
    'deployed_edge_functions','historical_vercel_previews']){
  const r=valid();r.preservation[key].disposition='encrypted_archive_only';
  assert.equal(assessArchiveCanonicalTransition(r,checks).review_package_consistent,false,key);
 }
 const a=valid();a.preservation.historical_vercel_previews.custody_reviewed=false;
 assert.equal(assessArchiveCanonicalTransition(a,checks).review_package_consistent,false);
});
