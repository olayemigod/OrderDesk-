#!/usr/bin/env node
/**
 * Read-only SellerTray OA5/C2 source migration classification.
 *
 * Filenames are candidate labels, NOT permissions to skip, reorder, apply, or
 * mark a migration. Treat all unnamed/baseline dependencies as unreviewed.
 * Never contacts Supabase, runs SQL, connects to production or creates a
 * database. SQL bytes are hashed to pin a local snapshot, but not executed or
 * printed. No local file/SQL paths are echoed.
 */
import {readdirSync,lstatSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const MIGRATION=/^([0-9]{14})_([A-Za-z0-9_][A-Za-z0-9_-]*)\.sql$/;
const MAX_FILES=5000;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

export function classifyOa5Candidate(name){
 if(name.startsWith('c2_'))return 'c2_candidate';
 if(name.startsWith('oa5_')||name.startsWith('pre_c2_')||
    name==='legacy_commercial_adjustment_confirmed_payment_guard')
  return 'oa5_candidate';
 return 'unclassified';
}
export function inventoryOa5SourceMigrationScope(directory,{reviewWindow=false}={}){
 const reasons=[],rows=[],versions=new Set();
 const failure=(code)=>{reasons.push(code);};
 try{
  const root=resolve(directory);
  const st=lstatSync(root);
  if(!st.isDirectory()||st.isSymbolicLink())throw Error('unsafe');
  const entries=readdirSync(root,{withFileTypes:true});
  if(entries.length>MAX_FILES)throw Error('too-many');
  for(const entry of entries){
   if(!entry.isFile()||entry.isSymbolicLink()){
    failure('UNSAFE_OR_UNEXPECTED_MIGRATION_DIRECTORY_ENTRY');
    continue;
   }
   if(!entry.name.endsWith('.sql'))continue;
   const match=MIGRATION.exec(entry.name);
   if(!match){failure('UNVERSIONED_SQL_FILENAME');continue;}
   if(versions.has(match[1]))failure('DUPLICATE_MIGRATION_VERSION');
   versions.add(match[1]);
   const file=join(root,entry.name);
   const stat=lstatSync(file);
   if(!stat.isFile()||stat.isSymbolicLink()||stat.size<=0||
      stat.size>12*1024*1024){
    failure('UNSAFE_OR_UNREVIEWED_MIGRATION_FILE');continue;
   }
   const content=readFileSync(file);
   rows.push({
    version:match[1],
    file:entry.name,
    group:classifyOa5Candidate(match[2]),
    digest:sha(content),
   });
  }
 }catch{failure('SOURCE_MIGRATION_DIRECTORY_UNAVAILABLE');}
 rows.sort((a,b)=>a.version.localeCompare(b.version)||a.file.localeCompare(b.file));
 if(!rows.length)failure('NO_SOURCE_MIGRATIONS');
 const oa5=rows.filter(r=>r.group==='oa5_candidate');
 const c2=rows.filter(r=>r.group==='c2_candidate');
 const unclassified=rows.filter(r=>r.group==='unclassified');
 if(!oa5.length)failure('NO_NAMED_OA5_CANDIDATES');
 const first=oa5.length?oa5[0].version:null;
 const last=oa5.length?oa5.at(-1).version:null;
 const within=first?rows.filter(r=>r.version>=first&&r.version<=last):[];
 const nonOa5=within.filter(r=>r.group!=='oa5_candidate');
 const c2Within=nonOa5.filter(r=>r.group==='c2_candidate');
 const otherWithin=nonOa5.filter(r=>r.group==='unclassified');
 const totalFingerprint=sha(rows.map(r=>r.file+':'+r.digest+'\n').join(''));
 const result={
  source_migrations_scanned:rows.length,
  source_inventory_sha256:totalFingerprint,
  structural_source_check_passed:reasons.length===0,
  oa5_named_candidates:oa5.length,
  c2_named_candidates:c2.length,
  unclassified_candidates:unclassified.length,
  oa5_candidate_window:first&&last?{first_version:first,last_version:last}:null,
  c2_between_first_and_last_oa5:c2Within.length,
  unclassified_between_first_and_last_oa5:otherWithin.length,
  other_than_oa5_between_first_and_last_oa5:nonOa5.length,
  full_sql_semantic_dependency_review_verified:false,
  oa5_rebuild_migration_set_approved:false,
  disposable_local_replay_verified:false,
  current_test_migration_ledger_parity_verified:false,
  production_migration_authorized:false,
  hosted_test_reset_authorized:false,
  failure_codes:[...new Set(reasons)]
 };
 if(reviewWindow===true){
  // Source filenames and SHA-256 are review metadata, never SQL bodies/paths.
  // The review interval itself is NOT an approved or executable migration set.
  result.review_window_files=within.map(r=>({version:r.version,file:r.file,
   label:r.group,content_sha256:r.digest}));
 }
 return result;
}
function main(){
 if(process.argv.length!==4||!['--inventory','--review-window'].includes(process.argv[2])){
  console.error('Usage: node scripts/qa/oa5-migration-scope-inventory.mjs --inventory|--review-window <local-source-migration-directory>');
  process.exitCode=2;return;
 }
 const report=inventoryOa5SourceMigrationScope(process.argv[3],{reviewWindow:process.argv[2]==='--review-window'});
 console.log(JSON.stringify(report,null,2));
 console.log('NOT VERIFIED: file naming does not prove SQL dependencies, OA5/C2 isolation, clean baseline or disposable-local migration replay.');
 console.log('NOT AUTHORIZED: no Supabase Test/Production migration, ledger repair, cron pause, provider callback or hosted reset.');
 if(!report.structural_source_check_passed)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
