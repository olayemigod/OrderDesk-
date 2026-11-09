import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
 attestationIsValid,verifyFrontendBuildEnvironment,loadStagingAttestation
} from './vercel-frontend-environment.mjs';

const prodUrl='https://eujxswjspolugrzlsjnn.supabase.co';
const oldTestUrl='https://iukgsukdoowvnhlfmpml.supabase.co';
const futureTestUrl='https://'+'q'.repeat(20)+'.supabase.co';
const publishable='sb_publishable_'+'x'.repeat(25);
const env=(kind,scope)=>({
 VERCEL:'1',VERCEL_ENV:kind,
 VERCEL_GIT_COMMIT_REF:'qa-preview/'+scope+'-oa5-acceptance',
 VITE_SUPABASE_URL:kind==='production'?prodUrl:futureTestUrl,
 VITE_SUPABASE_PUBLISHABLE_KEY:publishable,
});
const blocked=loadStagingAttestation();
const good=()=>({
 schema_version:1,state:'verified',
 approved_staging_project_ref:'q'.repeat(20),
 reviewed_source_sha:'a'.repeat(40),
 clean_migration_replay_verified:true,
 historical_agreement_evidence_archived:true,
 restore_path_verified:true,
 vercel_preview_dependencies_reconciled:true,
 qa_preview_access_protection_preflight_verified:true,
 test_only_auth_and_provider_config_verified:true,
 qa_edge_functions_deployed_and_verified:true,
 approved_at:'04/11/2026',
});
const check=(surface,value,attestation=blocked)=>
 verifyFrontendBuildEnvironment({surface,env:value,attestation});

test('checked-in staging attestation is blocked until a real archive and rebuild',()=>{
 assert.equal(blocked.state,'blocked');
 assert.equal(attestationIsValid(blocked),false);
});

test('local CI builds do not require Vercel or Supabase credentials',()=>{
 for(const surface of ['merchant','admin']){
  assert.equal(check(surface,{}).ok,true);
  assert.equal(check(surface,{}).mode,'local');
 }
});

test('both production web builds allow only production backend',()=>{
 for(const surface of ['merchant','admin']){
  assert.equal(check(surface,env('production',surface)).ok,true);
  const wrong=check(surface,{...env('production',surface),VITE_SUPABASE_URL:futureTestUrl});
  assert.equal(wrong.ok,false);
  assert.match(wrong.errors.join('\n'),/Production web build/);
 }
});

test('both preview web builds reject their existing default production backend',()=>{
 for(const surface of ['merchant','admin']){
  const x=check(surface,{...env('preview',surface),VITE_SUPABASE_URL:prodUrl});
  assert.equal(x.ok,false);
  assert.match(x.errors.join('\n'),/Preview must never use Production/);
 }
});

test('neither web surface can reuse the unrebuilt old agreement QA backend',()=>{
 for(const surface of ['merchant','admin']){
  const x=check(surface,{...env('preview',surface),VITE_SUPABASE_URL:oldTestUrl});
  assert.equal(x.ok,false);
  assert.match(x.errors.join('\n'),/Agreement Test project/);
 }
});

test('an attested Test preview still rejects the known Production publishable key',()=>{
 const eas=JSON.parse(readFileSync(fileURLToPath(new URL('../../apps/mobile/eas.json',import.meta.url)),'utf8'));
 const prodKey=eas.build.production.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 for(const surface of ['merchant','admin']){
  const r=check(surface,{...env('preview',surface),VITE_SUPABASE_PUBLISHABLE_KEY:prodKey},good());
  assert.equal(r.ok,false);
  assert.match(r.errors.join('\\n'),/separate non-production Supabase publishable key/);
  assert.doesNotMatch(r.errors.join('\\n'),/sb_publishable_/);
 }
});

test('new preview credentials cannot bypass unverified hosted staging',()=>{
 for(const surface of ['merchant','admin']){
  const x=check(surface,env('preview',surface));
  assert.equal(x.ok,false);
  assert.match(x.errors.join('\n'),/not fully verified/);
 }
});

