import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync,mkdirSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EXPECTED,TEST_REF,PROD_REF} from './oa5-historical-preview-bundle-inspection.mjs';
import {validatePrivateCapturePlan,captureOriginalPreviewPlan,planVercelReadOnlyCommand} from './oa5-protected-preview-capture.mjs';

const at=new Date('2026-11-09T23:50:00Z');
const plan=()=>({
 schema_version:1,purpose:'read-only-original-preview-capture',
 deployments:EXPECTED.map((d,i)=>({...d,
  origin:'https://sellertray-'+d.surface+'-git-oa5-evidence-'+i+'.vercel.app',
  capture_evidence_ref:'private-original-review-'+i}))
});
const syntheticAliasDigests=Object.fromEntries(plan().deployments.map(x=>[
 x.id,createHash('sha256').update(x.id+'\n'+new URL(x.origin).hostname).digest('hex')
]));
const checkSynthetic=x=>validatePrivateCapturePlan(x,syntheticAliasDigests);
const makeWorkspace=()=>{
 const parent=mkdtempSync(join(tmpdir(),'oa5-original-preview-'));
 return {parent,root:join(parent,'protected-capture'),
  cleanup:()=>rmSync(parent,{recursive:true,force:true})};
};
function mockedRequest(url){
 const parsed=new URL(url);
 if(parsed.pathname==='/')return Buffer.from(
  '<!doctype html><html><script type="module" src="/assets/site.js"></script></html>');
 if(parsed.pathname==='/assets/site.js')return Buffer.from(
  'import "./sub.js";console.log("original");');
 if(parsed.pathname==='/assets/sub.js')return Buffer.from(
  'export const configured="https://'+TEST_REF+'.supabase.co";');
 throw Error('Unexpected network path in synthetic test: '+parsed.pathname);
}
test('private five-deployment plan accepts exact IDs and restricted Vercel hostnames but never claims historical origin',()=>{
 const r=checkSynthetic(plan());
 assert.equal(r.valid,true,r.reasons.join('\n'));
 assert.equal(r.deployments.length,5);
 assert.equal(r.original_vercel_origin_attested,false);
 assert.equal(r.authorized_reviewer_verified,false);
 assert.equal(r.capture_authorized_by_tool,false);
});
test('original ID, SHA, surface, evidence and duplicate aliases are fail-closed',()=>{
 for(const mutate of [
  x=>x.deployments[0].id='dpl_wrong',
  x=>x.deployments[0].sha='a'.repeat(40),
  x=>x.deployments[0].surface='admin',
  x=>x.deployments[0].origin=x.deployments[1].origin,
  x=>x.deployments[1].capture_evidence_ref=x.deployments[0].capture_evidence_ref,
  x=>x.deployments.pop(),
  x=>x.deployments.push({...x.deployments[0],origin:'https://other.vercel.app'}),
  x=>x.deployments[0].token='private',
  x=>x.api_key='private',
  x=>x.purpose='write-production',
  x=>x.schema_version=2
 ]){
  const x=plan();mutate(x);
  assert.equal(checkSynthetic(x).valid,false);
 }
});
test('only original project-specific Preview URLs; no Production, custom, arbitrary, tokenized or unsafe origins',()=>{
 for(const origin of [
  'https://app.sellertray.com','https://admin.sellertray.com',
  'https://test.sellertray.com','https://sellertray-merchant.vercel.app',
  'https://sellertray-admin-git-example.vercel.app',
  'http://sellertray-merchant-git-safe.vercel.app',
  'https://evil.example.invalid',
  'https://user:password@sellertray-merchant-git-safe.vercel.app',
  'https://sellertray-merchant-git-safe.vercel.app:8443',
  'https://sellertray-merchant-git-safe.vercel.app/api',
  'https://sellertray-merchant-git-safe.vercel.app/?token=a',
  'https://sellertray-merchant-git-safe.vercel.app/#fragment',
  'https://sellertray-merchant-git-safe.vercel.app.evil.invalid',
 ]){
  const x=plan();x.deployments[0].origin=origin;
  assert.equal(checkSynthetic(x).valid,false,origin);
 }
});
test('synthetic original HTML plus reachable JS is privately captured and SHA-hashed without accepting hosted provenance',()=>{
 const w=makeWorkspace();
 try{
  const requests=[];
  const r=captureOriginalPreviewPlan(plan(),w.root,(url,max)=>{
   requests.push(new URL(url).pathname);
   return mockedRequest(url);
  },at,syntheticAliasDigests);
  assert.equal(r.content_consistent_with_test,true);
  assert.equal(r.capture_count,5);
  assert.equal(r.total_file_count,15);
  assert.equal(r.original_vercel_origin_attested,false);
  assert.equal(r.authorized_reviewer_verified,false);
  assert.equal(r.hosted_compiled_bundle_accepted,false);
  assert.equal(r.destructive_execution_authorized,false);
  assert.equal(requests.length,15);
  const privateManifest=JSON.parse(readFileSync(r.manifest_path,'utf8'));
  const privateHashes=JSON.parse(readFileSync(r.hash_inventory_path,'utf8'));
  assert.equal(privateManifest.deployments.length,5);
  assert.equal(privateHashes.captures.length,5);
  assert.equal(privateHashes.captures[0].files.length,3);
  assert.match(privateHashes.captures[0].files[0].sha256,/^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(privateManifest).includes('vercel.app'),false);
  assert.equal(JSON.stringify(privateHashes).includes('vercel.app'),false);
  assert.equal(existsSync(join(w.root,'capture_4','assets','sub.js')),true);
 }finally{w.cleanup();}
});
test('outside-domain script src blocked without fetching untrusted remote host',()=>{
 const w=makeWorkspace();
 try{
  const calls=[];
  assert.throws(()=>captureOriginalPreviewPlan(plan(),w.root,(url)=>{
   calls.push(url);
   if(url.endsWith('/'))return Buffer.from(
    '<html><script src="https://untrusted.invalid/external.js"></script></html>');
   return mockedRequest(url);
  },at,syntheticAliasDigests),/BLOCKED/);
  assert.equal(calls.length,1);
  assert.equal(calls.every(x=>x.endsWith('.vercel.app/')),true);
  assert.equal(existsSync(join(w.root,'private-capture-manifest.json')),false);
 }finally{w.cleanup();}
});
test('missing imported compiled chunk fails closed and never produces accepted manifest',()=>{
 const w=makeWorkspace();
 try{
  assert.throws(()=>captureOriginalPreviewPlan(plan(),w.root,(url)=>{
   if(url.endsWith('/assets/sub.js'))throw Error('private 404 URL should not leak');
   return mockedRequest(url);
  },at,syntheticAliasDigests),/BLOCKED/);
  assert.equal(existsSync(join(w.root,'private-capture-manifest.json')),false);
 }finally{w.cleanup();}
});
test('SSO HTML challenge at root fails without trusting a successful HTTP response',()=>{
 const w=makeWorkspace();
 try{
  assert.throws(()=>captureOriginalPreviewPlan(plan(),w.root,()=>Buffer.from(
   '<html><body>Sign in to Vercel</body></html>'),at,syntheticAliasDigests),/BLOCKED/);
 }finally{w.cleanup();}
});
test('unexpected Production backend in captured JavaScript fails whole five-deployment content check',()=>{
 const w=makeWorkspace();
 try{
  assert.throws(()=>captureOriginalPreviewPlan(plan(),w.root,url=>{
   if(url.endsWith('/assets/sub.js'))return Buffer.from(
    'export const prod="https://'+PROD_REF+'.supabase.co";'+
    'export const test="https://'+TEST_REF+'.supabase.co";');
   return mockedRequest(url);
  },at,syntheticAliasDigests),/BLOCKED/);
  assert.equal(existsSync(join(w.root,'private-capture-manifest.json')),false);
 }finally{w.cleanup();}
});
test('no overwritten historical capture; no download occurs if private output is occupied',()=>{
 const w=makeWorkspace();
 try{
  mkdirSync(w.root);
  writeFileSync(join(w.root,'do-not-overwrite.txt'),'original');
  let called=0;
  assert.throws(()=>captureOriginalPreviewPlan(plan(),w.root,()=>{
   called++;return Buffer.from('test');
  },at,syntheticAliasDigests),/BLOCKED/);
  assert.equal(called,0);
 }finally{w.cleanup();}
});
test('CLI checks private plan offline without vc CLI; malformed capture is rejected before authentication',()=>{
 const w=makeWorkspace();
 try{
  const good=join(w.parent,'private-plan.json');
  writeFileSync(good,JSON.stringify(plan()));
  const cli=new URL('./oa5-protected-preview-capture.mjs',import.meta.url).pathname;
  const check=spawnSync(process.execPath,[cli,'--check-plan',good],{encoding:'utf8'});
  assert.equal(check.status,1);
  assert.match(check.stderr,/BLOCKED/);
  const invalid=plan();invalid.deployments[0].origin='https://app.sellertray.com';
  const bad=join(w.parent,'invalid-plan.json');
  writeFileSync(bad,JSON.stringify(invalid));
  const capture=spawnSync(process.execPath,[cli,'--capture',bad,w.root],{encoding:'utf8'});
  assert.equal(capture.status,1);
  assert.match(capture.stderr,/BLOCKED/);
  assert.equal(existsSync(w.root),false);
 }finally{w.cleanup();}
});

