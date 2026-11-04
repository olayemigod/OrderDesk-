#!/usr/bin/env node
/**
 * Read-only production release guard. Compares the ENTIRE verified applied
 * migration ledger with source files. A high-water mark alone cannot reveal
 * C2/OA5 migrations silently stranded by a later emergency hotfix version.
 *
 * This tool does NOT connect to Supabase, invoke providers, run SQL, deploy,
 * approve migration ordering or alter the production migration ledger.
 */
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REQUIRED_SECURITY_MIGRATIONS = Object.freeze([
  {version:'20261104213746',name:'restrict_branch_snapshot_trigger_execute_acl'},
  {version:'20261104214453',name:'fix_security_definer_report_scope_bypass'},
]);

function parseSourceName(file) {
  const match = /^(\d{14})_([a-zA-Z0-9_-]+)\.sql$/.exec(file);
  return match ? {version:match[1],name:match[2]} : null;
}
function normalizeApplied(input) {
  const rows = Array.isArray(input) ? input : input?.migrations;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Full, independently verified Production migration-ledger JSON array is required.');
  }
  const seen=new Set();
  return rows.map((item)=>{
    const version = typeof item==='string' ? item : item?.version;
    const name = typeof item==='object' && item!==null ? item.name : undefined;
    if (typeof version!=='string' || !/^\d{14}$/.test(version)
      || (name!==undefined && (typeof name!=='string'||name.length===0))) {
      throw new Error('Production ledger must contain 14-digit migration versions and optional nonempty names.');
    }
    if (seen.has(version)) throw new Error('Production ledger contains a repeated migration version: '+version);
    seen.add(version);
    return {version,name};
  });
}

export function assessSecurityReleaseMigrationCoverage(files,appliedInput) {
  const applied=normalizeApplied(appliedInput);
  const latestApplied=applied.map(x=>x.version).sort().at(-1);
  const appliedSet=new Set(applied.map(x=>x.version));
  const source=files.map(parseSourceName).filter(Boolean).sort((a,b)=>a.version.localeCompare(b.version));
  const sourceVersions=new Set();
  for (const row of source) {
    if (sourceVersions.has(row.version)) throw new Error('Duplicate source migration version: '+row.version);
    sourceVersions.add(row.version);
  }
  const missingBeforeLast=source.filter(row=>row.version<=latestApplied&&!appliedSet.has(row.version));
  const pendingAfterLast=source.filter(row=>row.version>latestApplied&&!appliedSet.has(row.version));
  const c2Outstanding=[...missingBeforeLast,...pendingAfterLast].filter(row=>row.name.startsWith('c2_'));
  const missingRequired=REQUIRED_SECURITY_MIGRATIONS.filter(expected=>
    !source.some(row=>row.version===expected.version&&row.name===expected.name));
  const unknownReleaseOrder=[...missingBeforeLast,...pendingAfterLast]
    .filter(row=>!row.name.startsWith('c2_')
      && !REQUIRED_SECURITY_MIGRATIONS.some(required=>
        required.version===row.version&&required.name===row.name));
  const safeForSecurityOnlyReview=missingBeforeLast.length===0
    && c2Outstanding.length===0
    && missingRequired.length===0
    && unknownReleaseOrder.length===0;
  return {safeForSecurityOnlyReview,latestApplied,
    sourceCount:source.length,appliedCount:applied.length,
    missingBeforeLast,pendingAfterLast,c2Outstanding,unknownReleaseOrder,missingRequired};
}

function main() {
  const args=process.argv.slice(2);
  if(args.length!==2 || args[0]!=='--ledger-json') {
    console.error('Usage: node scripts/qa/sellertray-security-production-ledger-gate.mjs --ledger-json /secure/path/applied-migrations.json');
    process.exitCode=1;
    return;
  }
  try {
    const ledger=JSON.parse(readFileSync(args[1],'utf8'));
    const root=new URL('../../supabase/migrations/',import.meta.url);
    const result=assessSecurityReleaseMigrationCoverage(readdirSync(fileURLToPath(root)),ledger);
    console.log('Latest observed applied version: '+result.latestApplied);
    console.log('Applied/source migration counts: '+result.appliedCount+'/'+result.sourceCount);
    console.log('Unapplied source versions AT OR BEFORE latest applied: '+result.missingBeforeLast.length);
    console.log('Unapplied source versions after latest applied: '+result.pendingAfterLast.length);
    console.log('Outstanding C2 foundations: '+result.c2Outstanding.length);
    console.log('Other pending changes needing separate release review: '+result.unknownReleaseOrder.length);
    console.log('Missing canonical security files: '+result.missingRequired.length);
    if(result.missingBeforeLast.length) {
      console.error('Older unapplied source versions: '+result.missingBeforeLast.slice(0,12)
        .map(x=>x.version+'_'+x.name).join(', '));
    }
    if(!result.safeForSecurityOnlyReview){
      console.error('BLOCKED: do not deploy security as an assumed in-order release; reconcile old skipped migrations and C2/OA5 separation.');
      process.exitCode=1;
    }else{
      console.log('Source/ledger ordering is structurally compatible; separate release approval, backups and exact SQL/human verification are still mandatory.');
    }
  } catch (error) {
    console.error('BLOCKED: '+(error instanceof Error?error.message:String(error)));
    process.exitCode=1;
  }
}

// Compare canonical filesystem paths, never raw file:// concatenation:
// '#' and '?' in checkout directories must not suppress the mandatory guard.
// realpathSync also covers ordinary symlinked CLI entrypoints.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
