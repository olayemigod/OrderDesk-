#!/usr/bin/env node
/**
 * OA5 isolated Test: offline worker-egress READ-ONLY metadata review.
 *
 * The two minutely cron jobs call SECURITY DEFINER SQL functions that can
 * queue pg_net requests. Neither cron command itself contains an endpoint.
 * These functions look up URLs in sellertray_private.runtime_config.
 *
 * This gate confirms only a recent count-based snapshot: the historical
 * worker destination configuration is absent, no pending HTTP, and no
 * queued agreement/usage business tasks. It never reads URL/secret values,
 * calls the database/provider, or grants permission to pause/delete/reset.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const TEST_PROJECT='iukgsukdoowvnhlfmpml';
export const PURPOSE='pre-maintenance-worker-egress-census';
const MAX_AGE_MS=10*60*1000;
export const WORKERS=Object.freeze([
 Object.freeze({jobid:2,jobname:'sellertray-whatsapp-notification-retry',
   function_identity:'sellertray_private.kick_whatsapp_notification_worker',
   runtime_config_key:'notification_worker_url',
   source_sha256:'8e1f13dc854def4de0163809fc6a82227e1a5bf2daccba159fc66008e24d0520'}),
 Object.freeze({jobid:3,jobname:'sellertray-merchant-push-retry',
   function_identity:'sellertray_private.kick_merchant_push_worker',
   runtime_config_key:'merchant_push_worker_url',
   source_sha256:'b052a9982fcd993ff5f4e5ba3a41eacd4f27c3335e775811a08d6aa16accb56c'}),
]);
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join('|')===[...keys].sort().join('|');

export function assessTestWorkerEgress(snapshot,now=new Date()){
 const reasons=[];
 const report=()=>({
  worker_route_counts_quiescent:reasons.length===0,
  provider_destination_verified:false,
  historical_http_delivery_verified:false,
  cron_pause_authorized:false,
  cleanup_authorized:false,
  destructive_execution_authorized:false,
  reasons
 });
 if(!exact(snapshot,[
   'schema_version','project_ref','purpose','captured_at_utc',
   'runtime_config_total_rows','usage_events_rows',
   'agreement_processing_rows','pending_pg_net_requests','workers','sql_network_surface'
 ])){
   reasons.push('Missing or secret-bearing Test worker egress census');
   return report();
 }
 if(snapshot.schema_version!==2||snapshot.project_ref!==TEST_PROJECT||snapshot.purpose!==PURPOSE)
  reasons.push('Wrong isolated Test identity or worker-census purpose');
 const captured=typeof snapshot.captured_at_utc==='string'&&
   /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(snapshot.captured_at_utc)
   ?Date.parse(snapshot.captured_at_utc):NaN;
 if(!Number.isFinite(captured)||captured>now.getTime()||now.getTime()-captured>MAX_AGE_MS)
  reasons.push('Worker egress census is missing, future-dated or older than ten minutes');
 for(const [field,label] of [
  ['runtime_config_total_rows','Test private runtime configuration'],
  ['usage_events_rows','Historical usage events'],
  ['agreement_processing_rows','Historical agreement retry work'],
  ['pending_pg_net_requests','Pending HTTP queue']
 ]){
  if(snapshot[field]!==0)reasons.push('Unexpected '+label+' count; inspect Test privately before pause');
 }
 const network=snapshot.sql_network_surface;
 if(!exact(network,[
  'public_function_count','private_function_count',
  'public_direct_http_functions','private_direct_http_functions',
  'public_literal_endpoint_functions','private_literal_endpoint_functions',
  'retained_pgnet_responses'
 ])){
  reasons.push('Missing or overbroad Test SQL network surface inventory');
 }else{
  for(const [field,expected] of [
   ['public_function_count',479],
   ['private_function_count',8],
   ['public_direct_http_functions',0],
   ['private_direct_http_functions',2],
   ['public_literal_endpoint_functions',3],
   ['private_literal_endpoint_functions',0],
   ['retained_pgnet_responses',0]
  ]){
   if(network[field]!==expected)
    reasons.push('Test SQL outbound source or retained pg_net response census drift: '+field);
  }
 }
 if(!Array.isArray(snapshot.workers)||snapshot.workers.length!==WORKERS.length){
  reasons.push('Worker URL census must include exactly two known jobs');
  return report();
 }
 const seen=new Set();
 for(const worker of snapshot.workers){
  if(!exact(worker,[
    'jobid','jobname','function_identity','runtime_config_key',
    'actual_runtime_config_key','source_sha256',
    'function_overloads','security_definer','pg_net_http_post',
    'source_has_production_ref','source_has_literal_url','configured_url_rows'
  ])){
   reasons.push('Unexpected or secret-bearing worker URL evidence field');continue;
  }
  const want=WORKERS.find(x=>x.jobid===worker.jobid);
  if(!want||seen.has(worker.jobid)){
   reasons.push('Unknown or repeated worker cron identity');continue;
  }
  seen.add(worker.jobid);
  if(worker.jobname!==want.jobname||
     worker.function_identity!==want.function_identity||
     worker.runtime_config_key!==want.runtime_config_key||
     worker.actual_runtime_config_key!==want.runtime_config_key||
     worker.source_sha256!==want.source_sha256)
   reasons.push('Worker function/job/config-key mapping changed');
  if(worker.function_overloads!==1||worker.security_definer!==true||
     worker.pg_net_http_post!==true||
     worker.source_has_production_ref!==false||
     worker.source_has_literal_url!==false||
     worker.configured_url_rows!==0)
   reasons.push('Worker SQL dispatch or destination configuration changed: '+worker.jobname);
 }
 if(seen.size!==WORKERS.length)reasons.push('Missing one or more historical Test workers');
 return report();
}
function main(){
 if(process.argv.length!==4||process.argv[2]!=='--check'){
  console.error('Usage: node scripts/qa/oa5-test-worker-egress.mjs --check <private-Test-worker-counts.json>');
  process.exitCode=2;return;
 }
 let snapshot;
 try{snapshot=JSON.parse(readFileSync(resolve(process.argv[3]),'utf8'));}
 catch{
  console.error('BLOCKED: private Test worker egress evidence unavailable');
  process.exitCode=1;return;
 }
 const result=assessTestWorkerEgress(snapshot);
 if(!result.worker_route_counts_quiescent){
  console.error('BLOCKED: worker URL/cron dispatch state drifted or evidence is incomplete');
  for(const reason of result.reasons)console.error(' - '+reason);
  process.exitCode=1;return;
 }
 console.log('PASS: sampled Test worker config URLs absent; no queued worker/settlement/Agreement work.');
 console.log('NOT VERIFIED: provider-console, historical HTTP delivery or all outbound integrations.');
 console.log('NOT AUTHORIZED: no hosted cron pause, Test cleanup, Auth deletion or provider request.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