test('never writes private Preview files inside Git and never reads an alias plan from tracked source',()=>{
 let called=0;
 const forbidden=join(process.cwd(),'oa5-no-private-capture-in-source');
 assert.throws(()=>captureOriginalPreviewPlan(plan(),forbidden,()=>{
  called++;return Buffer.from('unreachable');
 },at,syntheticAliasDigests),/BLOCKED/);
 assert.equal(called,0);
 assert.equal(existsSync(forbidden),false);
 const cli=new URL('./oa5-protected-preview-capture.mjs',import.meta.url).pathname;
 const inRepo=new URL('../../docs/qa/oa5-historical-vercel-preview-custody-2026-11-09.json',import.meta.url).pathname;
 const check=spawnSync(process.execPath,[cli,'--check-plan',inRepo],{encoding:'utf8'});
 assert.equal(check.status,1);
 assert.match(check.stderr,/BLOCKED/);
});

test('a plausible Vercel Preview alias never passes the actual provider-pinned fingerprint unless it belongs to the original deployment',()=>{
 const fake=plan();
 const result=validatePrivateCapturePlan(fake);
 assert.equal(result.valid,false);
 assert.match(result.reasons.join(' '),/original Vercel Preview origin/);
 assert.equal(result.original_vercel_origin_attested,false);
});
test('synthetic fingerprint override is forbidden with the real Vercel CLI transport',()=>{
 const w=makeWorkspace();
 try{
  assert.throws(()=>captureOriginalPreviewPlan(plan(),w.root,undefined,at,syntheticAliasDigests),/BLOCKED/);
  assert.equal(existsSync(w.root),false);
 }finally{w.cleanup();}
});

