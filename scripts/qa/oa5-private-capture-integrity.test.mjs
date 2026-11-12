import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {EXPECTED,TEST_REF} from './oa5-historical-preview-bundle-inspection.mjs';
import {checkPrivateCaptureIntegrity} from './oa5-private-capture-integrity.mjs';

function fixture(run){
 const root=mkdtempSync(join(tmpdir(),'sellertray-oa5-private-'));
 try{
  const manifest={
   schema_version:1,scope:'historical-preview-bundle-content-only',
   captured_at_utc:'2026-11-09T23:50:00Z',deployments:[]
  }, hashes={
   schema_version:1,purpose:'historical-preview-private-sha256-inventory',captures:[]
  };
  const sign=x=>createHash('sha256').update(x).digest('hex');
  for(let i=0;i<5;i++){
   const d=EXPECTED[i],directory='capture_'+i;
   const dir=join(root,directory);
   mkdirSync(join(dir,'assets'),{recursive:true});
   const html='<!doctype html><html><script type="module" src="/assets/app.js"></script>'+
    (i>1?'<script async src="https://vercel.live/_next-live/feedback/feedback.js"></script>':'')+
    '</html>';
   const js='export const configured="https://'+TEST_REF+'.supabase.co";';
   const files=[['index.html',html],['assets/app.js',js]];
   for(const [name,body] of files)
    writeFileSync(join(dir,...name.split('/')),body);
   manifest.deployments.push({
    id:d.id,sha:d.sha,surface:d.surface,directory,
    capture_evidence_ref:'oa5_private_fixture_'+i
   });
   hashes.captures.push({
    deployment_id:d.id,surface:d.surface,
    unverified_external_vercel_toolbar_ref_count:i>1?1:0,
    files:files.map(([file,body])=>({
     file,sha256:sign(body),bytes:Buffer.byteLength(body)
    }))
   });
  }
  writeFileSync(join(root,'private-capture-manifest.json'),JSON.stringify(manifest));
  writeFileSync(join(root,'private-capture-hashes.json'),JSON.stringify(hashes));
  return run({root,manifest,hashes});
 }finally{rmSync(root,{recursive:true,force:true});}
}
test('synthetic five-deployment integrity replays SHA-256 and TEST-only compiled content without network',()=>fixture(({root})=>{
 const result=checkPrivateCaptureIntegrity(root);
 assert.equal(result.local_sha256_inventory_verified,true);
 assert.equal(result.offline_compiled_test_backend_verified,true);
 assert.equal(result.file_count,10);
 assert.deepEqual(result.per_capture_file_counts,[2,2,2,2,2]);
 assert.equal(result.unverified_external_toolbar_reference_count,3);
 assert.equal(result.historical_origin_verified,false);
 assert.equal(result.authorized_reviewer_verified,false);
 assert.equal(result.hosted_compiled_bundle_accepted,false);
 assert.equal(result.destructive_execution_authorized,false);
 assert.deepEqual(result.failure_codes,[]);
}));
test('after capture a one-byte change fails SHA-256 without printing code',()=>fixture(({root})=>{
 const target=join(root,'capture_3','assets','app.js');
 writeFileSync(target,readFileSync(target,'utf8').replace(TEST_REF,'xxxxxxxxxxxxxxxxxxxx'));
 const result=checkPrivateCaptureIntegrity(root);
 assert.equal(result.local_sha256_inventory_verified,false);
 assert.ok(result.failure_codes.includes('SHA256_CONTENT_MISMATCH'));
 assert.equal(JSON.stringify(result).includes('xxxxxxxx'),false);
}));
test('orphan or unexpected private file refuses integrity acceptance',()=>fixture(({root})=>{
 writeFileSync(join(root,'capture_0','assets','stray.js'),'secret');
 const result=checkPrivateCaptureIntegrity(root);
 assert.equal(result.local_sha256_inventory_verified,false);
 assert.ok(result.failure_codes.includes('UNINVENTORIED_OR_UNSAFE_PRIVATE_FILE'));
}));
test('missing saved bundle file refuses integrity acceptance',()=>fixture(({root})=>{
 renameSync(join(root,'capture_2','index.html'),join(root,'capture_2','renamed.html'));
 const result=checkPrivateCaptureIntegrity(root);
 assert.equal(result.local_sha256_inventory_verified,false);
 assert.ok(result.failure_codes.includes('INVENTORIED_FILE_MISSING'));
}));
test('manifest and SHA entries must match frozen IDs and original commit hashes',()=>fixture(({root,manifest})=>{
 manifest.deployments[2].sha='a'.repeat(40);
 writeFileSync(join(root,'private-capture-manifest.json'),JSON.stringify(manifest));
 const result=checkPrivateCaptureIntegrity(root);
 assert.equal(result.local_sha256_inventory_verified,false);
 assert.ok(result.failure_codes.includes('FROZEN_DEPLOYMENT_METADATA_MISMATCH'));
}));
test('path traversal from tampered private SHA inventory is never followed',()=>fixture(({root,hashes})=>{
 hashes.captures[0].files[0].file='../secrets.js';
 writeFileSync(join(root,'private-capture-hashes.json'),JSON.stringify(hashes));
 const result=checkPrivateCaptureIntegrity(root);
 assert.equal(result.local_sha256_inventory_verified,false);
 assert.ok(result.failure_codes.includes('INVALID_HASH_INVENTORY_RECORD'));
}));
test('strict offline script graph refuses unknown third-party script even with matching SHA records',()=>fixture(({root,hashes})=>{
 const file=join(root,'capture_2','index.html');
 const html=readFileSync(file,'utf8').replace(
  'https://vercel.live/_next-live/feedback/feedback.js',
  'https://other.invalid/assets/private.js'
 );
 writeFileSync(file,html);
 hashes.captures[2].files[0].bytes=Buffer.byteLength(html);
 hashes.captures[2].files[0].sha256=createHash('sha256').update(html).digest('hex');
 writeFileSync(join(root,'private-capture-hashes.json'),JSON.stringify(hashes));
 const result=checkPrivateCaptureIntegrity(root);
 assert.equal(result.local_sha256_inventory_verified,false);
 assert.ok(result.failure_codes.includes('COMPILED_TEST_CONTENT_REPLAY_FAILED'));
}));
test('offline CLI with SourceTextModule never prints private path, JS, HTML, SHA or script reference',()=>fixture(({root})=>{
 const file=new URL('./oa5-private-capture-integrity.mjs',import.meta.url).pathname;
 const r=spawnSync(process.execPath,['--experimental-vm-modules',file,'--check',root],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,/PASS: all 5 frozen deployment records, 10 private original file SHA-256 hashes/);
 assert.match(r.stdout,/NOT VERIFIED: 3 external Vercel Toolbar scripts/);
 for(const secret of [root,TEST_REF,'https://vercel.live', 'assets/app.js',EXPECTED[0].sha])
  assert.equal(r.stdout.includes(secret),false);
}));
