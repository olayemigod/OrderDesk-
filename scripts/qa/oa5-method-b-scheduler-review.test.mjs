import test from 'node:test';
import assert from 'node:assert/strict';
import {classifySchedulerSurface,reviewSchedulerSources} from './oa5-method-b-scheduler-review.mjs';

test('flags named cron schedule and alternate scheduling entry points',()=>{
 for(const sql of [
  "SELECT cron.schedule('job','* * * * *','select 1');",
  'SELECT "cron"."schedule_in_database"(a,b,c);',
  'SELECT cron.alter_job(1,active=>false);',
  'SELECT cron.unschedule(1);',
  'CREATE EXTENSION IF NOT EXISTS pg_cron;',
  "ALTER SYSTEM SET cron.launch_active_jobs='off';"
 ]){
  assert.equal(classifySchedulerSurface(sql).cron_reference,true);
 }
});
test('flags network surfaces, function bodies and possible transaction boundaries without claiming execution',()=>{
 const flags=classifySchedulerSurface("BEGIN; DO $$ BEGIN EXECUTE 'select net.http_post(1)'; END $$; COMMIT;");
 assert.equal(flags.network_reference,true);
 assert.equal(flags.possible_transaction_boundary,true);
 assert.equal(flags.possible_dynamic_sql,true);
 assert.equal(classifySchedulerSurface('SELECT 1;').cron_reference,false);
 assert.equal(classifySchedulerSurface('select pg_net;').network_reference,true);
});
test('fails closed when the reviewed migration corpus is unavailable',()=>{
 assert.throws(()=>reviewSchedulerSources('/nonexistent/oa5-migrations'),/Canonical corpus/);
});
