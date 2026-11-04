#!/usr/bin/env node
/**
 * Pre-C2 staging acceptance boundary.
 *
 * Read-only. Does not create a project, migrate a database, write secrets,
 * change app configuration, deploy code or contact a production API.
 *
 * Usage:
 *  SELLERTRAY_OA5_STAGING_SUPABASE_URL=... \
 *  SELLERTRAY_OA5_STAGING_PUBLISHABLE_KEY=... \
 *    node scripts/qa/oa5-staging-isolation.mjs
 *
 * The target-only option checks a proposed isolated target without claiming
 * the built QA APK uses it. Only the default mode can assert source binding.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { reusedTestProjectApproved } = require('./oa5-staging-attestation.cjs');
const attestationUrl = new URL('../../docs/qa/oa5-staging-backend-attestation.json', import.meta.url);


const configUrl = new URL('../../apps/mobile/eas.json', import.meta.url);

function canonicalSupabaseUrl(value) {
  if (typeof value !== 'string' || value.trim() !== value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
        || url.pathname !== '/' || url.search || url.hash) return null;
    if (!/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function plausiblePublishableKey(value) {
  return typeof value === 'string' && /^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(value);
}

export function verifyStagingIsolation({
  productionUrl, productionKey, qaUrl, qaKey, stagingUrl, stagingKey,
  productionAndroidPackage, qaAndroidPackage, qaAndroidName,
  targetOnly = false, stagingAttestation = null,
}) {
  const errors = [];
  const production = canonicalSupabaseUrl(productionUrl);
  const staging = canonicalSupabaseUrl(stagingUrl);
  const qa = canonicalSupabaseUrl(qaUrl);
  if (!production) errors.push('Production project URL could not be classified safely');
  if (!staging) errors.push('Provide a valid, independent HTTPS staging Supabase project URL');
  if (production && staging && staging === production)
    errors.push('Production Supabase is forbidden for OA5 installation acceptance');
  // The existing standalone Agreement Test project is reusable, but ONLY after
  // archival, clean rebuild and explicit source-controlled hosted attestation.
  // It is not a staging branch of Production and is currently blocked.
  if (staging === 'https://iukgsukdoowvnhlfmpml.supabase.co'
      && !reusedTestProjectApproved(stagingAttestation, staging))
    errors.push('Agreement Test project reuse requires full approved staging attestation');
  if (!plausiblePublishableKey(stagingKey))
    errors.push('Provide a valid staging publishable key through protected CI secrets');
  if (typeof productionKey === 'string' && productionKey === stagingKey)
    errors.push('Staging must not reuse the production publishable key');
  if (!targetOnly) {
    if (!qa || qa !== staging)
      errors.push('The QA APK configuration is not bound to the isolated staging Supabase URL');
    if (qaKey !== stagingKey)
      errors.push('The QA APK configuration does not use the staging project publishable key');
    if (production && qa === production)
      errors.push('QA app configuration still targets production; do not install for OA5 lifecycle testing');
    if (productionAndroidPackage !== 'ng.processedge.sellertray'
        || qaAndroidPackage !== 'ng.processedge.sellertray.qa'
        || qaAndroidPackage === productionAndroidPackage
        || qaAndroidName !== 'SellerTray QA')
      errors.push('QA Android must have its own SellerTray QA identity and package; production app replacement is forbidden');
  }
  return { ok: errors.length === 0, errors, production, staging, qa, targetOnly };
}

export function loadAppSettings() {
  const config = JSON.parse(readFileSync(fileURLToPath(configUrl), 'utf8'));
  const baseApp = JSON.parse(readFileSync(fileURLToPath(
    new URL('../../apps/mobile/app.json', import.meta.url)), 'utf8')).expo;
  const profiles = config.build ?? {};
  const stagingVariant = process.env.SELLERTRAY_APP_VARIANT === 'qa-staging';
  // Legacy "qa" profile still points at production; it is never staging.
  let qaAndroidPackage = baseApp.android?.package;
  let qaAndroidName = baseApp.name;
  if (stagingVariant && profiles['qa-staging']?.env?.SELLERTRAY_APP_VARIANT === 'qa-staging') {
    try {
      const resolved = require('../../apps/mobile/app.config.js')({ config: baseApp });
      qaAndroidPackage = resolved.android?.package;
      qaAndroidName = resolved.name;
    } catch {
      // Missing/invalid protected QA Firebase/backend config must fail closed.
      qaAndroidPackage = null;
      qaAndroidName = null;
    }
  }
  return {
    productionUrl: profiles.production?.env?.EXPO_PUBLIC_SUPABASE_URL,
    productionKey: profiles.production?.env?.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    qaUrl: stagingVariant ? process.env.EXPO_PUBLIC_SUPABASE_URL : profiles.qa?.env?.EXPO_PUBLIC_SUPABASE_URL,
    qaKey: stagingVariant ? process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY : profiles.qa?.env?.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    productionAndroidPackage: baseApp.android?.package,
    qaAndroidPackage,
    qaAndroidName,
  };
}

function loadStagingBackendAttestation() {
  try {
    return JSON.parse(readFileSync(fileURLToPath(attestationUrl), 'utf8'));
  } catch {
    return null; // Missing or malformed evidence blocks reuse.
  }
}

function main() {
  const result = verifyStagingIsolation({
    ...loadAppSettings(),
    stagingUrl: process.env.SELLERTRAY_OA5_STAGING_SUPABASE_URL ?? '',
    stagingKey: process.env.SELLERTRAY_OA5_STAGING_PUBLISHABLE_KEY ?? '',
    stagingAttestation: loadStagingBackendAttestation(),
    targetOnly: process.argv.includes('--target-only'),
  });
  if (!result.ok) {
    console.error('SellerTray OA5 staging acceptance is BLOCKED:');
    for (const message of result.errors) console.error(' - ' + message);
    console.error('No production or staging API request was made.');
    process.exitCode = 1;
    return;
  }
  console.log(result.targetOnly
    ? 'Isolated staging target accepted for provisioning. APK binding remains unverified.'
    : 'QA source is configured for an isolated Supabase target. Rebuild and verify the exact APK SHA before hardware acceptance.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL('file://' + process.argv[1]))) {
  main();
}
