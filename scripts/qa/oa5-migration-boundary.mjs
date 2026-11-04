#!/usr/bin/env node
/**
 * Read-only boundary check for OA5 production migration releases.
 * Never applies a migration, connects to a database or grants deployment.
 *
 * Requires a fresh, explicitly supplied last-applied migration value read from
 * the actual production ledger. Fail closed when newer C2 migrations are
 * interleaved ahead of the OA5 installer migrations.
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));

export function assessProductionMigrationBoundary(files, lastApplied) {
  if (!/^\d{14}$/.test(String(lastApplied ?? ''))) {
    return { ok:false, error:'A verified 14-digit production migration ledger version is required', pending:[], c2:[], oa5:[], other:[] };
  }
  const versions=files.map(name=>{
    const match=/^(\d{14})_([a-zA-Z0-9_-]+)\.sql$/.exec(name);
    return match?{version:match[1],name:match[2]}:null;
  }).filter(Boolean).sort((a,b)=>a.version.localeCompare(b.version));
  const pending=versions.filter(row=>row.version>lastApplied);
  const c2=pending.filter(row=>row.name.startsWith('c2_'));
  const oa5=pending.filter(row=>/^(oa5_|pre_c2_)/.test(row.name)
    || row.name === 'legacy_commercial_adjustment_confirmed_payment_guard');
  const other=pending.filter(row=>!c2.includes(row)&&!oa5.includes(row));
  // Source migration timestamp order is shared even for unrelated prerelease
  // C2 foundations; do not silently apply C2 schema/function updates in OA5.
  return {ok:c2.length===0&&other.length===0, pending,c2,oa5,other,
    error:c2.length||other.length?'Production migration sequence contains unapproved or unclassified pending migrations':null};
}

function main() {
  const ledger=process.env.SELLERTRAY_PRODUCTION_LAST_APPLIED_MIGRATION??'';
  const result=assessProductionMigrationBoundary(readdirSync(directory),ledger);
  if(!/^\d{14}$/.test(ledger)) {
    console.error(result.error);
    process.exitCode=1;
    return;
  }
  console.log('Source pending migrations beyond verified production ledger: '+result.pending.length);
  console.log('C2 foundation migrations requiring separate approval: '+result.c2.length);
  console.log('OA5/pre-C2 migrations: '+result.oa5.length);
  console.log('Unclassified pending migrations requiring review: '+result.other.length);
  if(!result.ok) {
    console.error('BLOCKED: do not run an automatic all-pending migration deployment as an OA5-only release.');
    console.error('Reconcile every pending migration against the governing C2/OA5 release approvals before deployment.');
    process.exitCode=1;
  } else {
    console.log('No C2/unclassified migration crosses the stated production ledger boundary. Human release gates still apply.');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url)===fileURLToPath(new URL('file://'+process.argv[1])))main();
