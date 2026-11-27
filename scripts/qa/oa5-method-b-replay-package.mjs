#!/usr/bin/env node
// Offline staging only. Creates no connection, reads no credentials, executes no SQL.
// Generates original prefix workdirs and separate guarded SQL files; never changes source migrations.
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,mkdirSync,writeFileSync,realpathSync,lstatSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SPECS,reviewWrappers,renderReviewedSchedulerFile} from './oa5-method-b-scheduler-wrapper.mjs';

const TEST='iukgsukdoowvnhlfmpml';
const PINNED_ENDS=[37,38,84,85,86,87,373,374,461];
const sha=b=>createHash('sha256').update(b).digest('hex');
const q=s=>"'"+s.replaceAll("'","''")+"'";
export function planReplay(dir){
 const wrappers=reviewWrappers(dir);
 const files=readdirSync(dir).filter(f=>f.endsWith('.sql')).sort();
 const batches=[];
 let before=0;
 for(const end of PINNED_ENDS){
  const file=files[end-1],spec=SPECS.find(s=>s.file===file);
  const guarded=!!spec;
  if(guarded!==(batches.length%2===1)||(guarded&&end-before!==1))
   throw Error('Reviewed batch boundary drift');
  const rows=files.slice(0,end).map(f=>({version:f.slice(0,14),name:f.slice(15,-4)}));
  batches.push({step:batches.length+1,before,end,mode:guarded?'guarded':'native',file,
    expected_rows:rows,expected_prefix_sha256:sha(rows.map(r=>r.version+'\t'+r.name+'\n').join('')),
    ...(guarded?{wrapper_sha256:wrappers.find(w=>w.file===file).wrapper_sha256}:{}),
  });
  before=end;
 }
 return {project_ref:TEST,cli_version:'3.4.0',source_count:461,batches,executed:false,hosted_reconstruction_authorized:false};
}
// Compare all version/name pairs, nonnull statement arrays, and exact count.
// This check does not prove the statement array equals native parsed source.
export function ledgerCheckSql(rows){
 const values=rows.map(r=>'('+q(r.version)+'::text,'+q(r.name)+'::text)').join(',\n');
 const expected=rows.length?'VALUES '+values:"SELECT NULL::text,NULL::text WHERE false";
 return 'WITH expected(version,name) AS ('+expected+'), actual AS (SELECT version,name FROM supabase_migrations.schema_migrations), mismatch AS (SELECT * FROM expected EXCEPT SELECT * FROM actual), extra AS (SELECT * FROM actual EXCEPT SELECT * FROM expected)\n'+
 'SELECT ((SELECT count(*) FROM actual)='+rows.length+' AND NOT EXISTS(SELECT 1 FROM mismatch) AND NOT EXISTS(SELECT 1 FROM extra) AND NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE statements IS NULL)) AS exact_ledger_prefix;\n';
}
export function prepareReplay(dir,out){
 const src=realpathSync(dir),target=resolve(out);
 // Only a fresh directory outside the repository. Existing paths never overwritten.
 const repo=realpathSync(new URL('../../',import.meta.url));
 const parent=realpathSync(resolve(target,'..')),destination=join(parent,target.split('/').at(-1));
 const rel=relative(repo,destination);
 if(!rel||(!rel.startsWith('..')&&!isAbsolute(rel))||destination===src)
  throw Error('Output must be outside repository');
 const plan=planReplay(src);
 mkdirSync(destination,{mode:0o700});
 const files=readdirSync(src).filter(f=>f.endsWith('.sql')).sort();
 const put=(p,v)=>writeFileSync(p,v,{mode:0o600,flag:'wx'});
 for(const batch of plan.batches){
  const base=join(destination,String(batch.step).padStart(2,'0')+'-'+batch.mode);
  mkdirSync(base,{mode:0o700});
  const supa=join(base,'supabase'),migrations=join(supa,'migrations');
  mkdirSync(supa,{mode:0o700});mkdirSync(migrations,{mode:0o700});
  // No linked cache, seed, .env, external Vault settings or credentials copied.
  put(join(supa,'config.toml'),'project_id = "sellertray-method-b-candidate"\n[db.seed]\nenabled = false\n');
  for(const file of files.slice(0,batch.end))put(join(migrations,file),readFileSync(join(src,file)));
  put(join(base,'ledger-before.sql'),ledgerCheckSql(batch.expected_rows.slice(0,batch.before)));
  put(join(base,'ledger-after.sql'),ledgerCheckSql(batch.expected_rows));
  if(batch.mode==='guarded'){
   const spec=SPECS.find(s=>s.file===batch.file);
   const sql=renderReviewedSchedulerFile(spec,readFileSync(join(src,batch.file)));
   if(sha(sql)!==batch.wrapper_sha256)throw Error('Wrapper hash drift');
   put(join(base,'guarded.sql'),sql);
  }
 }
 put(join(destination,'manifest.json'),JSON.stringify(plan,null,2)+'\n');
 return {batches:plan.batches.map(({step,before,end,mode,file})=>({step,before,end,mode,file})),source_count:461,prepared_only:true,hosted_reconstruction_authorized:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==5||process.argv[2]!=='--prepare-offline')throw Error('Usage');
  console.log(JSON.stringify(prepareReplay(process.argv[3],process.argv[4]),null,2));
 }catch{console.error('BLOCKED: offline package preparation failed; no hosted execution');process.exitCode=1;}
}
