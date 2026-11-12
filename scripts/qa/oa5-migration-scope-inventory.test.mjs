import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {
 classifyOa5Candidate,inventoryOa5SourceMigrationScope,
} from './oa5-migration-scope-inventory.mjs';

function fixture(names,fn){
 const root=mkdtempSync(join(tmpdir(),'sellertray-oa5-slice-'));
 try{
  for(const name of names)writeFileSync(join(root,name),'-- synthetic SQL; never executed\n');
  return fn(root);
 }finally{rmSync(root,{recursive:true,force:true});}
}
const names=[
 '20261101010101_foundation.sql',
 '20261101010102_oa5_lifecycle.sql',
 '20261101010103_c2_branch_plan.sql',
 '20261101010104_unclassified_precondition.sql',
 '20261101010105_pre_c2_bridge.sql',
 '20261101010106_legacy_commercial_adjustment_confirmed_payment_guard.sql',
 '20261101010107_c2_target.sql',
];

test('name classification is conservative: candidates are not approved migrations',()=>{
 assert.equal(classifyOa5Candidate('oa5_lifecycle'),'oa5_candidate');
 assert.equal(classifyOa5Candidate('pre_c2_bridge'),'oa5_candidate');
 assert.equal(classifyOa5Candidate('oa5a_notification_intent'),'oa5_candidate');
 assert.equal(classifyOa5Candidate('oa5b_onboarding_report'),'oa5_candidate');
 assert.equal(classifyOa5Candidate('oa5c_historical_agreement_package_verifier_convergence'),'oa5_candidate');
 assert.equal(classifyOa5Candidate('legacy_commercial_adjustment_confirmed_payment_guard'),'oa5_candidate');
 assert.equal(classifyOa5Candidate('c2_branch_plan'),'c2_candidate');
 assert.equal(classifyOa5Candidate('commercial_oa5_unprefixed'),'unclassified');
 assert.equal(classifyOa5Candidate('oa4_fixture'),'unclassified');
});
test('interleaved C2 and unclassified migrations are counted but never silently selected',()=>fixture(names,root=>{
 const r=inventoryOa5SourceMigrationScope(root);
 assert.equal(r.structural_source_check_passed,true);
 assert.equal(r.source_migrations_scanned,7);
 assert.equal(r.oa5_named_candidates,3);
 assert.equal(r.c2_named_candidates,2);
 assert.equal(r.unclassified_candidates,2);
 assert.equal(r.c2_between_first_and_last_oa5,1);
 assert.equal(r.unclassified_between_first_and_last_oa5,1);
 assert.equal(r.other_than_oa5_between_first_and_last_oa5,2);
 assert.deepEqual(r.oa5_candidate_window,{
  first_version:'20261101010102',last_version:'20261101010106'
 });
 assert.match(r.source_inventory_sha256,/^[a-f0-9]{64}$/);
 for(const key of [
  'full_sql_semantic_dependency_review_verified',
  'oa5_rebuild_migration_set_approved',
  'disposable_local_replay_verified',
  'current_test_migration_ledger_parity_verified',
  'production_migration_authorized',
  'hosted_test_reset_authorized',
 ])assert.equal(r[key],false);
 assert.deepEqual(r.failure_codes,[]);
}));
test('content-only changes alter source snapshot digest without exposing SQL',()=>fixture(names,root=>{
 const before=inventoryOa5SourceMigrationScope(root);
 writeFileSync(join(root,names[1]),'-- forbidden-prod-secret-here\n');
 const after=inventoryOa5SourceMigrationScope(root);
 assert.equal(before.source_migrations_scanned,after.source_migrations_scanned);
 assert.notEqual(before.source_inventory_sha256,after.source_inventory_sha256);
 assert.equal(JSON.stringify(after).includes('forbidden-prod-secret-here'),false);
}));
test('repeated numeric migration versions do not become safe despite OA5 prefix',()=>fixture([
 '20261101010101_oa5_first.sql','20261101010101_c2_collision.sql'
],root=>{
 const r=inventoryOa5SourceMigrationScope(root);
 assert.equal(r.structural_source_check_passed,false);
 assert.ok(r.failure_codes.includes('DUPLICATE_MIGRATION_VERSION'));
 assert.equal(r.oa5_rebuild_migration_set_approved,false);
}));
test('unknown SQL filename and empty files fail closed',()=>fixture([
 '20261101010101_oa5_first.sql','20261101010102_unknown.sql'
],root=>{
 writeFileSync(join(root,'20261101010102_unknown.sql'),'');
 writeFileSync(join(root,'human_without_timestamp.sql'),'select 1;');
 const r=inventoryOa5SourceMigrationScope(root);
 assert.equal(r.structural_source_check_passed,false);
 assert.ok(r.failure_codes.includes('UNVERSIONED_SQL_FILENAME'));
 assert.ok(r.failure_codes.includes('UNSAFE_OR_UNREVIEWED_MIGRATION_FILE'));
}));
test('unknown symbolic-link migrations are not followed',()=>fixture([
 '20261101010101_oa5_first.sql'
],root=>{
 symlinkSync(join(root,'20261101010101_oa5_first.sql'),join(root,'20261101010102_oa5_alias.sql'));
 const r=inventoryOa5SourceMigrationScope(root);
 assert.equal(r.structural_source_check_passed,false);
 assert.ok(r.failure_codes.includes('UNSAFE_OR_UNEXPECTED_MIGRATION_DIRECTORY_ENTRY'));
}));
test('CLI prints no migration SQL, file names or private source location',()=>fixture(names,root=>{
 const cli=new URL('./oa5-migration-scope-inventory.mjs',import.meta.url).pathname;
 const p=spawnSync(process.execPath,[cli,'--inventory',root],{encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);
 const report=JSON.parse(p.stdout.split('\nNOT VERIFIED:')[0]);
 assert.equal(report.source_migrations_scanned,7);
 assert.equal(report.c2_between_first_and_last_oa5,1);
 for(const s of [root,names[0],names[1],'-- synthetic SQL; never executed'])
  assert.equal(p.stdout.includes(s),false);
}));
test('CLI fails on nonexistent path without leaking it',()=>{
 const cli=new URL('./oa5-migration-scope-inventory.mjs',import.meta.url).pathname;
 const privatePath='/nonexistent-private-secret-path';
 const p=spawnSync(process.execPath,[cli,'--inventory',privatePath],{encoding:'utf8'});
 assert.equal(p.status,1);
 assert.equal(p.stdout.includes(privatePath),false);
 assert.match(p.stdout,/SOURCE_MIGRATION_DIRECTORY_UNAVAILABLE/);
});

test('explicit review-window mode yields only ordered file identities and content hashes, never SQL',()=>fixture(names,root=>{
 const r=inventoryOa5SourceMigrationScope(root,{reviewWindow:true});
 assert.equal(r.review_window_files.length,5);
 assert.deepEqual(r.review_window_files.map(x=>x.version),[
  '20261101010102','20261101010103','20261101010104',
  '20261101010105','20261101010106'
 ]);
 assert.equal(r.review_window_files.filter(x=>x.label==='c2_candidate').length,1);
 for(const row of r.review_window_files){
  assert.match(row.file,/^[a-zA-Z0-9_.-]+\.sql$/);
  assert.match(row.content_sha256,/^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(row).includes('-- synthetic SQL'),false);
 }
 const noReview=inventoryOa5SourceMigrationScope(root);
 assert.equal(Object.hasOwn(noReview,'review_window_files'),false);
 const cli=new URL('./oa5-migration-scope-inventory.mjs',import.meta.url).pathname;
 const p=spawnSync(process.execPath,[cli,'--review-window',root],{encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);
 const o=JSON.parse(p.stdout.split('\nNOT VERIFIED:')[0]);
 assert.equal(o.review_window_files.length,5);
 assert.equal(p.stdout.includes(root),false);
 assert.equal(p.stdout.includes('-- synthetic SQL'),false);
 assert.equal(o.hosted_test_reset_authorized,false);
}));
