import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
 TEST_PROJECT,PURPOSE,WORKERS,assessTestWorkerEgress
} from './oa5-test-worker-egress.mjs';

const now=new Date('2026-11-09T23:19:00Z');
const snapshot=()=>({
 schema_version:1,project_ref:TEST_PROJECT,purpose:PURPOSE,
 captured_at_utc:'2026-11-09T23:18:30Z',
 runtime_config_total_rows:0,usage_events_rows:0,
 agreement_processing_rows:0,pending_pg_net_requests:0,
 workers:WORKERS.map(w=>({...w,actual_runtime_config_key:w.runtime_config_key,function_overloads:1,security_definer:true,
  pg_net_http_post:true,source_has_production_ref:false,
  source_has_literal_url:false,configured_url_rows:0}))
});
test('historical two-worker zero-config census is a point-in-time signal, never authorization',()=>{
 const r=assessTestWorkerEgress(snapshot(),now);
 assert.equal(r.worker_route_counts_quiescent,true,r.reasons.join('\n'));
 assert.equal(r.provider_destination_verified,false);
 assert.equal(r.historical_http_delivery_verified,false);
 assert.equal(r.cron_pause_authorized,false);
 assert.equal(r.cleanup_authorized,false);
 assert.equal(r.destructive_execution_authorized,false);
});
test('wrong project, older snapshot schema, purpose and overbroad fields fail closed',()=>{
 for(const change of [
  x=>x.project_ref='eujxswjspolugrzlsjnn',
  x=>x.project_ref='test',
  x=>x.purpose='authorize-remote-reset',
  x=>x.schema_version=2,
  x=>x.private_key='secret',
  x=>x.workers[0].configured_url='https://example.invalid',
  x=>x.workers[0].secret='secret',
 ]){
  const x=snapshot();change(x);
  assert.equal(assessTestWorkerEgress(x,now).worker_route_counts_quiescent,false);
 }
 assert.equal(assessTestWorkerEgress(null,now).worker_route_counts_quiescent,false);
});
test('worker URL configuration or any scheduled work/pg_net count cannot silently grow',()=>{
 for(const [key,value] of [
  ['runtime_config_total_rows',1],['usage_events_rows',1],
  ['agreement_processing_rows',2],['pending_pg_net_requests',1],
  ['runtime_config_total_rows',null],['pending_pg_net_requests','0'],
  ['runtime_config_total_rows',-1],
 ]){
  const x=snapshot();x[key]=value;
  assert.equal(assessTestWorkerEgress(x,now).worker_route_counts_quiescent,false,key);
 }
 for(const change of [
  x=>x.workers[0].configured_url_rows=1,
  x=>x.workers[1].configured_url_rows=null,
  x=>x.workers[0].source_has_production_ref=true,
  x=>x.workers[1].source_has_literal_url=true,
  x=>x.workers[0].source_sha256='a'.repeat(64),
  x=>x.workers[1].actual_runtime_config_key='unknown-destination-key',
  x=>x.workers[0].pg_net_http_post=false,
  x=>x.workers[1].security_definer=false,
  x=>x.workers[0].function_overloads=2,
 ]){
  const x=snapshot();change(x);
  assert.equal(assessTestWorkerEgress(x,now).worker_route_counts_quiescent,false);
 }
});
test('unexpected or missing worker SQL function and duplicate job identity block',()=>{
 for(const change of [
  x=>x.workers.pop(),
  x=>x.workers.push({...x.workers[0],jobid:5}),
  x=>x.workers[0].jobid=99,
  x=>x.workers[0].jobname='unknown',
  x=>x.workers[0].runtime_config_key='production_webhook_url',
  x=>x.workers[0].function_identity='public.fake_worker',
  x=>x.workers[0]={...x.workers[1]},
 ]){
  const x=snapshot();change(x);
  assert.equal(assessTestWorkerEgress(x,now).worker_route_counts_quiescent,false);
 }
});
test('stale and future evidence cannot be accepted as current pre-maintenance proof',()=>{
 for(const time of [
  '2026-11-09T23:08:59Z','2026-11-09T23:19:01Z',
  '2026-11-09T23:18:30+00:00','invalid',null,
 ]){
  const x=snapshot();x.captured_at_utc=time;
  assert.equal(assessTestWorkerEgress(x,now).worker_route_counts_quiescent,false,String(time));
 }
});
test('operator without private Test snapshot cannot contact providers or bypass review',()=>{
 const r=spawnSync(process.execPath,[
  new URL('./oa5-test-worker-egress.mjs',import.meta.url).pathname,
  '--check','/missing-private-oa5-test-worker-census.json'
 ],{encoding:'utf8'});
 assert.equal(r.status,1);
 assert.match(r.stderr,/BLOCKED/);
 assert.doesNotMatch(r.stderr,/service_role|sk_live_|recipient/);
});
