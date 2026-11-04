import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { verifyStagingIsolation } from './oa5-staging-isolation.mjs';

const productionUrl = 'https://' + 'p'.repeat(20) + '.supabase.co';
const stagingUrl = 'https://' + 's'.repeat(20) + '.supabase.co';
const productionKey = 'sb_publishable_' + 'p'.repeat(25);
const stagingKey = 'sb_publishable_' + 's'.repeat(25);
const valid = { productionUrl, productionKey, qaUrl: stagingUrl, qaKey: stagingKey, stagingUrl, stagingKey,
  productionAndroidPackage:'ng.processedge.sellertray', qaAndroidPackage:'ng.processedge.sellertray.qa', qaAndroidName:'SellerTray QA' };

test('accepts isolated and correctly bound synthetic staging configuration', () => {
  const r = verifyStagingIsolation(valid);
  assert.equal(r.ok, true);
  assert.equal(r.errors.length, 0);
});

test('fails closed on missing staging target and key', () => {
  assert.equal(verifyStagingIsolation({...valid, stagingUrl: '', stagingKey:''}).ok, false);
});

test('rejects a real-looking production URL even if the QA profile also uses it', () => {
  const r = verifyStagingIsolation({...valid, stagingUrl:productionUrl, qaUrl:productionUrl});
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /Production Supabase is forbidden/);
});

test('rejects unrebuilt Agreement Package Test project until independently attested', () => {
  const r = verifyStagingIsolation({
    ...valid, stagingUrl:'https://iukgsukdoowvnhlfmpml.supabase.co',
  });
  assert.equal(r.ok,false);
  assert.match(r.errors.join('\\n'), /requires full approved staging attestation/);
});

test('rejects staging reusing production publishable key', () => {
  assert.equal(verifyStagingIsolation({...valid, stagingKey:productionKey, qaKey:productionKey}).ok, false);
});

test('rejects localhost, Vercel aliases, http, URLs containing credentials and other project endpoints', () => {
  for (const stagingUrl of [
    'http://' + 's'.repeat(20) + '.supabase.co',
    'http://localhost:54321',
    'https://app.sellertray.com',
    'https://sellertray-staging.vercel.app',
    'https://user:pass@' + 's'.repeat(20) + '.supabase.co',
    'https://' + 's'.repeat(20) + '.supabase.co/auth/v1/user',
    'https://' + 's'.repeat(20) + '.supabase.co?x=y',
  ]) {
    assert.equal(verifyStagingIsolation({...valid, stagingUrl}).ok, false, stagingUrl);
  }
});

test('requires actual QA profile to use staging URL and key for final readiness', () => {
  assert.equal(verifyStagingIsolation({...valid, qaUrl:productionUrl, qaKey:productionKey}).ok, false);
  assert.equal(verifyStagingIsolation({...valid, qaKey:productionKey}).ok, false);
  assert.equal(verifyStagingIsolation({...valid, qaUrl:productionUrl}).ok, false);
});

test('target-only mode cannot claim the APK binding is verified', () => {
  assert.equal(verifyStagingIsolation({...valid, qaUrl:productionUrl,qaKey:productionKey,targetOnly:true}).ok,true);
});

test('does not leak protected keys when rejecting current production-bound QA profile', () => {
  const result=spawnSync(process.execPath,['scripts/qa/oa5-staging-isolation.mjs'], {
    cwd:new URL('../../',import.meta.url).pathname,
    env:{...process.env,SELLERTRAY_OA5_STAGING_SUPABASE_URL:stagingUrl,SELLERTRAY_OA5_STAGING_PUBLISHABLE_KEY:stagingKey},
    encoding:'utf8',
  });
  assert.equal(result.status,1);
  assert.match(result.stderr,/BLOCKED/);
  assert.doesNotMatch(result.stderr,/sb_publishable_/);
  assert.match(result.stderr,/QA app configuration still targets production/);
});

test('fails closed when QA APK would replace the installed production Android app', () => {
  const samePackage = verifyStagingIsolation({
    ...valid, qaAndroidPackage:'ng.processedge.sellertray',
  });
  assert.equal(samePackage.ok, false);
  assert.match(samePackage.errors.join('\\n'), /production app replacement is forbidden/);
});

test('fails closed when QA identity is not visibly different from the live app', () => {
  const productionName = verifyStagingIsolation({...valid, qaAndroidName:'SellerTray'});
  assert.equal(productionName.ok, false);
});

test('target-only does not pretend to verify native Android application identity', () => {
  const result = verifyStagingIsolation({
    ...valid, qaAndroidPackage:'ng.processedge.sellertray',
    qaAndroidName:'SellerTray', targetOnly:true
  });
  assert.equal(result.ok, true);
});

test('can reuse the same standalone Agreement Test project after documented staged acceptance', () => {
  const project = 'iukgsukdoowvnhlfmpml';
  const attestation = {
    schema_version:1,state:'verified',approved_staging_project_ref:project,
    reviewed_source_sha:'a'.repeat(40),approved_at:'04/11/2026',
    clean_migration_replay_verified:true,historical_agreement_evidence_archived:true,
    restore_path_verified:true,vercel_preview_dependencies_reconciled:true,
    test_only_auth_and_provider_config_verified:true,qa_edge_functions_deployed_and_verified:true,
  };
  const url = 'https://' + project + '.supabase.co';
  const approved = verifyStagingIsolation({
    ...valid, stagingUrl:url, qaUrl:url,
    stagingAttestation:attestation,
  });
  assert.equal(approved.ok,true,approved.errors.join(', '));
  assert.equal(verifyStagingIsolation({
    ...valid,stagingUrl:url,qaUrl:url,
    stagingAttestation:{...attestation,restore_path_verified:false},
  }).ok,false);
  assert.equal(verifyStagingIsolation({
    ...valid,stagingUrl:productionUrl,qaUrl:productionUrl,
    stagingAttestation:attestation,
  }).ok,false);
});
