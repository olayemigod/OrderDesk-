#!/usr/bin/env node
/**
 * SellerTray OA5 historical Vercel Preview custody verifier.
 * Offline only. It verifies five SANITIZED provider metadata records,
 * NOT downloaded browser JS, protection, reviewer access or reset authority.
 * No provider tokens, publishable key bytes or preview URLs are stored here.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const TEST_REF='iukgsukdoowvnhlfmpml';
const PRODUCTION_REF='eujxswjspolugrzlsjnn';
const EXPECTED=Object.freeze([
  ['sellertray-merchant','codex/agreement-package-oa5c-convergence','dpl_Cfh7oAt9nHQkdUZtbXShj7jfhMfw','3f0df8f16455572cd0d1c079a3ac2327cc5bcd88'],
  ['sellertray-merchant','codex/agreement-package-architecture','dpl_Gh9s6Rm2dJibEKuBDDcm7jZ3bGmz','bbee34e999971b5c87e7274428ee655e4ff36d4d'],
  ['sellertray-admin','fix/admin-visual-baseline-oa5-convergence-20261031','dpl_5UfqxbGpPuQqGkSu1rU4bpCFrQWZ','7ba66274068ee75a2341a9adcccde338b1545f90'],
  ['sellertray-admin','codex/agreement-package-oa5c-convergence','dpl_H1suGYapnAjZR9rAKBq8WLtHu5Uo','3f0df8f16455572cd0d1c079a3ac2327cc5bcd88'],
  ['sellertray-admin','codex/agreement-package-architecture','dpl_J9nL3wiNKyXcJEoVjbb65kUw4JnA','3c6e338ef7743c270023e791034c321294c70e6f'],
]);
const REQUIRED_VARS=new Set(['VITE_SUPABASE_URL','VITE_SUPABASE_PUBLISHABLE_KEY']);

export function verifyHistoricalPreviewCustody(a){
  const errors=[];
  if (!a||typeof a!=='object'||Array.isArray(a))return {ok:false,errors:['Missing read-only historical Preview metadata snapshot']};
  if(a.schema_version!==1||a.project_ref!==TEST_REF||a.evidence_class!=='vercel_historical_deployment_metadata_only')
    errors.push('Snapshot has wrong Test project or evidence classification');
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(a.captured_at_utc||'')||!Number.isFinite(Date.parse(a.captured_at_utc)))
    errors.push('Snapshot capture time is not an exact UTC ISO instant');
  if(a.test_custom_domains_attached!==false
    ||a.unauthorized_browser_access_verified!==false
    ||a.authorized_reviewer_access_verified!==false
    ||a.compiled_bundle_backend_verified!==false)
    errors.push('This snapshot cannot claim hosted Test domain, browser, reviewer or compiled-bundle acceptance');
  if(a.account_plan!=='hobby')errors.push('Recorded plan is not the verified Hobby baseline');
  const allowedProjects=new Map([
    ['sellertray-merchant',{domain:'app.sellertray.com',sso:false,scope:null}],
    ['sellertray-admin',{domain:'admin.sellertray.com',sso:true,scope:'all_except_custom_domains'}],
  ]);
  if(!Array.isArray(a.live_projects)||a.live_projects.length!==allowedProjects.size)
    errors.push('Expected exactly the two existing live web projects');
  const seenProjects=new Set();
  for(const p of Array.isArray(a.live_projects)?a.live_projects:[]){
    if(!p||typeof p!=='object'){errors.push('Malformed web project record');continue;}
    const want=allowedProjects.get(p.project);
    if(!want||seenProjects.has(p.project))errors.push('Unexpected or duplicate Vercel web project');
    else if(p.production_domain!==want.domain||p.password_enabled!==false
      ||p.sso_enabled!==want.sso||p.sso_scope!==want.scope)
      errors.push('Vercel web protection or Production domain settings drift: '+p.project);
    seenProjects.add(p.project);
  }
  if(!Array.isArray(a.deployments)||a.deployments.length!==EXPECTED.length)
    errors.push('Exactly five preserved historical deployments are required');
  const seen=new Set();
  for(const deployment of Array.isArray(a.deployments)?a.deployments:[]){
    if(!deployment||typeof deployment!=='object'){errors.push('Malformed historical deployment');continue;}
    const tuple=EXPECTED.find(([project,branch])=>project===deployment.project&&branch===deployment.branch);
    const key=deployment.project+':'+deployment.branch;
    if(!tuple||seen.has(key)){errors.push('Unexpected or duplicate historical Preview deployment');continue;}
    seen.add(key);
    const [,,,sha]=tuple;
    if(deployment.id!==tuple[2]||deployment.sha!==sha||deployment.state!=='READY')
      errors.push('Historical deployment/source provenance mismatch: '+key);
    if(!Number.isSafeInteger(deployment.created_at_ms)||deployment.created_at_ms<=0)
      errors.push('Invalid deployment creation timestamp: '+key);
    if(deployment.alias_count!==1||deployment.production_or_qa_custom_alias_count!==0)
      errors.push('Historical Preview has unexpected alias/domain count: '+key);
    if(deployment.preview_backend_ref!==TEST_REF||deployment.preview_backend_ref===PRODUCTION_REF)
      errors.push('Historical Preview URL configuration is not isolated Test: '+key);
    const vars=deployment.scoped_vars;
    if(!Array.isArray(vars)||vars.length!==2)
      errors.push('Expected two separately scoped Preview environment variable records: '+key);
    const kinds=new Set();
    for(const v of Array.isArray(vars)?vars:[]){
      if(!v||typeof v!=='object'){errors.push('Malformed Preview environment record: '+key);continue;}
      if(!REQUIRED_VARS.has(v.kind)||kinds.has(v.kind))
        errors.push('Unexpected or duplicate Preview environment variable: '+key);
      kinds.add(v.kind);
      if(typeof v.id!=='string'||!/^[A-Za-z0-9]{16}$/.test(v.id))
        errors.push('Preview environment variable identifier malformed: '+key);
      if(!Number.isSafeInteger(v.created_at_ms)||!Number.isSafeInteger(v.updated_at_ms)
        ||v.created_at_ms>v.updated_at_ms||v.created_at_ms>deployment.created_at_ms
        ||v.updated_at_ms>deployment.created_at_ms)
        errors.push('Preview environment variable was added/modified after deployment: '+key);
      // The actual value is intentionally never stored for publishable keys.
      if(Object.hasOwn(v,'value')||Object.hasOwn(v,'secret')||Object.hasOwn(v,'url'))
        errors.push('Preview environment value/URL must never be embedded in public custody snapshot: '+key);
    }
    if(kinds.size!==2)errors.push('Missing branch-specific Test URL or public-key variable: '+key);
  }
  if(seen.size!==EXPECTED.length)errors.push('One or more historical Preview proofs are missing');
  return {
    ok:errors.length===0,errors,
    evidence_scope:'metadata_only',
    hosted_acceptance:false,
    required_next_proof:'signed_out_and_authorized_browser_access_plus_compiled_js_backend'
  };
}

function main(){
  if(process.argv.length!==4||process.argv[2]!=='--check'){
    console.error('Usage: node scripts/qa/oa5-historical-preview-custody.mjs --check <sanitized-snapshot.json>');
    process.exitCode=2;return;
  }
  let snapshot;
  try{snapshot=JSON.parse(readFileSync(resolve(process.argv[3]),'utf8'));}
  catch{console.error('BLOCKED: historical Vercel snapshot missing or malformed');process.exitCode=1;return;}
  const result=verifyHistoricalPreviewCustody(snapshot);
  if(!result.ok){
    console.error('BLOCKED: historical Preview metadata custody does not match verified baseline:');
    for(const reason of result.errors)console.error(' - '+reason);
    process.exitCode=1;return;
  }
  console.log('Historical Preview metadata custody verified for five deployments (offline only).');
  console.log('NOT proof of compiled JS, browser access, protected QA domain, or Test reset approval.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
