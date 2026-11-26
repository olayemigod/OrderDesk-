import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {KNOWN,BASELINE_PURPOSE,assessTestEdgeBundleDrift} from './oa5-test-edge-bundle-drift.mjs';
import {assessEdgeRestoreDigestParity,PURPOSE} from './oa5-test-edge-restore-parity.mjs';

const NOW=new Date('2026-11-26T20:00:00Z');
const make=()=>({
 schema_version:1,project_ref:'iukgsukdoowvnhlfmpml',purpose:PURPOSE,
 observed_at_utc:'2026-11-26T19:59:00Z',
 functions:KNOWN.map((f,i)=>({
  slug:f.slug,status:f.status,version:f.version+1,
  verify_jwt:f.verify_jwt,bundle_sha256:f.bundle_sha256,
  updated_at_ms:Date.parse('2026-10-28T12:00:00Z')+i*60000
 }))
});
const check=(fn)=>{const s=make();fn?.(s);return assessEdgeRestoreDigestParity(s,NOW);};
test('all five historical digests preserved across uniform provider version +1',()=>{
 const result=check();
 assert.equal(result.restored_edge_bundle_digests_match_historical_custody,true,result.reasons.join('; '));
 assert.equal(result.provider_reported_version_offset,1);
 for(const flag of [
  'exact_old_version_metadata_preserved','reason_for_provider_version_shift_verified',
  'edge_source_lineage_independently_verified','external_provider_containment_verified',
  'historical_preview_access_verified','hosted_test_reconstruction_authorized',
  'edge_deployment_authorized','production_change_authorized'
 ])assert.equal(result[flag],false,flag);
});
test('restore-offset check never reinterprets historical strict baseline metadata',()=>{
 const b=make();
 const strict={schema_version:1,project_ref:b.project_ref,
  purpose:BASELINE_PURPOSE,observed_at_utc:b.observed_at_utc,
  functions:b.functions.map(({updated_at_ms,...rest})=>rest)};
 const old=assessTestEdgeBundleDrift(strict,NOW,'baseline');
 assert.equal(old.metadata_matches_historical_baseline,false);
});
test('wrong project, unexpected metadata and secrets fail closed',()=>{
 for(const change of [
  s=>s.project_ref='eujxswjspolugrzlsjnn',
  s=>s.project_ref='wrong-project',
  s=>s.schema_version=2,
  s=>s.purpose='approve-db-reset',
  s=>s.approved=true,
  s=>s.functions[0].email='qa@example.invalid',
  s=>s.functions[0].callback_url='https://example.invalid',
  s=>s.functions[0].entrypoint_path='file:///tmp/secret',
  s=>s.functions[1].slug=s.functions[0].slug,
  s=>s.functions.pop()
 ])assert.equal(check(change).restored_edge_bundle_digests_match_historical_custody,false);
});
test('mismatched digest, JWT, status or version offsets fail closed',()=>{
 for(const change of [
  s=>s.functions[2].bundle_sha256='0'.repeat(64),
  s=>s.functions[2].verify_jwt=false,
  s=>s.functions[2].status='INACTIVE',
  s=>s.functions[2].version++,
  s=>s.functions[2].version-=2,
  s=>s.functions[2].version='6',
  s=>s.functions[2].updated_at_ms=Date.parse('2026-11-26T19:00:00Z'),
  s=>s.functions[2].updated_at_ms=Date.parse('2026-11-13T00:00:00Z'),
  s=>s.functions[2].updated_at_ms=0,
  s=>s.functions[2].updated_at_ms=NaN
 ])assert.equal(check(change).restored_edge_bundle_digests_match_historical_custody,false);
});
test('expired, future, ambiguous time and missing evidence fail closed',()=>{
 for(const change of [
  s=>s.observed_at_utc='2026-11-26T19:49:59Z',
  s=>s.observed_at_utc='2026-11-26T20:00:01Z',
  s=>s.observed_at_utc='2026-11-26T19:59:00+00:00',
  s=>s.observed_at_utc='bad'
 ])assert.equal(check(change).restored_edge_bundle_digests_match_historical_custody,false);
 assert.equal(assessEdgeRestoreDigestParity(null,NOW).restored_edge_bundle_digests_match_historical_custody,false);
});
test('offline CLI refuses missing private metadata, prints no path',()=>{
 const script=new URL('./oa5-test-edge-restore-parity.mjs',import.meta.url).pathname;
 const p='/secret/edge-restore-live.json';
 const result=spawnSync(process.execPath,[script,'--check',p],{encoding:'utf8'});
 assert.equal(result.status,1);
 assert.match(result.stderr,/BLOCKED/);
 assert.equal(result.stderr.includes(p),false);
});
