import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, unlinkSync, symlinkSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkTestArchive, FILES, TEST_REF } from './oa5-test-backup-manifest.mjs';

function fixture(fn) {
  const dir=mkdtempSync(join(tmpdir(),'sellertray-qa-archive-'));
  const m={schema_version:1,project_ref:TEST_REF,backup_completed_utc:'2026-11-04T18:00:00Z',
    files:{},restore_target:'local_disposable',restore_verified:true,
    restore_completed_utc:'2026-11-04T19:00:00Z',secrets_committed_to_git:false,
    restore_counts:{auth_users:5,businesses:3,branches:3,commercial_orders:5,
      agreement_packages:5,order_form_confirmations:5,migration_rows:52}};
  for(const name of FILES) {
    const bytes=Buffer.from('-- synthetic SQL; no real records\nselect 1;\n');
    writeFileSync(join(dir,name),bytes);
    m.files[name]={sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
  }
  const save=()=>writeFileSync(join(dir,'archive-evidence.json'),JSON.stringify(m));
  save();
  try {fn({dir,m,save});}finally{rmSync(dir,{recursive:true,force:true});}
}
test('synthetic manifest and five file hashes match offline',()=>fixture(({dir})=>{
  assert.equal(checkTestArchive(dir).ok,true);
}));
test('reject Production-backed manifest',()=>fixture(({dir,m,save})=>{
  m.project_ref='eujxswjspolugrzlsjnn';save();
  assert.equal(checkTestArchive(dir).ok,false);
}));
test('reject tampering',()=>fixture(({dir})=>{
  writeFileSync(join(dir,'data.sql'),'changed');
  assert.equal(checkTestArchive(dir).ok,false);
}));
test('reject symlinked SQL file',()=>fixture(({dir})=>{
  unlinkSync(join(dir,'roles.sql'));symlinkSync(join(dir,'data.sql'),join(dir,'roles.sql'));
  assert.equal(checkTestArchive(dir).ok,false);
}));
test('missing real restore proof stays blocked',()=>fixture(({dir,m,save})=>{
  m.restore_verified=false;save();
  assert.equal(checkTestArchive(dir).ok,false);
}));
test('reject a forged/mismatched agreement package count',()=>fixture(({dir,m,save})=>{
  m.restore_counts.agreement_packages=0;save();
  assert.equal(checkTestArchive(dir).ok,false);
}));
test('reject extra declared archive content',()=>fixture(({dir,m,save})=>{
  m.files['secrets.txt']={sha256:'a'.repeat(64),bytes:5};save();
  assert.equal(checkTestArchive(dir).ok,false);
}));
