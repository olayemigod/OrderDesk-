#!/usr/bin/env node
// Test-only candidate runner. No retirement/reset, no automatic resume, no provider changes.
// Do not execute until separate explicit hosted approval and successful retirement.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,realpathSync,openSync,closeSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareReplay,planReplay} from './oa5-method-b-replay-package.mjs';
import {EXPECTED_JOBS} from './oa5-test-cron-maintenance-gate.mjs';

export const TEST_REF='iukgsukdoowvnhlfmpml';
export const TEST_URL='postgresql://postgres@db.'+TEST_REF+'.supabase.co:5432/postgres?sslmode=verify-full&connect_timeout=10';
const sha=b=>createHash('sha256').update(b).digest('hex');
const q=s=>"'"+s.replaceAll("'","''")+"'";
export function assertTarget(url){
 if(url!==TEST_URL)throw Error('Only exact direct TLS-verified Test endpoint accepted');
}
export function quietSql(prefix){
 const lifecycle=prefix>=374;
 const expected=EXPECTED_JOBS.map(j=>'('+j.jobid+'::bigint,'+q(j.jobname)+','+q(j.schedule)+','+q(j.command_sha256)+')').join(',');
 return [
 "DO $oa5$ DECLARE n bigint; BEGIN",
 " IF current_user<>'postgres' OR current_database()<>'postgres' OR (SELECT count(*) FROM auth.users)<>5 OR (SELECT count(*) FROM auth.sessions)<>7",
 " OR NOT EXISTS(SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)",
 " OR (SELECT count(*) FROM cron.job)<>"+(lifecycle?5:4),
 " OR EXISTS(SELECT 1 FROM cron.job WHERE active)",
 " OR EXISTS(SELECT 1 FROM cron.job_run_details WHERE end_time IS NULL)",
 " OR EXISTS(SELECT 1 FROM net.http_request_queue)",
 " OR EXISTS(SELECT 1 FROM vault.secrets)",
 " OR EXISTS(SELECT 1 FROM (VALUES "+expected+") AS e(id,name,schedule,digest) WHERE NOT EXISTS(SELECT 1 FROM cron.job j WHERE j.jobid=e.id AND j.jobname=e.name AND j.schedule=e.schedule AND j.username='postgres' AND encode(sha256(convert_to(j.command,'UTF8')),'hex')=e.digest))",
 ...(lifecycle?[" OR NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='sellertray-lifecycle-notifications' AND username='postgres' AND schedule='17 * * * *' AND encode(sha256(convert_to(command,'UTF8')),'hex')="+q(sha('select public.materialize_sellertray_lifecycle_notifications();'))+")"]:[]),
 " THEN RAISE EXCEPTION 'Test maintenance baseline mismatch'; END IF;",
 " IF to_regclass('public.tenants') IS NOT NULL THEN EXECUTE 'SELECT count(*) FROM public.tenants' INTO n; IF n<>0 THEN RAISE EXCEPTION 'Merchant data present'; END IF; END IF;",
 " IF to_regclass('sellertray_private.runtime_config') IS NOT NULL THEN EXECUTE 'SELECT count(*) FROM sellertray_private.runtime_config' INTO n; IF n<>0 THEN RAISE EXCEPTION 'Worker config present'; END IF; END IF;",
 "END $oa5$;"
 ].join('\n');
}
export function batchActions(batch){
 if(batch.mode==='native')return [{kind:'native-up',args:['migration','up','--db-url',TEST_URL]}];
 if(batch.mode!=='guarded'||batch.end!==batch.before+1||!/^\d{14}_/.test(batch.file))throw Error('Invalid guarded batch');
 return [{kind:'guarded-sql'},{kind:'quiet-after-sql-before-record'},{kind:'record-executed-version',args:['migration','repair',batch.file.slice(0,14),'--status','applied','--db-url',TEST_URL]}];
}
function main(){
 if(process.argv.length!==6||process.argv[2]!=='--execute-approved-test-replay'||process.argv[5]!==TEST_REF)throw Error('No explicit Test execution invocation');
 if(process.env.SELLERTRAY_TEST_REPLAY_APPROVAL!=='APPROVED_TEST_ONLY_AFTER_RETIREMENT')throw Error('No explicit operator authorization');
 const source=realpathSync(process.argv[3]),out=resolve(process.argv[4]);
 // Avoid inherited connection overrides, linked refs, project env, credential arguments.
 // Dedicated operator shell; password provided privately in PGPASSWORD, never printed.
 const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C',LC_ALL:'C',PGPASSWORD:process.env.PGPASSWORD,PGSSLROOTCERT:process.env.PGSSLROOTCERT,PGCONNECT_TIMEOUT:'10'};
 if(!env.PGPASSWORD||!env.PGSSLROOTCERT)throw Error('Private Test password and trusted CA required');
 assertTarget(TEST_URL);
 const cli=spawnSync('supabase',['--version'],{env,encoding:'utf8',stdio:['ignore','pipe','ignore']});
 if(cli.status!==0||cli.stdout.trim()!=='3.4.0')throw Error('Install exact reviewed CLI 3.4.0');
 const plan=planReplay(source);
 // Fresh package only; an existing directory blocks rerun after partial failure.
 prepareReplay(source,out);
 const logs=join(out,'private-logs');mkdirSync(logs,{mode:0o700});
 let step='preflight';
 function run(bin,args,cwd,input,logname){
  const fd=openSync(join(logs,logname),'wx',0o600);
  try{
   const r=spawnSync(bin,args,{cwd,env,input,encoding:'utf8',stdio:[input===undefined?'inherit':'pipe','pipe',fd],maxBuffer:32*1024*1024});
   writeFileSync(join(logs,logname+'.stdout'),r.stdout||'',{mode:0o600,flag:'wx'});
   if(r.status!==0||r.error||r.signal)throw Error('Command failed or uncertain');
   return (r.stdout||'').trim();
  }finally{closeSync(fd);}
 }
 const db=(sql,base,label)=>run('psql',['-X','-w','-qAt','-v','ON_ERROR_STOP=1',TEST_URL],base,sql,label);
 const ledger=(base,file,label)=>{
  if(db(readFileSync(join(base,file),'utf8'),base,label)!=='t')throw Error('Exact ledger prefix mismatch');
 };
 try{
  for(const batch of plan.batches){
   step=String(batch.step).padStart(2,'0')+'-'+batch.mode;
   const base=join(out,step);
   ledger(base,'ledger-before.sql',step+'-ledger-before');
   db(quietSql(batch.before),base,step+'-quiet-before');
   for(const action of batchActions(batch)){
    if(action.kind==='guarded-sql'){
     const bytes=readFileSync(join(base,'guarded.sql'));
     if(sha(bytes)!==batch.wrapper_sha256)throw Error('Guarded SQL fingerprint drift');
     db(bytes.toString('utf8'),base,step+'-guarded');
    }else if(action.kind==='quiet-after-sql-before-record'){
     db(quietSql(batch.end),base,step+'-quiet-before-record');
     ledger(base,'ledger-before.sql',step+'-ledger-before-record');
    }else run('supabase',action.args,base,undefined,step+'-'+action.kind);
   }
   ledger(base,'ledger-after.sql',step+'-ledger-after');
   db(quietSql(batch.end),base,step+'-quiet-after');
   console.log('Verified exact prefix '+batch.end+'/461');
  }
 }catch{throw Error('Stopped at '+step+'; private logs retained. No automatic retry or history repair.');}
 console.log('CANONICAL_PREFIX_REPLAY=PASS; statement-array parity, hosted Auth/API and business acceptance remain required.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{main()}catch(e){console.error('BLOCKED: '+e.message);process.exitCode=1;}
}
