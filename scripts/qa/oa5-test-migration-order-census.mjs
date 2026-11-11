#!/usr/bin/env node
/**
 * OA5/C2 source migration-order inventory, local filesystem only.
 *
 * This does not connect to Supabase or inspect SQL bodies. It never writes,
 * applies, resets, links, migrates or changes any database. It reports only
 * numeric counts and bounded status codes, not file paths, SQL, credentials,
 * migration names or private applied ledger versions.
 *
 * Historical Test uses a 54-row snapshot/import ledger that might not
 * correspond to canonical migration file versions in the repository. An
 * offline inventory cannot authorize a forward-only replay or Test rebuild.
 */
import {readdirSync,lstatSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const TEST_PROJECT='iukgsukdoowvnhlfmpml';
const MAX_FILES=5000;
const MIGRATION=/^([0-9]{14})_([A-Za-z0-9_][A-Za-z0-9_-]*)\.sql$/;
const VERSION=/^[0-9]{14}$/;
const own=(obj,keys)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&
 Object.keys(obj).sort().join('|')===[...keys].sort().join('|');
export function scanMigrationOrder(directory,snapshot=null){
 const errors=[];
 const result=()=>({
  source_file_count:versions.size,
  applied_migration_count:snapshot?.migrations?.length??null,
  source_applied_version_overlap:matched,
  applied_versions_absent_from_source:extra,
  source_versions_not_in_applied_ledger:unapplied,
  retroactive_unapplied_versions:retroactive,
  local_naming_and_uniqueness_passed:errors.length===0,
  live_ledger_parity_established:false,
  restoration_verified:false,
  direct_replay_authorized:false,
  destructive_execution_authorized:false,
  failure_codes:[...new Set(errors)]
 });
 const versions=new Map();
 let matched=null,extra=null,unapplied=null,retroactive=null;
 let entries;
 try{
  const root=resolve(directory);
  if(!lstatSync(root).isDirectory()||lstatSync(root).isSymbolicLink())
   throw Error('Unsafe migration root');
  entries=readdirSync(root,{withFileTypes:true});
  if(entries.length>MAX_FILES)throw Error('Too many files');
  for(const entry of entries){
   if(entry.isDirectory()||entry.isSymbolicLink()||!entry.isFile()){
    errors.push('UNSAFE_SOURCE_ENTRY');continue;
   }
   if(!entry.name.endsWith('.sql'))continue;
   const match=entry.name.match(MIGRATION);
   if(!match){errors.push('INVALID_MIGRATION_FILENAME');continue;}
   if(versions.has(match[1]))errors.push('DUPLICATE_SOURCE_MIGRATION_VERSION');
   versions.set(match[1],match[2]);
  }
 }catch{
  errors.push('MIGRATION_DIRECTORY_UNAVAILABLE');
  return result();
 }
 if(versions.size===0)errors.push('NO_SOURCE_MIGRATIONS');
 if(snapshot!==null){
  if(!own(snapshot,['schema_version','project_ref','migrations'])||
     snapshot.schema_version!==1||snapshot.project_ref!==TEST_PROJECT||
     !Array.isArray(snapshot.migrations)||snapshot.migrations.length>MAX_FILES){
   errors.push('INVALID_PRIVATE_TEST_APPLIED_LEDGER');
   return result();
  }
  const applied=new Set();
  for(const m of snapshot.migrations){
   if(!own(m,['version','name'])||
      typeof m.version!=='string'||!VERSION.test(m.version)||
      typeof m.name!=='string'||!/^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(m.name)||
      applied.has(m.version)){
    errors.push('INVALID_OR_DUPLICATE_APPLIED_MIGRATION');continue;
   }
   applied.add(m.version);
  }
  matched=[...applied].filter(v=>versions.has(v)).length;
  extra=[...applied].filter(v=>!versions.has(v)).length;
  unapplied=[...versions.keys()].filter(v=>!applied.has(v)).length;
  const maxApplied=[...applied].sort().at(-1);
  retroactive=[...versions.keys()].filter(v=>!applied.has(v)&&maxApplied&&v<maxApplied).length;
  // Historical standalone Test may intentionally hold snapshot-ledger versions
  // absent from the canonical source: do not automatically "repair" history.
  if(extra)errors.push('HISTORICAL_APPLIED_VERSION_NOT_IN_SOURCE');
  if(retroactive)errors.push('FORWARD_ONLY_MIGRATION_ORDER_HAZARD');
  if(unapplied)errors.push('CURRENT_SOURCE_NOT_YET_APPLIED_TO_TEST');
 }
 return result();
}
function main(){
 const [mode,sourceDir,snapshotFile]=process.argv.slice(2);
 if(mode!=='--scan'||!sourceDir||(process.argv.length!==4&&process.argv.length!==5)){
  console.error('Usage: node scripts/qa/oa5-test-migration-order-census.mjs --scan <local-supabase-migrations-dir> [private-test-applied-migrations.json]');
  process.exitCode=2;return;
 }
 let snapshot=null;
 if(snapshotFile){
  try{snapshot=JSON.parse(readFileSync(resolve(snapshotFile),'utf8'));}
  catch{
   console.error('BLOCKED: private Test migration ledger snapshot missing or malformed; no file content disclosed.');
   process.exitCode=1;return;
  }
 }
 const r=scanMigrationOrder(sourceDir,snapshot);
 console.log(JSON.stringify(r,null,2));
 console.log('NOT VERIFIED: hosted Test migration ledger parity, migration SQL compatibility or local restore.');
 console.log('NOT AUTHORIZED: no migration apply, production change, Test cleanup, cron pause or reset.');
 if(!r.local_naming_and_uniqueness_passed)
  process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
