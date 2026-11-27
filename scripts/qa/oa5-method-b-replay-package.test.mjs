import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {planReplay,prepareReplay,ledgerCheckSql} from './oa5-method-b-replay-package.mjs';
const dir=fileURLToPath(new URL('../../supabase/migrations/',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
test('exact ordered prefixes cover all 461 migrations once',()=>{
 const plan=planReplay(dir);
 assert.equal(plan.hosted_reconstruction_authorized,false);
 assert.equal(plan.executed,false);
 assert.deepEqual(plan.batches.map(b=>b.end),[37,38,84,85,86,87,373,374,461]);
 assert.deepEqual(plan.batches.filter(b=>b.mode==='guarded').map(b=>b.end),[38,85,87,374]);
 assert.equal(plan.batches.reduce((n,b)=>n+b.end-b.before,0),461);
 for(const b of plan.batches)assert.equal(b.expected_rows.length,b.end);
});
test('offline materialization has only original prefixes and separately guarded files',()=>{
 const root=mkdtempSync(join(tmpdir(),'oa5-replay-test-'));
 const out=join(root,'candidate');
 try{
  const result=prepareReplay(dir,out);
  assert.equal(result.hosted_reconstruction_authorized,false);
  const manifest=JSON.parse(readFileSync(join(out,'manifest.json')));
  for(const b of manifest.batches){
   const base=join(out,String(b.step).padStart(2,'0')+'-'+b.mode);
   const mig=join(base,'supabase','migrations');
   const files=readdirSync(mig).sort();
   assert.equal(files.length,b.end);
   for(const f of files)assert.equal(sha(readFileSync(join(mig,f))),sha(readFileSync(join(dir,f))));
   assert.deepEqual(readdirSync(join(base,'supabase')).sort(),['config.toml','migrations']);
   assert.equal(existsSync(join(base,'guarded.sql')),b.mode==='guarded');
   if(b.mode==='guarded')assert.equal(sha(readFileSync(join(base,'guarded.sql'))),b.wrapper_sha256);
   assert.equal(readFileSync(join(base,'ledger-before.sql'),'utf8'),ledgerCheckSql(b.expected_rows.slice(0,b.before)));
   assert.equal(readFileSync(join(base,'ledger-after.sql'),'utf8'),ledgerCheckSql(b.expected_rows));
  }
  assert.throws(()=>prepareReplay(dir,out));
  assert.throws(()=>prepareReplay(dir,fileURLToPath(new URL('../../oa5-forbidden-output',import.meta.url))),/outside repository/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('empty prefix and exact ledger set comparison fail closed on incomplete rows',()=>{
 const sql=ledgerCheckSql([]);
 assert.match(sql,/WHERE false/);
 assert.match(sql,/count\(\*\) FROM actual\)=0/);
 assert.match(sql,/statements IS NULL/);
 assert.equal((sql.match(/EXCEPT/g)||[]).length,2);
 assert.throws(()=>planReplay('/nonexistent/oa5-source'));
});
