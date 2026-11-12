import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {scanMigrationOrder,TEST_PROJECT} from './oa5-test-migration-order-census.mjs';

function fixture(names,fn){
 const root=mkdtempSync(join(tmpdir(),'sellertray-oa5-migrations-'));
 try{
  for(const name of names)writeFileSync(join(root,name),'-- synthetic SQL placeholder only\n');
  return fn(root);
 }finally{rmSync(root,{recursive:true,force:true});}
}
const snapshot=versions=>({
 schema_version:1,project_ref:TEST_PROJECT,
 migrations:versions.map(([version,name])=>({version,name}))
});
const files=[
 '20260101010101_create_first.sql',
 '20260101010102_second.sql',
 '20260101010104_final.sql'
];
test('source-only inventory never implies Test replay or reset authority',()=>fixture(files,root=>{
 const r=scanMigrationOrder(root);
 assert.equal(r.source_file_count,3);
 assert.equal(r.applied_migration_count,null);
 assert.equal(r.local_naming_and_uniqueness_passed,true);
 assert.equal(r.live_ledger_parity_established,false);
 assert.equal(r.restoration_verified,false);
 assert.equal(r.direct_replay_authorized,false);
 assert.equal(r.destructive_execution_authorized,false);
}));
test('staging ledger comparison detects late-added backdated migration hazard',()=>fixture(files,root=>{
 const applied=snapshot([
  ['20260101010101','create_first'],['20260101010104','final']
 ]);
 const r=scanMigrationOrder(root,applied);
 assert.equal(r.applied_migration_count,2);
 assert.equal(r.source_applied_version_overlap,2);
 assert.equal(r.applied_versions_absent_from_source,0);
 assert.equal(r.source_versions_not_in_applied_ledger,1);
 assert.equal(r.retroactive_unapplied_versions,1);
 assert.equal(r.local_naming_and_uniqueness_passed,true);
 assert.equal(r.local_applied_ledger_reconciliation_passed,false);
 assert.equal(r.source_applied_version_and_name_matches,2);
 assert.equal(r.source_applied_version_name_conflicts,0);
 assert.equal(r.unapplied_versions_after_latest_test_migration,0);
 assert.ok(r.failure_codes.includes('FORWARD_ONLY_MIGRATION_ORDER_HAZARD'));
}));
test('standalone historical Test migration IDs that differ from canonical source remain blocked',()=>fixture(files,root=>{
 const r=scanMigrationOrder(root,snapshot([['20261026234514','sellertray_schema_batch_001']]));
 assert.equal(r.source_applied_version_overlap,0);
 assert.equal(r.applied_versions_absent_from_source,1);
 assert.equal(r.source_versions_not_in_applied_ledger,3);
 assert.ok(r.failure_codes.includes('HISTORICAL_APPLIED_VERSION_NOT_IN_SOURCE'));
 assert.ok(r.failure_codes.includes('CURRENT_SOURCE_NOT_YET_APPLIED_TO_TEST'));
}));
test('synthetic exact ledger match is still not a hosted or restored acceptance',()=>fixture(files,root=>{
 const applied=snapshot([
  ['20260101010101','create_first'],
  ['20260101010102','second'],
  ['20260101010104','final']
 ]);
 const r=scanMigrationOrder(root,applied);
 assert.equal(r.local_naming_and_uniqueness_passed,true);
 assert.equal(r.source_applied_version_overlap,3);
 assert.equal(r.source_applied_version_and_name_matches,3);
 assert.equal(r.source_applied_version_name_conflicts,0);
 assert.equal(r.local_applied_ledger_reconciliation_passed,true);
 assert.equal(r.applied_versions_absent_from_source,0);
 assert.equal(r.source_versions_not_in_applied_ledger,0);
 assert.equal(r.retroactive_unapplied_versions,0);
 assert.equal(r.direct_replay_authorized,false);
 assert.equal(r.live_ledger_parity_established,false);
}));
test('duplicate timestamps and invalid SQL names cannot pass source census',()=>fixture([
 ...files,'20260101010101_collision.sql','not-a-version.sql'
],root=>{
 const r=scanMigrationOrder(root);
 assert.equal(r.local_naming_and_uniqueness_passed,false);
 assert.ok(r.failure_codes.includes('DUPLICATE_SOURCE_MIGRATION_VERSION'));
 assert.ok(r.failure_codes.includes('INVALID_MIGRATION_FILENAME'));
}));
test('no symlinks or traversal for source files and no private path in CLI error',()=>{
 fixture(files,root=>{
  const privateName='hidden-private-staging-key';
  const target=join(root,privateName+'.sql');
  symlinkSync(join(root,files[0]),target);
  const r=scanMigrationOrder(root);
  assert.ok(r.failure_codes.includes('UNSAFE_SOURCE_ENTRY'));
  const file=new URL('./oa5-test-migration-order-census.mjs',import.meta.url).pathname;
  const p=spawnSync(process.execPath,[file,'--scan',root],{encoding:'utf8'});
  assert.equal(p.status,1);
  assert.equal(p.stdout.includes(root),false);
  assert.equal(p.stdout.includes(privateName),false);
 });
});
test('private Test migration ledger duplicate or malformed entries fail without leaking',()=>fixture(files,root=>{
 const duplicate=snapshot([['20260101010101','first'],['20260101010101','first_duplicate']]);
 const r=scanMigrationOrder(root,duplicate);
 assert.equal(r.local_naming_and_uniqueness_passed,true);
 assert.equal(r.local_applied_ledger_reconciliation_passed,false);
 assert.ok(r.failure_codes.includes('INVALID_OR_DUPLICATE_APPLIED_MIGRATION'));
 const invalid=snapshot([['../secrets','bad']]);
 assert.ok(scanMigrationOrder(root,invalid).failure_codes.includes('INVALID_OR_DUPLICATE_APPLIED_MIGRATION'));
}));
test('CLI checks only local source and prints no SQL, paths or names',()=>fixture(files,root=>{
 const file=new URL('./oa5-test-migration-order-census.mjs',import.meta.url).pathname;
 const p=spawnSync(process.execPath,[file,'--scan',root],{encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);
 const r=JSON.parse(p.stdout.split('\nNOT VERIFIED:')[0]);
 assert.equal(r.source_file_count,3);
 assert.equal(r.direct_replay_authorized,false);
 for(const secret of [root,'create_first.sql','-- synthetic SQL placeholder'])
  assert.equal(p.stdout.includes(secret),false);
}));

test('same version with a different Test migration name is a collision, not a source filename defect',()=>fixture(files,root=>{
 const r=scanMigrationOrder(root,snapshot([
  ['20260101010101','unexpected_other_migration'],
  ['20260101010102','second'],
  ['20260101010104','final']
 ]));
 assert.equal(r.source_applied_version_overlap,3);
 assert.equal(r.source_applied_version_and_name_matches,2);
 assert.equal(r.source_applied_version_name_conflicts,1);
 assert.equal(r.local_naming_and_uniqueness_passed,true);
 assert.equal(r.local_applied_ledger_reconciliation_passed,false);
 assert.ok(r.failure_codes.includes('APPLIED_VERSION_NAME_CONFLICT'));
 assert.equal(r.direct_replay_authorized,false);
}));
test('later migrations are counted separately from retroactive unapplied files',()=>fixture(files,root=>{
 const r=scanMigrationOrder(root,snapshot([
  ['20260101010101','create_first'],
  ['20260101010102','second']
 ]));
 assert.equal(r.unapplied_versions_after_latest_test_migration,1);
 assert.equal(r.retroactive_unapplied_versions,0);
 assert.equal(r.source_versions_not_in_applied_ledger,1);
 assert.equal(r.local_applied_ledger_reconciliation_passed,false);
}));
test('CLI returns blocked exit for ledger drift while reporting source naming PASS',()=>fixture(files,root=>{
 const ledger=join(root,'private-test-ledger.json');
 writeFileSync(ledger,JSON.stringify(snapshot([['20260101010104','final']])));
 const cli=new URL('./oa5-test-migration-order-census.mjs',import.meta.url).pathname;
 const p=spawnSync(process.execPath,[cli,'--scan',root,ledger],{encoding:'utf8'});
 assert.equal(p.status,1);
 const r=JSON.parse(p.stdout.split('\nNOT VERIFIED:')[0]);
 assert.equal(r.local_naming_and_uniqueness_passed,true);
 assert.equal(r.local_applied_ledger_reconciliation_passed,false);
 assert.ok(r.failure_codes.includes('FORWARD_ONLY_MIGRATION_ORDER_HAZARD'));
 assert.equal(p.stdout.includes(ledger),false);
}));
