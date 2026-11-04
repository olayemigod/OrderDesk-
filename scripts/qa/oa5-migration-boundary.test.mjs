import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { assessProductionMigrationBoundary } from './oa5-migration-boundary.mjs';

const dbFiles=['20261102150000_c2_catalogue.sql','20261103181500_oa5_device.sql','20261104050000_oa5_installer.sql'];

test('fails closed without an independently verified production migration ledger',()=>{
  assert.equal(assessProductionMigrationBoundary(dbFiles,'').ok,false);
  assert.match(assessProductionMigrationBoundary(dbFiles,'123').error,/verified/);
});

test('pending C2 foundations block treating a full db push as an OA5-only release',()=>{
  const result=assessProductionMigrationBoundary(dbFiles,'20261102100606');
  assert.equal(result.ok,false);
  assert.equal(result.c2.length,1);
  assert.equal(result.oa5.length,2);
  assert.equal(result.other.length,0);
});

test('read-only OA5-only migration range may proceed to separate manual review',()=>{
  const result=assessProductionMigrationBoundary(dbFiles,'20261102150000');
  assert.equal(result.ok,true);
  assert.equal(result.c2.length,0);
  assert.equal(result.oa5.length,2);
});

test('unclassified migration types must not be silently applied with OA5',()=>{
  const result=assessProductionMigrationBoundary([...dbFiles,'20261104180000_unknown_feature.sql'],'20261102150000');
  assert.equal(result.ok,false);
  assert.equal(result.other.length,1);
});

test('verified 04/11/2026 full repository snapshot contains intertwined C2 and OA5 pending migrations',()=>{
  const directory=new URL('../../supabase/migrations/',import.meta.url);
  const result=assessProductionMigrationBoundary(readdirSync(directory),'20261102100606');
  assert.equal(result.ok,false);
  assert.ok(result.c2.length>=17);
  assert.ok(result.oa5.length>=14);
  assert.ok(result.pending.some(r=>r.name==='oa5_printer_default_displacement_typed_row_repair'));
  assert.ok(result.pending.some(r=>r.name==='c2_branch_subscription_authority'));
});
