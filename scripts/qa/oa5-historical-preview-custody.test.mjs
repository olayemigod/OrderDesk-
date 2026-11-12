import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyHistoricalPreviewCustody} from './oa5-historical-preview-custody.mjs';

const base=JSON.parse(readFileSync(new URL('../../docs/qa/oa5-historical-vercel-preview-custody-2026-11-09.json',import.meta.url)));
const clone=()=>structuredClone(base);
test('records exactly five READY source-pinned deployments without hosted acceptance claims',()=>{
 const r=verifyHistoricalPreviewCustody(clone());
 assert.equal(r.ok,true,r.errors.join('\n'));
 assert.equal(r.evidence_scope,'metadata_only');
 assert.equal(r.hosted_acceptance,false);
});
test('rejects another Test/Production project and missing capture evidence',()=>{
 for(const changes of [
  s=>{s.project_ref='eujxswjspolugrzlsjnn';},
  s=>{s.project_ref='unknown';},s=>{s.captured_at_utc='not-a-date';},
  s=>{s.evidence_class='browser_verified';}
 ]){const s=clone();changes(s);assert.equal(verifyHistoricalPreviewCustody(s).ok,false);}
});
test('rejects missing, extra and duplicate historical deployments',()=>{
 for(const changes of [
  s=>s.deployments.pop(),
  s=>s.deployments.push({...s.deployments[0],id:'extra'}),
  s=>s.deployments[4].branch=s.deployments[3].branch
 ]){const s=clone();changes(s);assert.equal(verifyHistoricalPreviewCustody(s).ok,false);}
});
test('rejects wrong source, READY status, production aliases and wrong backend',()=>{
 for(const changes of [
  s=>s.deployments[0].sha='a'.repeat(40),
  s=>s.deployments[0].state='ERROR',
  s=>s.deployments[0].production_or_qa_custom_alias_count=1,
  s=>s.deployments[1].preview_backend_ref='eujxswjspolugrzlsjnn',
  s=>s.deployments[1].alias_count=0
 ]){const s=clone();changes(s);assert.equal(verifyHistoricalPreviewCustody(s).ok,false);}
});
test('rejects late/retargeted/missing scoped variables and any embedded values',()=>{
 for(const changes of [
  s=>s.deployments[0].scoped_vars[0].updated_at_ms=s.deployments[0].created_at_ms+1,
  s=>s.deployments[0].scoped_vars[0].created_at_ms=s.deployments[0].created_at_ms+1,
  s=>s.deployments[0].scoped_vars[1].kind='VITE_SUPABASE_URL',
  s=>s.deployments[0].scoped_vars.pop(),
  s=>s.deployments[0].scoped_vars[0].value='do-not-store',
  s=>s.deployments[0].scoped_vars[0].url='https://eujxswjspolugrzlsjnn.supabase.co'
 ]){const s=clone();changes(s);assert.equal(verifyHistoricalPreviewCustody(s).ok,false);}
});
test('rejects a false hosted/reviewer-access claim from metadata',()=>{
 for(const k of ['test_custom_domains_attached','unauthorized_browser_access_verified','authorized_reviewer_access_verified','compiled_bundle_backend_verified']){
  const s=clone();s[k]=true;assert.equal(verifyHistoricalPreviewCustody(s).ok,false);
 }
});
test('detects actual Vercel plan, production domain and protection drift',()=>{
 for(const changes of [
  s=>s.account_plan='pro',
  s=>s.live_projects[0].password_enabled=true,
  s=>s.live_projects[1].sso_scope='all',
  s=>s.live_projects[0].production_domain='test.sellertray.com',
  s=>s.live_projects.push({...s.live_projects[0]})
 ]){const s=clone();changes(s);assert.equal(verifyHistoricalPreviewCustody(s).ok,false);}
});
test('malformed root and job objects fail closed',()=>{
 for(const s of [null,[],{}, {...clone(),deployments:[null]}, {...clone(),live_projects:[undefined]}])
 assert.equal(verifyHistoricalPreviewCustody(s).ok,false);
});