test('Windows Vercel npm .cmd shim uses cmd.exe only for constrained read-only GET and whoami',()=>{
 const url='https://sellertray-merchant-git-test-evidence.vercel.app/assets/index-AB_19.js';
 const win=planVercelReadOnlyCommand('curl',url,'win32');
 assert.deepEqual(win,{
  file:'cmd.exe',
  args:['/d','/s','/c','vercel.cmd curl '+url+' -- --fail --silent --show-error --max-time 30']
 });
 const who=planVercelReadOnlyCommand('whoami',null,'win32');
 assert.deepEqual(who,{file:'cmd.exe',args:['/d','/s','/c','vercel.cmd whoami']});
 assert.equal(win.args[3].includes('--protection-bypass'),false);
 assert.equal(win.args[3].includes('--token'),false);
});
test('Linux/WSL Vercel launcher avoids shell and never falls back to Production',()=>{
 const url='https://sellertray-admin-git-test-evidence.vercel.app/';
 assert.deepEqual(planVercelReadOnlyCommand('curl',url,'linux'),{
  file:'vercel',args:['curl',url,'--','--fail','--silent','--show-error','--max-time','30']
 });
 assert.deepEqual(planVercelReadOnlyCommand('whoami',null,'linux'),{
  file:'vercel',args:['whoami']
 });
});
test('Windows command planner rejects arbitrary commands and shell/URL injection before launching cmd',()=>{
 for(const [action,url] of [
  ['deploy',null],['env','ls'],['whoami','https://sellertray-admin-git-test.vercel.app/'],
  ['curl',null],['curl','https://app.sellertray.com/'],
  ['curl','https://test.sellertray.com/'],
  ['curl','http://sellertray-admin-git-test.vercel.app/'],
  ['curl','https://sellertray-admin-git-test.vercel.app/hello?token=x'],
  ['curl','https://sellertray-admin-git-test.vercel.app/one%20two.js'],
  ['curl','https://sellertray-admin-git-test.vercel.app/assets/../../other.js'],
  ['curl','https://sellertray-admin-git-test.vercel.app/assets/hello.js&&whoami'],
  ['curl','https://sellertray-admin-git-test.vercel.app/assets/hello.js|more'],
  ['curl','https://sellertray-admin-git-test.vercel.app/assets/hello.js>out'],
  ['curl','https://sellertray-admin-git-test.vercel.app/assets/hello.js" --token secret'],
  ['curl','https://sellertray-admin-git-test.vercel.app@evil.invalid/'],
  ['curl','https://sellertray-admin-git-test.vercel.app/asset.js#frag'],
  ['curl','https://sellertray-admin-git-test.vercel.app:8443/'],
  ['curl','https://sellertray-admin-git-test.vercel.app/assets/foo;bar.js']
 ]){
  assert.throws(()=>planVercelReadOnlyCommand(action,url,'win32'),/BLOCKED/,
   action+':'+String(url));
 }
});

