#!/usr/bin/env node
// Read-only source census. This is not a SQL parser or permission to execute.
// All matches, including comments and function bodies, need manual review.
import {readdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inventoryOa5SourceMigrationScope} from './oa5-migration-scope-inventory.mjs';

const EXPECTED='d91f7762448aa0b1d4fc44093700e6bc48e20a6177c09bb8735ea01c98efa42c';
export function classifySchedulerSurface(sql){
 const text=sql.toLowerCase();
 return {
  cron_reference:/\b(?:pg_cron|cron)\b/.test(text),
  schedule_reference:/\b(?:schedule_in_database|schedule|unschedule|alter_job|launch_active_jobs)\b/.test(text),
  network_reference:/\b(?:pg_net|net\s*"?\s*\.|http_post|http_get|http_delete|http_request_queue)\b/.test(text),
  possible_transaction_boundary:/\b(?:begin|commit|rollback|start\s+transaction|end\s+transaction|abort)\b/.test(text),
  possible_dynamic_sql:/\bexecute\b/.test(text)
 };
}
export function reviewSchedulerSources(dir){
 const inventory=inventoryOa5SourceMigrationScope(dir);
 if(!inventory.structural_source_check_passed||inventory.source_migrations_scanned!==461||
    inventory.source_inventory_sha256!==EXPECTED) throw Error('Canonical corpus does not match reviewed source');
 const matches=[];
 for(const file of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort()){
  const flags=classifySchedulerSurface(readFileSync(join(dir,file),'utf8'));
  if(flags.cron_reference||flags.schedule_reference||flags.network_reference)matches.push({file,...flags});
 }
 return {files_scanned:461,source_inventory_sha256:EXPECTED,review_candidates:matches,
   lexical_census_only:true,hosted_scheduler_containment_verified:false,hosted_reconstruction_authorized:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3)throw Error('Expected canonical directory');
  console.log(JSON.stringify(reviewSchedulerSources(process.argv[2]),null,2));
 }catch{console.error('BLOCKED: unexpected source corpus or inaccessible file');process.exitCode=1;}
}
