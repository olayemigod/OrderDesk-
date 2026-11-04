/**
 * SellerTray production is the app.json default, unchanged unless an explicit
 * isolated QA build variant is selected. The QA variant is intentionally
 * fail-closed until protected backend and Firebase configuration are ready.
 * No production merchant may be directed to this QA APK.
 */
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const easConfig = require('./eas.json');

const QA_PACKAGE = 'ng.processedge.sellertray.qa';
const PRODUCTION_PACKAGE = 'ng.processedge.sellertray';
const PRODUCTION_URL = 'https://eujxswjspolugrzlsjnn.supabase.co';
const UNATTESTED_AGREEMENT_TEST_URL = 'https://iukgsukdoowvnhlfmpml.supabase.co';
const ATTESTATION_FILE = resolve(__dirname, '../../docs/qa/oa5-staging-backend-attestation.json');

// This approved source-controlled attestation can be updated only after an
// independent hosted recovery/migration/security review. An environment
// variable cannot bypass a missing or blocked attestation.
function reusedTestProjectApproved(attestation, endpoint) {
  if (endpoint !== UNATTESTED_AGREEMENT_TEST_URL) return false;
  if (!attestation || attestation.schema_version !== 1 ||
      attestation.state !== 'approved' ||
      attestation.approved_staging_project_ref !== 'iukgsukdoowvnhlfmpml' ||
      !/^[0-9a-f]{40}$/.test(attestation.reviewed_source_sha || '') ||
      typeof attestation.approved_at !== 'string' ||
      !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/.test(attestation.approved_at) ||
      !Number.isFinite(Date.parse(attestation.approved_at))) return false;
  return [
    'clean_migration_replay_verified',
    'historical_agreement_evidence_archived',
    'restore_path_verified',
    'vercel_preview_dependencies_reconciled',
    'test_only_auth_and_provider_config_verified',
    'qa_edge_functions_deployed_and_verified',
  ].every(key => attestation[key] === true);
}
function hasApprovedTestBackend(endpoint) {
  try {
    return reusedTestProjectApproved(
      JSON.parse(readFileSync(ATTESTATION_FILE, 'utf8')), endpoint
    );
  } catch {
    return false; // Missing, inaccessible or invalid evidence always blocks QA.
  }
}

function qaConfiguration({ config }, env = process.env) {
  const variant = env.SELLERTRAY_APP_VARIANT;
  if (!variant) return config; // Existing installed production app contract.
  if (variant !== 'qa-staging') throw new Error('Unsupported SellerTray build variant');
  if (config?.android?.package !== PRODUCTION_PACKAGE)
    throw new Error('QA variant base app identity does not match governed production configuration');

  const endpoint = env.EXPO_PUBLIC_SUPABASE_URL;
  const publishableKey = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (typeof endpoint !== 'string' || !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(endpoint)
      || endpoint === PRODUCTION_URL
      || (endpoint === UNATTESTED_AGREEMENT_TEST_URL && !hasApprovedTestBackend(endpoint)))
    throw new Error('QA Android build is blocked until an attested, non-production Supabase backend is selected');
  if (typeof publishableKey !== 'string'
      || !/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(publishableKey)
      || publishableKey === easConfig.build?.production?.env?.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    throw new Error('QA Android build requires a separate staging publishable key');

  const firebaseFile = env.SELLERTRAY_QA_GOOGLE_SERVICES_FILE;
  if (typeof firebaseFile !== 'string' || !firebaseFile.trim()
      || firebaseFile === config.android.googleServicesFile)
    throw new Error('QA Android build requires a separate protected Firebase file');
  let firebase;
  try {
    firebase = JSON.parse(readFileSync(resolve(firebaseFile), 'utf8'));
  } catch {
    throw new Error('QA Android Firebase file is missing or invalid');
  }
  const matchesQaPackage = Array.isArray(firebase.client) && firebase.client.some(
    (client) => client?.client_info?.android_client_info?.package_name === QA_PACKAGE
  );
  if (!matchesQaPackage)
    throw new Error('QA Android Firebase package identity does not match the QA application ID');
  return {
    ...config,
    name: 'SellerTray QA',
    slug: 'sellertray-qa',
    scheme: ['sellertray-qa'],
    android: {
      ...config.android,
      package: QA_PACKAGE,
      intentFilters: [], // Never claim production https://app.sellertray.com links.
      googleServicesFile: firebaseFile,
    },
    ios: { ...config.ios, bundleIdentifier: QA_PACKAGE },
  };
}
module.exports = qaConfiguration;
module.exports.reusedTestProjectApproved = reusedTestProjectApproved;