test('symlinked outside path into SellerTray Git checkout cannot receive private Preview files',()=>{
 const w=makeWorkspace();
 try{
  const link=join(w.parent,'linked-checkout');
  symlinkSync(process.cwd(),link,'dir');
  let calls=0;
  assert.throws(()=>captureOriginalPreviewPlan(plan(),join(link,'secret-preview'),()=>{
   calls++;return Buffer.from('should-not-fetch');
  },at,syntheticAliasDigests),/BLOCKED/);
  assert.equal(calls,0);
  assert.equal(existsSync(join(process.cwd(),'secret-preview')),false);
 }finally{w.cleanup();}
});
test('symlinked plan outside checkout pointing into Git checkout is rejected by CLI',()=>{
 const w=makeWorkspace();
 try{
  const link=join(w.parent,'alias-plan-link.json');
  const repoSource=new URL('../../docs/qa/oa5-original-preview-alias-fingerprints-2026-11-09.json',import.meta.url).pathname;
  symlinkSync(repoSource,link,'file');
  const cli=new URL('./oa5-protected-preview-capture.mjs',import.meta.url).pathname;
  const result=spawnSync(process.execPath,[cli,'--check-plan',link],{encoding:'utf8'});
  assert.equal(result.status,1);
  assert.match(result.stderr,/BLOCKED/);
  assert.match(result.stderr,/inside Git/);
 }finally{w.cleanup();}
});

test('Vercel 65 forwards HTTP curl flags only after the separator and never changes request method',()=>{
 const url='https://sellertray-merchant-git-test-evidence.vercel.app/';
 for(const platform of ['win32','linux']){
  const req=planVercelReadOnlyCommand('curl',url,platform);
  const text=req.args.join(' ');
  assert.match(text,/curl https:\/\/sellertray-merchant-git-test-evidence[.]vercel[.]app\/ -- --fail --silent --show-error --max-time 30/);
  assert.doesNotMatch(text,/--request|--data|--header|--protection-bypass|deploy|env\s+add/);
 }
});
