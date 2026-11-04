#!/usr/bin/env node
// Offline-only archive evidence guard. No network, database, or reset actions.
import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEST_REF = 'iukgsukdoowvnhlfmpml';
export const FILES = ['roles.sql','schema.sql','data.sql','history_schema.sql','history_data.sql'];
const counts = {auth_users:5,businesses:3,branches:3,commercial_orders:5,
  agreement_packages:5,order_form_confirmations:5,migration_rows:52};
const validUtc = x => typeof x==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(x) && Number.isFinite(Date.parse(x));

export function checkTestArchive(directory) {
  const errors=[], base=resolve(directory);
  let m;
  try {
    const file=join(base,'archive-evidence.json'),s=lstatSync(file);
    if(!s.isFile() || s.isSymbolicLink()) throw Error('Unsafe manifest');
    m=JSON.parse(readFileSync(file,'utf8'));
  } catch {return {ok:false,errors:['Missing valid private archive manifest']};}
  if(m.project_ref!==TEST_REF || m.schema_version!==1)
    errors.push('Archive must identify the existing Test project');
  if(!validUtc(m.backup_completed_utc)) errors.push('Missing UTC backup timestamp');
  if(!m.files || Object.keys(m.files).sort().join()!==[...FILES].sort().join())
    errors.push('Exactly five SQL archive checksums are required');
  for(const name of FILES) {
    try {
      const file=join(base,name),stat=lstatSync(file);
      if(!stat.isFile() || stat.isSymbolicLink()) throw Error('Not a regular file');
      const data=readFileSync(file),hash=createHash('sha256').update(data).digest('hex');
      if(!data.length || m.files?.[name]?.sha256!==hash || m.files?.[name]?.bytes!==data.length)
        errors.push(name+': checksum or size mismatch');
    } catch {errors.push(name+': file unavailable or unsafe');}
  }
  if(m.restore_target!=='local_disposable' || m.restore_verified!==true ||
     !validUtc(m.restore_completed_utc)) errors.push('Actual disposable-local restore proof missing');
  for(const [key,count] of Object.entries(counts))
    if(m.restore_counts?.[key]!==count) errors.push('Restore count mismatch: '+key);
  if(m.secrets_committed_to_git!==false) errors.push('Secrets must remain outside source control');
  return {ok:errors.length===0,errors};
}

if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  if(process.argv.length!==4 || process.argv[2]!=='--check') {
    console.error('Usage: node scripts/qa/oa5-test-backup-manifest.mjs --check <protected-archive-directory>');
    process.exitCode=2;
  } else {
    const result=checkTestArchive(process.argv[3]);
    if(!result.ok) { console.error('OA5 archive evidence blocked'); for(const e of result.errors)console.error(' - '+e);process.exitCode=1; }
    else console.log('Archive hashes and operator restore-count evidence match. NOT a reset approval.');
  }
}
