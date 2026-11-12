#!/usr/bin/env node
/**
 * SellerTray OA5 Test Edge Function inventory / source roster guard.
 *
 * Strictly offline. No Supabase HTTP, deploy, token, callback or SQL writes.
 * Historical metadata can establish deployed *slug* differences only:
 * it cannot attest that hosted code equals the reviewed Git source tree.
 */
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const TEST_PROJECT_REF='iukgsukdoowvnhlfmpml';
export const LEGACY_PROBE='agreement-pdf-runtime-probe';
const FRESH_MS=10*60*1000;
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
// Immutable 09 Nov historical roster provenance. Never rewrite its source
// tree SHA because a later reviewed source change (e.g., a security fix) made
// the current tree different. A historical snapshot is NOT current QA runtime.
export const FROZEN_HISTORICAL_SOURCE=Object.freeze({
  commit:'ed5023e577cb1f6d25c1fabbc1a519f7f2c563ba',
  treeSha:'eecf916c79e0e0da9d1ac09f180f9ab829ce9183',
});

const equals=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
const exactKeys=(obj,keys)=>Object.keys(obj).sort().join('|')===[...keys].sort().join('|');

export function sourceInventory(root=ROOT){
  const dirs=readdirSync(join(root,'supabase/functions'),{withFileTypes:true});
  const slugs=dirs.filter(d=>d.isDirectory()).filter(d=>{
    try{return readFileSync(join(root,'supabase/functions',d.name,'index.ts')).length>0;}
    catch{return false;}
  }).map(x=>x.name).sort();
  const treeSha=execFileSync('git',['-C',root,'rev-parse','HEAD:supabase/functions'],{
    encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000,
  }).trim();
  if(!/^[0-9a-f]{40}$/.test(treeSha))throw new Error('Cannot pin source Edge Function Git tree');
  return {slugs,treeSha};
}
export function evaluateTestEdgeInventory(snapshot,source,now=new Date(),{historicalBaseline=false}={}){
  const errors=[];
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))
    return {ok:false,errors:['Missing Test-only sanitized Edge inventory'],inventory_complete:false,hosted_acceptance:false};
  const keys=['schema_version','project_ref','observation_type','observed_at_utc','source_inventory_commit','source_tree_sha','canonical_slugs','hosted_functions'];
  if(!exactKeys(snapshot,keys))errors.push('Snapshot shape changed or contains unreviewed metadata fields');
  if(snapshot.schema_version!==1||snapshot.project_ref!==TEST_PROJECT_REF||
      snapshot.observation_type!=='read-only-metadata')
    errors.push('Not the reviewed isolated Test metadata boundary');
  if(typeof snapshot.source_inventory_commit!=='string'||!/^[0-9a-f]{40}$/.test(snapshot.source_inventory_commit))
    errors.push('Source inventory provenance commit malformed');
  const currentSourceMatches=!!source&&Array.isArray(source.slugs)
    && typeof source.treeSha==='string'&&snapshot.source_tree_sha===source.treeSha;
  if(historicalBaseline){
    // The old Test census is documentary evidence, not a pre-acceptance
    // binding to today's source. It must match the original immutable pin.
    if(snapshot.source_inventory_commit!==FROZEN_HISTORICAL_SOURCE.commit||
       snapshot.source_tree_sha!==FROZEN_HISTORICAL_SOURCE.treeSha)
      errors.push('Historical Edge roster provenance was changed');
  } else if(!currentSourceMatches) {
    errors.push('Reviewed source Edge Function tree SHA does not match current checkout');
  }
  const expected=Array.isArray(snapshot.canonical_slugs)?snapshot.canonical_slugs:[];
  if(!expected.length||!equals(expected,[...new Set(expected)].sort())||
      !equals(expected,source?.slugs||[]))
    errors.push('Canonical Edge Function roster missing, unsorted or diverges from inspected source');
  const value=snapshot.observed_at_utc;
  const epoch=typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)?Date.parse(value):NaN;
  if(!Number.isFinite(epoch)||epoch>now.getTime()+60000)
    errors.push('Missing or future UTC observation time');
  const fresh=Number.isFinite(epoch)&&epoch<=now.getTime()&&now.getTime()-epoch<=FRESH_MS;
  const hosted=Array.isArray(snapshot.hosted_functions)?snapshot.hosted_functions:[];
  if(!Array.isArray(snapshot.hosted_functions))errors.push('Hosted function census is missing');
  const seen=new Set();
  for(const record of hosted){
    if(!record||typeof record!=='object'||Array.isArray(record)||
       !exactKeys(record,['slug','status','version','verify_jwt'])){
      errors.push('Malformed or excessively detailed hosted metadata row');continue;
    }
    const {slug,version,status,verify_jwt}=record;
    if(typeof slug!=='string'||!/^[a-z][a-z0-9-]*$/.test(slug)||seen.has(slug))
      errors.push('Malformed or repeated hosted Edge Function slug');
    seen.add(slug);
    if(!Number.isSafeInteger(version)||version<1||
       typeof status!=='string'||!status||typeof verify_jwt!=='boolean')
      errors.push('Hosted Edge Function version/status/JWT metadata missing');
  }
  const sourceSet=new Set(source?.slugs||[]);
  const missing=(source?.slugs||[]).filter(slug=>!seen.has(slug));
  const legacy=hosted.filter(x=>x?.slug===LEGACY_PROBE).map(x=>x.slug);
  const unexpected=hosted.filter(x=>typeof x?.slug==='string'&&!sourceSet.has(x.slug)&&x.slug!==LEGACY_PROBE).map(x=>x.slug);
  const notActive=hosted.filter(x=>sourceSet.has(x?.slug)&&x.status!=='ACTIVE').map(x=>x.slug);
  const inventory_complete=!historicalBaseline&&currentSourceMatches&&errors.length===0
    &&fresh&&missing.length===0&&legacy.length===0&&unexpected.length===0&&notActive.length===0;
  return {ok:errors.length===0,errors,fresh,missing,legacy,unexpected,notActive,
    historical_baseline_only:historicalBaseline,
    current_source_tree_matches_baseline:currentSourceMatches,
    canonical_count:(source?.slugs||[]).length,hosted_count:hosted.length,
    inventory_complete,hosted_acceptance:false,
    caveat:'Metadata cannot prove deployed code/version hash, environment secrets, callback isolation or tenant-safe runtime'};
}

