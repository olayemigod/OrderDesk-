#!/usr/bin/env node
/**
 * Offline-only SellerTray environment/resource governance verifier.
 * Never calls Vercel/Supabase/GitHub or deploys/builds anything.
 *
 * Vercel git.deploymentEnabled is the *primary* spend guard:
 * prevent ordinary feature PRs creating deployments at all.
 * ignoreCommand is only a secondary, path-scoped build guard.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const projectRoot=new URL('../../',import.meta.url);
const readText=(file)=>readFileSync(fileURLToPath(new URL(file,projectRoot)),'utf8');
const allowed={
  'merchant-web':'qa-preview/merchant-**',
  'admin-web':'qa-preview/admin-**',
};
export function permitAutoDeployment(project,branch) {
  if(!Object.hasOwn(allowed,project) || typeof branch!=='string')return false;
  return branch==='main'
    || (branch.startsWith(allowed[project].slice(0,-2))
       && branch.length>allowed[project].length-2
       && /^[a-z0-9][a-z0-9-]*$/.test(branch.slice(allowed[project].length-2)));
}

export function validateResourcePolicy({merchant,admin,androidWorkflow,governance}) {
  const errors=[];
  for(const [surface,project] of [['merchant-web',merchant],['admin-web',admin]]) {
    const map=project?.git?.deploymentEnabled;
    const expected=allowed[surface];
    const keys=map && typeof map==='object'&&!Array.isArray(map)?Object.keys(map).sort():[];
    if(JSON.stringify(keys)!==JSON.stringify(['**','main',expected].sort())
       ||map?.['**']!==false||map?.main!==true||map?.[expected]!==true)
      errors.push(surface+': only main and its explicit qa-preview namespace may auto-deploy');
    if(typeof project?.ignoreCommand!=='string'
       ||!project.ignoreCommand.includes('apps/'+surface)
       ||!project.ignoreCommand.includes('package-lock.json')
       ||!project.ignoreCommand.includes('git diff --quiet'))
      errors.push(surface+': preserve fallback ignore-build path scope');
    if(project.framework!=='vite')
      errors.push(surface+': current Vite build configuration must be preserved');
  }
  if(typeof androidWorkflow!=='string'
     ||!/^on:\s*\n\s{2}workflow_dispatch:/m.test(androidWorkflow)
     ||/^\s{2}(pull_request|push):/m.test(androidWorkflow)
     ||!androidWorkflow.includes('source_sha:')
     ||!androidWorkflow.includes('acceptance_reason:')
     ||!androidWorkflow.includes('EXPECTED_SOURCE_SHA'))
    errors.push('Expensive native Android APK workflow must be manual, exact-SHA and milestone gated');
  if(typeof governance!=='string'
     || !governance.includes('eujxswjspolugrzlsjnn')
     || !governance.includes('iukgsukdoowvnhlfmpml')
     || !governance.includes('Tandar Oil Solutions')
     || !governance.includes('no production')
     || !governance.includes('05/11/') && !governance.includes('04/11/2026'))
    errors.push('Normative environment governance must preserve Production and Test boundaries');
  return {ok:errors.length===0,errors};
}

export function loadResourcePolicyFiles() {
  return {
    merchant:JSON.parse(readText('apps/merchant-web/vercel.json')),
    admin:JSON.parse(readText('apps/admin-web/vercel.json')),
    androidWorkflow:readText('.github/workflows/android-qa-apk.yml'),
    governance:readText('.agents/skills/sellertray-project-implementation/ENVIRONMENTS_RESOURCES.md'),
  };
}

function main(){
  const failures=process.argv.slice(2).filter(a=>a!=='--check');
  if(failures.length){
    console.error('Unsupported action. This script cannot provision or deploy anything.');
    process.exitCode=2;return;
  }
  let result;
  try{result=validateResourcePolicy(loadResourcePolicyFiles());}
  catch{console.error('Environment resource policy files could not be read.');process.exitCode=1;return;}
  if(!result.ok){
    console.error('SellerTray resource policy BLOCKED:');
    for(const error of result.errors)console.error(' - '+error);
    process.exitCode=1;return;
  }
  console.log('SellerTray environment resource policy verified offline.');
  console.log('Feature branches do not auto-preview; only main and deliberate surface-specific QA preview branches are eligible.');
  console.log('Production-tracked branch confirmation is required before release/merge.');
  console.log('No Vercel deployment, Supabase mutation, Android build or external API call was made.');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fileURLToPath(new URL('file://'+process.argv[1])))main();
