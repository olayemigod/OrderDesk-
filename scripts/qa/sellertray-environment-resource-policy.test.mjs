import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {permitAutoDeployment,validateResourcePolicy,loadResourcePolicyFiles} from './sellertray-environment-resource-policy.mjs';

const actual=loadResourcePolicyFiles();
const clone=() => structuredClone(actual);
const validate=(change)=>{const x=clone();change(x);return validateResourcePolicy(x)};

test('Merchant/Admin Vercel and Android source policy is valid without remote calls',()=>{
 const result=validateResourcePolicy(actual);
 assert.deepEqual(result.errors,[]);
 assert.equal(result.ok,true);
});

test('production main remains allowed by the candidate release rule',()=>{
 for(const project of ['merchant-web','admin-web']){
  assert.equal(permitAutoDeployment(project,'main'),true);
 }
});

test('only deliberate, surface-specific QA preview branches may auto-deploy',()=>{
 assert.equal(permitAutoDeployment('merchant-web','qa-preview/merchant-oa5-acceptance'),true);
 assert.equal(permitAutoDeployment('admin-web','qa-preview/admin-oa5-acceptance'),true);
 assert.equal(permitAutoDeployment('merchant-web','qa-preview/admin-oa5-acceptance'),false);
 assert.equal(permitAutoDeployment('admin-web','qa-preview/merchant-oa5-acceptance'),false);
});

test('feature PRs, documentation branches and historic agreement branches cannot auto-deploy',()=>{
 for(const branch of [
  'feat/oa5-staging-isolation-contract-20261104',
  'feat/c2-6-c2-7-branch-commercial-settlement-20261102',
  'codex/agreement-package-architecture',
  'fix/merchant-approved-implementation-restore-20261104',
  'chore/docs-only',
  'qa-preview/merchant-',
  'qa-preview/merchant-foo/other',
  '',
 ])for(const project of ['merchant-web','admin-web']){
  assert.equal(permitAutoDeployment(project,branch),false,project+': '+branch);
 }
});

test('fail closed if preview branches are enabled globally',()=>{
 const r=validate(x=>{x.merchant.git.deploymentEnabled['**']=true;});
 assert.equal(r.ok,false);
 assert.match(r.errors.join('\n'),/merchant-web/);
});

test('fail closed if production main gets disabled',()=>{
 const r=validate(x=>{x.admin.git.deploymentEnabled.main=false;});
 assert.equal(r.ok,false);
 assert.match(r.errors.join('\n'),/admin-web/);
});

test('fail closed if wrong surface QA namespace can auto deploy',()=>{
 const r=validate(x=>{x.merchant.git.deploymentEnabled['qa-preview/admin-**']=true;});
 assert.equal(r.ok,false);
});

test('existing useful Vercel build and security config remain unchanged',()=>{
 const r=validate(x=>{x.admin.ignoreCommand='echo skip';});
 assert.equal(r.ok,false);
 assert.match(r.errors.join('\n'),/ignore-build/);
});

test('expensive Android APK cannot be silently re-enabled on every PR or push',()=>{
 const r=validate(x=>{x.androidWorkflow=x.androidWorkflow.replace(
  '  workflow_dispatch:','  pull_request:\n  workflow_dispatch:'
 );});
 assert.equal(r.ok,false);
 assert.match(r.errors.join('\n'),/manual, exact-SHA and milestone/);
});

test('exact source SHA and acceptance reason are mandatory for manual native build',()=>{
 const r=validate(x=>{x.androidWorkflow=x.androidWorkflow.replace('      acceptance_reason:', '      disposable_reason:');});
 assert.equal(r.ok,false);
});

test('governance must protect Tandar and the verified Test and Production project refs',()=>{
 const r=validate(x=>{x.governance=x.governance.replace('Tandar Oil Solutions','another merchant');});
 assert.equal(r.ok,false);
});

test('offline CLI passes without provisioning or deploying',()=>{
 const r=spawnSync(process.execPath,['scripts/qa/sellertray-environment-resource-policy.mjs','--check'],{
  cwd:fileURLToPath(new URL('../../',import.meta.url)),encoding:'utf8'
 });
 assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,/verified offline/);
 assert.match(r.stdout,/No Vercel deployment, Supabase mutation/);
});

test('CLI rejects any attempted deploy/mutation argument',()=>{
 const r=spawnSync(process.execPath,['scripts/qa/sellertray-environment-resource-policy.mjs','--deploy'],{
  cwd:fileURLToPath(new URL('../../',import.meta.url)),encoding:'utf8'
 });
 assert.equal(r.status,2);
 assert.match(r.stderr,/cannot provision or deploy/);
});
