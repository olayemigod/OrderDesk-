import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sourceInventory,evaluateTestEdgeInventory,TEST_PROJECT_REF,LEGACY_PROBE} from './oa5-test-edge-inventory.mjs';
const snapshot=JSON.parse(readFileSync(new URL('../../docs/qa/oa5-test-edge-function-custody-2026-11-09.json',import.meta.url)));
const source=sourceInventory();
const clone=()=>structuredClone(snapshot);
const now=new Date('2026-11-09T23:00:00Z');

test('read-only historical Test source pin counts 50 canonical slugs, 5 hosted, and no hosted acceptance',()=>{
  const v=evaluateTestEdgeInventory(clone(),source,now,{historicalBaseline:true});
  assert.equal(v.ok,true,v.errors.join('\n'));
  assert.equal(v.canonical_count,50);
  assert.equal(v.hosted_count,5);
  assert.equal(v.missing.length,46);
  assert.deepEqual(v.legacy,[LEGACY_PROBE]);
  assert.deepEqual(v.unexpected,[]);
  assert.equal(v.inventory_complete,false);
  assert.equal(v.hosted_acceptance,false);
  assert.equal(v.historical_baseline_only,true);
  assert.equal(v.current_source_tree_matches_baseline,false,
    'Test security source changed; historical evidence must not imply deployed-current equivalence');
});
test('rejects different production project, missing provenance, or source tree drift',()=>{
  for(const change of [
    s=>s.project_ref='eujxswjspolugrzlsjnn',
    s=>s.project_ref='unknown',
    s=>s.source_tree_sha='0'.repeat(40),
    s=>s.source_inventory_commit=null,
    s=>s.source_inventory_commit='f'.repeat(40),
    s=>s.observation_type='provider-accepted',
    s=>s.schema_version=2,
  ]){const s=clone();change(s);assert.equal(
    evaluateTestEdgeInventory(s,source,now,{historicalBaseline:true}).ok,false);
  }
});
test('rejects slugs missing from reviewed canonical source, duplicates, and invented entries',()=>{
  for(const change of [
    s=>s.canonical_slugs.pop(),
    s=>s.canonical_slugs.push('unreviewed-function'),
    s=>s.canonical_slugs[0]=s.canonical_slugs[1],
    s=>s.canonical_slugs.reverse(),
  ]){const s=clone();change(s);assert.equal(evaluateTestEdgeInventory(s,source,now,{historicalBaseline:true}).ok,false);}
});
test('rejects missing/incomplete hosted evidence and sensitive extra fields',()=>{
  for(const change of [
    s=>delete s.hosted_functions,
    s=>s.hosted_functions[0].slug=s.hosted_functions[1].slug,
    s=>s.hosted_functions[0].version=0,
    s=>s.hosted_functions[0].verify_jwt=null,
    s=>s.hosted_functions[0].secret='do-not-store',
    s=>s.service_role_key='do-not-store',
  ]){const s=clone();change(s);assert.equal(evaluateTestEdgeInventory(s,source,now,{historicalBaseline:true}).ok,false);}
});
test('stale and malformed observations never approve an operator inventory gate',()=>{
  for(const stamp of ['unknown','2026-10-31T12:00:00Z','2050-01-01T00:00:00Z',null]){
    const s=clone();s.observed_at_utc=stamp;
    const result=evaluateTestEdgeInventory(s,source,now,{historicalBaseline:true});
    assert.equal(result.inventory_complete,false);
    if(stamp==='unknown'||stamp===null||stamp.startsWith('2050'))assert.equal(result.ok,false);
  }
});
test('fresh full canonical roster confirms slug census but NOT hosted code/source acceptance',()=>{
  const s=clone();s.observed_at_utc='2026-11-09T22:59:30Z';
  s.hosted_functions=source.slugs.map((slug,i)=>({slug,status:'ACTIVE',version:i+1,verify_jwt:true}));
  const r=evaluateTestEdgeInventory(s,source,now,{historicalBaseline:true});
  assert.equal(r.ok,true,r.errors.join('\n'));
  assert.equal(r.inventory_complete,false,
    'Frozen history cannot certify a newly modified code tree even with all 50 slugs');
  assert.equal(r.hosted_acceptance,false);
  assert.equal(r.missing.length,0);
});
test('legacy probe, unknown function, and inactive canonical function block complete inventory',()=>{
  const s=clone();s.observed_at_utc='2026-11-09T22:59:30Z';
  s.hosted_functions=source.slugs.map((slug,i)=>({slug,status:'ACTIVE',version:i+1,verify_jwt:true}));
  for(const change of [
    x=>x.hosted_functions.push({slug:LEGACY_PROBE,status:'ACTIVE',version:5,verify_jwt:true}),
    x=>x.hosted_functions.push({slug:'unknown-legacy',status:'ACTIVE',version:1,verify_jwt:true}),
    x=>x.hosted_functions[0].status='INACTIVE',
  ]){const x=structuredClone(s);change(x);assert.equal(evaluateTestEdgeInventory(x,source,now).inventory_complete,false);}
});
test('source matcher never accepts a different source tree',()=>{
  const s=clone();assert.equal(evaluateTestEdgeInventory(s,{slugs:source.slugs,treeSha:'f'.repeat(40)},now).ok,false);
});

test('strict current code inventory fails on immutable historic source pin',()=>{
  const s=clone();s.observed_at_utc='2026-11-09T22:59:30Z';
  s.hosted_functions=source.slugs.map((slug,i)=>({slug,status:'ACTIVE',version:i+1,verify_jwt:true}));
  const mismatch=evaluateTestEdgeInventory(s,source,now);
  assert.equal(mismatch.ok,false,'Current-source acceptance must reject historical snapshot');
  assert.equal(mismatch.inventory_complete,false);
  assert.match(mismatch.errors.join(' '),/tree SHA/);
});

test('strict code inventory only accepts explicitly reviewed matching current source, never historic Test',()=>{
  const s=clone();s.observed_at_utc='2026-11-09T22:59:30Z';
  s.source_tree_sha=source.treeSha; // Synthetic future approved provenance, not a real hosted observation.
  s.hosted_functions=source.slugs.map((slug,i)=>({slug,status:'ACTIVE',version:i+1,verify_jwt:true}));
  const observed=evaluateTestEdgeInventory(s,source,now);
  assert.equal(observed.ok,true,observed.errors.join(' '));
  assert.equal(observed.inventory_complete,true);
  assert.equal(observed.hosted_acceptance,false);
  assert.equal(observed.historical_baseline_only,false);
});
