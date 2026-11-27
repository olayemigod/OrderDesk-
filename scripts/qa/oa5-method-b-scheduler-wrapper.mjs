#!/usr/bin/env node
// Offline candidate generator only. Never connects to any database.
// Exact reviewed SQL bytes; guards inserted inside the original transaction.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {reviewSchedulerSources} from './oa5-method-b-scheduler-review.mjs';
import {EXPECTED_JOBS} from './oa5-test-cron-maintenance-gate.mjs';
export const SPECS=Object.freeze([
 {file:'20260910234500_schedule_usage_settlement_preparation.sql',blob:'d0bf3c458f23589f04fe97e99efa378d974c118d',explicit:false,pause:'sellertray-prepare-usage-settlements'},
 {file:'20260913002145_customer_order_change_notifications.sql',blob:'266c3a08579127dd705008f15f53e4b45618736b',explicit:true,pause:'sellertray-whatsapp-notification-retry'},
 {file:'20260913023000_merchant_push_and_per_user_unread.sql',blob:'4b7abf7abc2f055c1600bc8edfe944535b04e663',explicit:true,pause:'sellertray-merchant-push-retry'},
 {file:'20261026073126_oa5a_lifecycle_notifications.sql',blob:'8c88544e7b51e8f06053e96fd6bd2309364775f9',explicit:false,pause:'sellertray-lifecycle-notifications'}
]);
const lifecycle={jobname:'sellertray-lifecycle-notifications',schedule:'17 * * * *',
 command_sha256:createHash('sha256').update('select public.materialize_sellertray_lifecycle_notifications();').digest('hex')};
const q=s=>"'"+s.replaceAll("'","''")+"'";
const blobHash=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');

function guard(spec,after){
 const hasLifecycle=after&&spec.pause===lifecycle.jobname;
 const historical=EXPECTED_JOBS.map(j=>'('+j.jobid+'::bigint,'+q(j.jobname)+','+q(j.schedule)+','+q(j.command_sha256)+')').join(',\n');
 return [
 'DO $oa5_guard$',
 'DECLARE v_id bigint; v_config_count bigint;',
 'BEGIN',
 " IF current_user <> 'postgres' OR current_database() <> 'postgres'",
 " OR (SELECT count(*) FROM public.tenants)<>0",
 " OR EXISTS(SELECT 1 FROM net.http_request_queue)",
 " OR EXISTS(SELECT 1 FROM cron.job_run_details WHERE end_time IS NULL)",
 " THEN RAISE EXCEPTION 'OA5 unexpected role, merchants or queued work'; END IF;",
 " IF to_regclass('sellertray_private.runtime_config') IS NOT NULL THEN",
 "  EXECUTE 'SELECT count(*) FROM sellertray_private.runtime_config' INTO v_config_count;",
 "  IF v_config_count<>0 THEN RAISE EXCEPTION 'OA5 runtime routes not empty'; END IF;",
 ' END IF;',
 // Check historical IDs and commands before altering job status.
 ' IF EXISTS(SELECT 1 FROM (VALUES '+historical+') AS expected(id,name,schedule,digest)',
 '   WHERE NOT EXISTS(SELECT 1 FROM cron.job j WHERE j.jobid=expected.id AND j.jobname=expected.name',
 "    AND j.schedule=expected.schedule AND j.username='postgres'",
 "    AND encode(sha256(convert_to(j.command,'UTF8')),'hex')=expected.digest))",
 " THEN RAISE EXCEPTION 'OA5 historical cron identity drift'; END IF;",
 ...(hasLifecycle?[
 " IF NOT EXISTS(SELECT 1 FROM cron.job j WHERE j.jobname="+q(lifecycle.jobname),
 "  AND j.schedule="+q(lifecycle.schedule)+" AND j.username='postgres'",
 "  AND encode(sha256(convert_to(j.command,'UTF8')),'hex')="+q(lifecycle.command_sha256)+")",
 " THEN RAISE EXCEPTION 'OA5 lifecycle job drift'; END IF;"
 ]:[]),
 " IF (SELECT count(*) FROM cron.job)<>"+(hasLifecycle?5:4),
 " THEN RAISE EXCEPTION 'OA5 unexpected cron roster'; END IF;",
 ...(after?[
 ' SELECT jobid INTO STRICT v_id FROM cron.job WHERE jobname='+q(spec.pause)+';',
 ' PERFORM cron.alter_job(v_id,active=>false);'
 ]:[]),
 " IF EXISTS(SELECT 1 FROM cron.job WHERE active) THEN RAISE EXCEPTION 'OA5 active cron job'; END IF;",
 'END $oa5_guard$;',
 ].join('\n')+'\n';
}
export function renderReviewedSchedulerFile(spec,bytes){
 if(!SPECS.includes(spec)||!Buffer.isBuffer(bytes)||blobHash(bytes)!==spec.blob)
  throw Error('Unreviewed scheduler file bytes');
 const sql=bytes.toString('utf8');
 const pre=guard(spec,false),post=guard(spec,true);
 if(spec.explicit){
  const begin=/^begin;[ \t]*\r?$/gmi,commit=/^commit;[ \t]*\r?$/gmi;
  const begins=[...sql.matchAll(begin)],commits=[...sql.matchAll(commit)];
  if(begins.length!==1||commits.length!==1||!/^commit;\s*$/i.test(sql.slice(commits[0].index)))
   throw Error('Unexpected reviewed transaction boundaries');
  const offset=begins[0].index+begins[0][0].length;
  return sql.slice(0,offset)+'\n'+pre+sql.slice(offset,commits[0].index)+post+sql.slice(commits[0].index);
 }
 return 'BEGIN;\n'+pre+sql+'\n'+post+'COMMIT;\n';
}
export function reviewWrappers(dir){
 const review=reviewSchedulerSources(dir);
 const actual=review.review_candidates.filter(x=>x.cron_reference||x.network_reference).map(x=>x.file).sort();
 if(JSON.stringify(actual)!==JSON.stringify(SPECS.map(x=>x.file).sort()))throw Error('Scheduler census drift');
 return SPECS.map(spec=>{
  const bytes=readFileSync(join(dir,spec.file)),sql=renderReviewedSchedulerFile(spec,bytes);
  return {file:spec.file,original_git_blob:spec.blob,wrapper_sha256:createHash('sha256').update(sql).digest('hex'),
   explicit_original_transaction:spec.explicit,paused_job:spec.pause};
 });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3)throw Error('Expected canonical directory');
  console.log(JSON.stringify({wrappers:reviewWrappers(process.argv[2]),executed:false,hosted_reconstruction_authorized:false},null,2));
 }catch{console.error('BLOCKED: reviewed scheduler wrapper contract mismatch');process.exitCode=1;}
}
