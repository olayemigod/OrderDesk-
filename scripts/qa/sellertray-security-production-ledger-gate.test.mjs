import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assessSecurityReleaseMigrationCoverage,
  REQUIRED_SECURITY_MIGRATIONS,
} from './sellertray-security-production-ledger-gate.mjs';

const securityFiles=REQUIRED_SECURITY_MIGRATIONS.map(
  x=>x.version+'_'+x.name+'.sql'
);
const applied=[{version:'20261104180647',name:'pos_draft_delete_financial_documents_guard'}];

test('blocks with no full independently checked production migration ledger',()=>{
  assert.throws(()=>assessSecurityReleaseMigrationCoverage(securityFiles,[]),/Full, independently verified/);
  assert.throws(()=>assessSecurityReleaseMigrationCoverage(securityFiles,{}),/Full, independently verified/);
});

test('rejects duplicate or malformed production migration ledger versions',()=>{
  assert.throws(()=>assessSecurityReleaseMigrationCoverage(securityFiles,
    [...applied, ...applied]),/repeated migration version/);
  assert.throws(()=>assessSecurityReleaseMigrationCoverage(securityFiles,['bogus']),/14-digit/);
});

test('detects C2 foundations stranded BELOW the latest applied hotfix version',()=>{
  const result=assessSecurityReleaseMigrationCoverage([
    '20261102150000_c2_branch_subscription_authority.sql',
    '20261104180647_pos_draft_delete_financial_documents_guard.sql',
    ...securityFiles,
  ],applied);
  assert.equal(result.safeForSecurityOnlyReview,false);
  assert.equal(result.missingBeforeLast.length,1);
  assert.equal(result.c2Outstanding.length,1);
  assert.equal(result.latestApplied,'20261104180647');
});

test('a complete ledger with only the two expected future security migrations passes SOURCE-ORDER review',()=>{
  const result=assessSecurityReleaseMigrationCoverage([
    '20261104180647_pos_draft_delete_financial_documents_guard.sql',
    ...securityFiles,
  ],applied);
  assert.equal(result.safeForSecurityOnlyReview,true);
  assert.equal(result.missingBeforeLast.length,0);
  assert.equal(result.unknownReleaseOrder.length,0);
  assert.equal(result.pendingAfterLast.length,2);
});

test('future C2 and other unapplied feature versions still block a security-only release',()=>{
  const result=assessSecurityReleaseMigrationCoverage([
    ...securityFiles,
    '20261104220000_c2_future_catalogue.sql',
    '20261104234000_cost_aware_inventory_adjustment.sql',
  ],applied);
  assert.equal(result.safeForSecurityOnlyReview,false);
  assert.equal(result.c2Outstanding.length,1);
  assert.equal(result.unknownReleaseOrder.length,1);
});

test('missing either canonical security migration fails closed',()=>{
  const result=assessSecurityReleaseMigrationCoverage([securityFiles[0]],applied);
  assert.equal(result.safeForSecurityOnlyReview,false);
  assert.equal(result.missingRequired.length,1);
});

test('duplicate source version and version-only ledger mismatch fail closed',()=>{
  assert.throws(()=>assessSecurityReleaseMigrationCoverage([
    ...securityFiles, '20261104213746_another_migration.sql',
  ],applied),/Duplicate source migration version/);
  const result=assessSecurityReleaseMigrationCoverage([
    ...securityFiles,'20261104180647_pos_draft_delete_financial_documents_guard.sql',
  ],[{version:'20261104180648',name:'untracked_emergency_hotfix'}]);
  assert.equal(result.safeForSecurityOnlyReview,false);
  assert.ok(result.missingBeforeLast.some(x=>x.version==='20261104180647'));
});

test('CLI never silently succeeds when a checkout path contains URL fragment/query characters',()=>{
  const dir=mkdtempSync(join(tmpdir(),'sellertray#release?guard-'));
  const script=join(dir,'ledger-gate.mjs');
  const symlink=join(dir,'via#link?.mjs');
  try {
    copyFileSync(fileURLToPath(new URL('./sellertray-security-production-ledger-gate.mjs',import.meta.url)),script);
    symlinkSync(script,symlink);
    for (const entry of [script,symlink]) {
      const result=spawnSync(process.execPath,[entry,'--bogus'],{
        encoding:'utf8',
        env:{...process.env},
      });
      assert.equal(result.status,1,
        'Mandatory release gate must never silently exit 0 for checkout '+entry);
      assert.match(result.stderr,/Usage: node scripts\/qa\/sellertray-security-production-ledger-gate/);
    }
  } finally {
    rmSync(dir,{recursive:true,force:true});
  }
});
