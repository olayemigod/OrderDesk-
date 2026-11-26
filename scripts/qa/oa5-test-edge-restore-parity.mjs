#!/usr/bin/env node
/**
 * OA5 historical Test Edge code-identity check after Test project restore.
 * OFFLINE ONLY: compares strict, sanitized provider metadata with the original
 * frozen historical bundle digests, without calling or deploying functions.
 * Provider-reported version +1 is classified as metadata drift, NEVER as
 * proof that Supabase performed a new deploy or that external egress is safe.
 */
import {readFileSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TEST_PROJECT,KNOWN} from './oa5-test-edge-bundle-drift.mjs';

export const PURPOSE='oa5-post-restore-test-edge-digest-parity';
export const LAST_REVIEWED_HISTORICAL_DAY_UTC='2026-11-13T00:00:00Z';
export const MAX_AGE_MS=10*60*1000;
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).sort().join('|')===[...keys].sort().join('|');
const timestamp=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(s)?Date.parse(s):NaN;

export function assessEdgeRestoreDigestParity(record,now=new Date()){
  const reasons=[];
  const out=()=>({
    restored_edge_bundle_digests_match_historical_custody:reasons.length===0,
    provider_reported_version_offset:reasons.length===0?1:null,
    exact_old_version_metadata_preserved:false,
    reason_for_provider_version_shift_verified:false,
    edge_source_lineage_independently_verified:false,
    external_provider_containment_verified:false,
    historical_preview_access_verified:false,
    hosted_test_reconstruction_authorized:false,
    edge_deployment_authorized:false,
    production_change_authorized:false,
    reasons
  });
  if(!exact(record,['schema_version','project_ref','purpose','observed_at_utc','functions'])){
    reasons.push('Missing or overbroad Test-only Edge metadata record');return out();
  }
  if(record.schema_version!==1||record.project_ref!==TEST_PROJECT||record.purpose!==PURPOSE)
    reasons.push('Wrong Test project, schema or observation purpose');
  const nowMs=now instanceof Date?now.getTime():NaN,at=timestamp(record.observed_at_utc);
  if(!Number.isFinite(nowMs)||!Number.isFinite(at)||at>nowMs||nowMs-at>MAX_AGE_MS)
    reasons.push('Test-only Edge snapshot missing, future-dated or stale');
  if(!Array.isArray(record.functions)||record.functions.length!==KNOWN.length){
    reasons.push('Expected exactly five historic Edge bundles');return out();
  }
  const seen=new Set();
  for(const f of record.functions){
    if(!exact(f,['slug','status','version','verify_jwt','bundle_sha256','updated_at_ms'])){
      reasons.push('Malformed or identity-bearing Test Edge field');continue;
    }
    if(seen.has(f.slug)){reasons.push('Duplicate Test Edge function');continue;}
    seen.add(f.slug);
    const baseline=KNOWN.find(b=>b.slug===f.slug);
    if(!baseline){reasons.push('Unrecognized Test Edge slug');continue;}
    if(f.status!==baseline.status || f.verify_jwt!==baseline.verify_jwt||
      f.bundle_sha256!==baseline.bundle_sha256){
      reasons.push('Historic Edge bundle digest/JWT/status changed: '+f.slug);
    }
    // Do not globally waive arbitrary version changes. Current observed
    // offset is exactly +1 for all five preserved historic bundle digests.
    if(!Number.isSafeInteger(f.version)||f.version!==baseline.version+1)
      reasons.push('Unexpected reported Edge function version: '+f.slug);
    if(!Number.isSafeInteger(f.updated_at_ms)||
      f.updated_at_ms< Date.parse('2026-10-01T00:00:00Z')||
      f.updated_at_ms>=Date.parse(LAST_REVIEWED_HISTORICAL_DAY_UTC)||
      f.updated_at_ms>at)
      reasons.push('Edge update timestamp does not predate historical freeze: '+f.slug);
  }
  if(seen.size!==KNOWN.length)
    reasons.push('Missing historic Edge function metadata');
  return out();
}

function main(){
  if(process.argv.length!==4||process.argv[2]!=='--check'){
    console.error('Usage: node scripts/qa/oa5-test-edge-restore-parity.mjs --check <protected-Test-edge-metadata.json>');
    process.exitCode=2;return;
  }
  let record;
  try{
    const path=resolve(process.argv[3]),st=lstatSync(path);
    if(!st.isFile()||st.isSymbolicLink()||st.size>32768)throw Error('unsafe');
    record=JSON.parse(readFileSync(path,'utf8'));
  }catch{
    console.error('BLOCKED: missing or unsafe private Test Edge metadata evidence');
    process.exitCode=1;return;
  }
  const status=assessEdgeRestoreDigestParity(record);
  if(!status.restored_edge_bundle_digests_match_historical_custody){
    console.error('BLOCKED: historical Test Edge binary digest parity not established');
    for(const reason of status.reasons)console.error(' - '+reason);
    process.exitCode=1;return;
  }
  console.log('PASS: five frozen historical Test Edge bundle digests/JWT/status match after project restoration.');
  console.log('OBSERVED: provider version counters are uniformly historical version +1, update dates before historical freeze.');
  console.log('NOT VERIFIED: reason for version offset, executable-source provenance, provider egress or Vercel Preview access.');
  console.log('NOT AUTHORIZED: no Edge deploy, remote reset, Auth change or Production change.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
