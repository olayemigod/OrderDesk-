#!/usr/bin/env node
/**
 * SellerTray Merchant/Admin Vercel build-time protection.
 *
 * This checker never connects to Supabase, creates Vercel deployments or
 * reads secrets beyond validating the shape of client publishable keys.
 * It runs as npm's prebuild hook in both web apps.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PRODUCTION_REF = 'eujxswjspolugrzlsjnn';
const AGREEMENT_TEST_REF = 'iukgsukdoowvnhlfmpml';
const PREFIXES = Object.freeze({
  merchant: 'qa-preview/merchant-',
  admin: 'qa-preview/admin-',
});

const attestationPath = new URL('../../docs/qa/oa5-staging-backend-attestation.json', import.meta.url);

const refForUrl = (raw) => {
  if (typeof raw !== 'string' || raw.trim() !== raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || u.port
        || u.pathname !== '/' || u.search || u.hash) return null;
    const m = u.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/);
    return m?.[1] ?? null;
  } catch { return null; }
};

export function attestationIsValid(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return false;
  const required = [
    'clean_migration_replay_verified',
    'historical_agreement_evidence_archived',
    'restore_path_verified',
    'vercel_preview_dependencies_reconciled',
    'test_only_auth_and_provider_config_verified',
    'qa_edge_functions_deployed_and_verified',
  ];
  return a.schema_version === 1 && a.state === 'verified'
    && typeof a.approved_staging_project_ref === 'string'
    && /^[a-z0-9]{20}$/.test(a.approved_staging_project_ref)
    && ![PRODUCTION_REF].includes(a.approved_staging_project_ref)
    && /^[0-9a-f]{40}$/.test(a.reviewed_source_sha ?? '')
    && typeof a.approved_at === 'string' && /^\d{2}\/\d{2}\/20\d{2}$/.test(a.approved_at)
    && required.every(key => a[key] === true);
}

export function verifyFrontendBuildEnvironment({ surface, env, attestation }) {
  const errors = [];
  const prefix = PREFIXES[surface];
  if (!prefix) return { ok: false, errors: ['Unknown SellerTray frontend surface'] };
  const vercelFlag = env?.VERCEL;
  const mode = env?.VERCEL_ENV;
  // Local CI/package builds are intentionally allowed to use checked-in
  // source tests without any Vercel credentials or remote provider calls.
  if (!mode && vercelFlag !== '1' && vercelFlag !== 'true') {
    return { ok: true, errors, mode: 'local' };
  }
  if (mode !== 'preview' && mode !== 'production') {
    errors.push('Unknown/absent Vercel environment; refusing to build');
    return { ok: false, errors, mode };
  }
  const backendRef = refForUrl(env?.VITE_SUPABASE_URL);
  const key = env?.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (typeof key !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(key))
    errors.push('Missing/invalid client publishable key');
  if (mode === 'production') {
    if (backendRef !== PRODUCTION_REF)
      errors.push('Production web build must use the known live Supabase project');
  } else {
    const branch = env?.VERCEL_GIT_COMMIT_REF;
    if (typeof branch !== 'string' || !branch.startsWith(prefix)
        || !/^[a-z0-9][a-z0-9-]*$/.test(branch.slice(prefix.length)))
      errors.push('Preview source branch must be the explicit QA acceptance branch for this surface');
    if (!backendRef || backendRef === PRODUCTION_REF)
      errors.push('Preview must never use Production Supabase');
    if (backendRef === AGREEMENT_TEST_REF && !attestationIsValid(attestation))
      errors.push('Existing Agreement Test project has not passed hosted staging attestation');
    if (!attestationIsValid(attestation))
      errors.push('Test backend is not fully verified or approved for frontend acceptance');
    if (backendRef && attestationIsValid(attestation)
        && backendRef !== attestation.approved_staging_project_ref)
      errors.push('Preview backend does not match approved staging project ref');
  }
  return { ok: errors.length === 0, errors, mode, backendRef };
}

export function loadStagingAttestation() {
  return JSON.parse(readFileSync(fileURLToPath(attestationPath), 'utf8'));
}

function main() {
  const surface = process.argv[2];
  if (!PREFIXES[surface] || process.argv.length !== 3) {
    console.error('Usage: node scripts/qa/vercel-frontend-environment.mjs <merchant|admin>');
    process.exitCode = 2;
    return;
  }
  let manifest;
  try { manifest = loadStagingAttestation(); }
  catch { console.error('Staging attestation is unavailable; web build blocked'); process.exitCode = 1; return; }
  const result = verifyFrontendBuildEnvironment({surface,env:process.env,attestation:manifest});
  if (!result.ok) {
    console.error('SellerTray frontend build BLOCKED:');
    for (const message of result.errors) console.error(' - ' + message);
    console.error('No backend request, deployment, payment or notification was made.');
    process.exitCode = 1;
    return;
  }
  console.log(result.mode === 'local'
    ? 'SellerTray local/source build: no Vercel environment binding claimed.'
    : result.mode === 'production'
      ? 'SellerTray production backend binding verified for build (deployment approval separate).'
      : 'SellerTray QA preview backend and branch binding verified for build (browser QA separate).');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL('file://' + process.argv[1]))) main();
