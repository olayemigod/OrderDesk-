import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {SPECS,renderReviewedSchedulerFile,reviewWrappers} from './oa5-method-b-scheduler-wrapper.mjs';

const dir=new URL('../../supabase/migrations/',import.meta.url).pathname;
test('exact four canonical files render with guards before original commit',()=>{
 assert.equal(reviewWrappers(dir).length,4);
 for(const spec of SPECS){
  const bytes=readFileSync(join(dir,spec.file));
  const sql=renderReviewedSchedulerFile(spec,bytes);
  const original=bytes.toString('utf8');
  assert.equal((sql.match(/^begin;[ \t]*\r?$/gmi)||[]).length,1,spec.file);
  assert.equal((sql.match(/^commit;[ \t]*\r?$/gmi)||[]).length,1,spec.file);
  assert.equal((sql.match(/^DO \$oa5_guard\$$/gm)||[]).length,2);
  assert.equal((sql.match(/^END \$oa5_guard\$;$/gm)||[]).length,2);
  const restored=sql.replace(/DO \$oa5_guard\$\n[\s\S]*?END \$oa5_guard\$;\n/g,'');
  if(spec.explicit) assert.equal(restored,original);
  else assert.equal(restored.slice('BEGIN;\n'.length,-'\nCOMMIT;\n'.length),original);
  assert.ok(sql.lastIndexOf('PERFORM cron.alter_job(v_id,active=>false);')<sql.toLowerCase().lastIndexOf('commit;'));
  assert.ok(sql.indexOf('OA5 active cron job')<sql.indexOf('OA5 lifecycle job drift')||spec.pause!=='sellertray-lifecycle-notifications');
  assert.throws(()=>renderReviewedSchedulerFile(spec,Buffer.concat([bytes,Buffer.from('\n-- changed')])),/Unreviewed/);
 }
});
test('unknown specs and missing corpus fail closed',()=>{
 assert.throws(()=>renderReviewedSchedulerFile({},Buffer.from('select 1;')),/Unreviewed/);
 assert.throws(()=>reviewWrappers('/nonexistent/oa5-migrations'),/Canonical corpus/);
});