test('source-attested isolated Test project can be used only by correct surface QA branch',()=>{
 for(const surface of ['merchant','admin']){
  const x=check(surface,env('preview',surface),good());
  assert.equal(x.ok,true);
  assert.equal(x.backendRef,'q'.repeat(20));
  const wrong=check(surface,{...env('preview',surface),
    VERCEL_GIT_COMMIT_REF:'qa-preview/'+(surface==='merchant'?'admin':'merchant')+'-oa5-acceptance'},good());
  assert.equal(wrong.ok,false);
 }
});

test('rejects previews when source attestation project does not match URL',()=>{
 const x=check('merchant',{...env('preview','merchant'),VITE_SUPABASE_URL:'https://'+'z'.repeat(20)+'.supabase.co'},good());
 assert.equal(x.ok,false);
 assert.match(x.errors.join('\n'),/does not match approved staging/);
});

test('rejects missing migration replay, archive or separate-provider proof',()=>{
 for(const prop of [
  'clean_migration_replay_verified','historical_agreement_evidence_archived',
  'restore_path_verified','vercel_preview_dependencies_reconciled',
  'qa_preview_access_protection_preflight_verified',
  'test_only_auth_and_provider_config_verified','qa_edge_functions_deployed_and_verified'
 ]){
  const a=good();a[prop]=false;
  assert.equal(attestationIsValid(a),false,prop);
  assert.equal(check('merchant',env('preview','merchant'),a).ok,false,prop);
 }
});

test('no unknown Vercel mode or Vercel missing build context can bypass checks',()=>{
 for(const value of [
  {VERCEL:'1'},
  {VERCEL:'1',VERCEL_ENV:'staging'},
  {...env('preview','merchant'),VERCEL_ENV:''},
 ]){
  assert.equal(check('merchant',value,good()).ok,false);
 }
});

test('rejects malformed URL, extra paths and missing publishable key without echoing it',()=>{
 for(const value of [
  {...env('preview','merchant'),VITE_SUPABASE_URL:'https://user:pw@'+'q'.repeat(20)+'.supabase.co'},
  {...env('preview','merchant'),VITE_SUPABASE_URL:futureTestUrl+'/auth/v1'},
  {...env('preview','merchant'),VITE_SUPABASE_PUBLISHABLE_KEY:''},
 ]){
  assert.equal(check('merchant',value,good()).ok,false);
 }
});

test('prebuild guards are actually hooked into Merchant and Admin npm build scripts',()=>{
 const root=new URL('../../',import.meta.url);
 for(const [surface,app] of [['merchant','merchant-web'],['admin','admin-web']]){
  const p=JSON.parse(readFileSync(fileURLToPath(new URL('apps/'+app+'/package.json',root)),'utf8'));
  assert.equal(p.scripts.prebuild,'node ../../scripts/qa/vercel-frontend-environment.mjs '+surface);
  assert.match(p.scripts.build,/vite build/);
 }
});

test('preview guard CLI denies real production fallback and never prints keys',()=>{
 const processEnv={...process.env,...env('preview','merchant'),VITE_SUPABASE_URL:prodUrl};
 const r=spawnSync(process.execPath,['scripts/qa/vercel-frontend-environment.mjs','merchant'],{
  cwd:fileURLToPath(new URL('../../',import.meta.url)),
  env:processEnv,encoding:'utf8'
 });
 assert.equal(r.status,1);
 assert.match(r.stderr,/BLOCKED/);
 assert.match(r.stderr,/Preview must never use Production/);
 assert.doesNotMatch(r.stderr,/sb_publishable_/);
 assert.doesNotMatch(r.stderr,/x{25}/);
});

test('production build CLI passes known production URL (release approval still separate)',()=>{
 const r=spawnSync(process.execPath,['scripts/qa/vercel-frontend-environment.mjs','admin'],{
  cwd:fileURLToPath(new URL('../../',import.meta.url)),
  env:{...process.env,...env('production','admin')},encoding:'utf8'
 });
 assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,/production backend binding verified/);
});

test('unknown surface fails closed',()=>{
 assert.equal(check('website',env('production','merchant')).ok,false);
});

test('unverified QA preview protection prevents both Merchant and Admin QA builds',()=>{
 for(const surface of ['merchant','admin']){
  const attestation=good();
  attestation.qa_preview_access_protection_preflight_verified=false;
  assert.equal(check(surface,env('preview',surface),attestation).ok,false);
 }
});