function main(){
  const [mode,path]=process.argv.slice(2);
  if(process.argv.length!==4||!['--baseline','--inventory'].includes(mode)){
    console.error('Usage: node scripts/qa/oa5-test-edge-inventory.mjs --baseline|--inventory <sanitized-readonly-test.json>');
    process.exitCode=2;return;
  }
  let snapshot,source;
  try{
    snapshot=JSON.parse(readFileSync(resolve(path),'utf8'));
    source=sourceInventory();
  }catch{
    console.error('BLOCKED: sanitized metadata snapshot or Git source inventory not available');
    process.exitCode=1;return;
  }
  const result=evaluateTestEdgeInventory(snapshot,source,new Date(),{historicalBaseline:mode==='--baseline'});
  if(!result.ok){
    console.error('BLOCKED: Test Edge inventory evidence malformed or source provenance drifted');
    for(const error of result.errors)console.error(' - '+error);
    process.exitCode=1;return;
  }
  if(mode==='--baseline'){
    // Exact frozen historical census: test source still has 50 functions,
    // the pre-rebuild Test environment had four shared slugs plus one
    // retained agreement runtime probe. Never confuse this with acceptance.
    if(result.canonical_count!==50||result.hosted_count!==5||result.missing.length!==46||
       result.legacy.length!==1||result.unexpected.length||result.notActive.length){
      console.error('BLOCKED: historical Edge baseline census no longer matches reviewed evidence');
      process.exitCode=1;return;
    }
    console.log('PASS: frozen 09-Nov Test Edge metadata roster (4/50 canonical, 46 absent, 1 historical probe).');
    if(!result.current_source_tree_matches_baseline)
      console.log('CURRENT SOURCE CHANGED: historical baseline is preserved, NOT an accepted current Edge inventory.');
    console.log('NO-GO: historical metadata never authorizes deployed source, provider callbacks or Test acceptance.');
  } else if(!result.inventory_complete){
    console.error('BLOCKED: Test Edge function slug inventory is incomplete, stale or contains legacy/unreviewed functions.');
    console.error('Canonical '+result.canonical_count+' / hosted '+result.hosted_count+'; missing '+result.missing.length+
      ', historical '+result.legacy.length+', unexpected '+result.unexpected.length+', inactive '+result.notActive.length);
    process.exitCode=1;
  } else {
    console.log('PASS: fresh, sanitized Test metadata contains exactly the reviewed source function roster.');
    console.log('NOT hosted source-bundle, permissions, secrets, payment/Meta callback or staging attestation acceptance.');
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
