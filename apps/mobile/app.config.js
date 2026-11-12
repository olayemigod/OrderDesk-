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
const QA_FIREBASE_PROJECT = 'sellertray-test';
const QA_FIREBASE_SENDER_ID = '362913608913';
const QA_FIREBASE_APP_ID = '1:362913608913:android:622042be355ff1a94b41f0';
const PRODUCTION_PACKAGE = 'ng.processedge.sellertray';
const PRODUCTION_URL = 'https://eujxswjspolugrzlsjnn.supabase.co';
const UNATTESTED_AGREEMENT_TEST_URL = 'https://iukgsukdoowvnhlfmpml.supabase.co';
const ATTESTATION_FILE = resolve(__dirname, '../../docs/qa/oa5-staging-backend-attestation.json');

// Shared with Merchant/Admin preview gate; fail closed until actual hosted
// recovery and permission evidence is recorded in the checked-in attestation.
// Lazy require means the production app identity needs no QA helper at boot.
function reusedTestProjectApproved(attestation, endpoint) {
  return require('../../scripts/qa/oa5-staging-attestation.cjs')
    .reusedTestProjectApproved(attestation, endpoint);
}
function hasApprovedTestBackend(endpoint, testEvidence) {
  try {
    // Production EAS/Expo only invokes this module with ({config}); the third
    // argument is exclusively for deterministic synthetic source-only tests.
    const evidence = testEvidence === undefined
      ? JSON.parse(readFileSync(ATTESTATION_FILE, 'utf8'))
      : testEvidence;
    return require('../../scripts/qa/oa5-staging-attestation.cjs')
      .stagingBackendApproved(evidence, endpoint);
  } catch {
    return false; // Missing, inaccessible or invalid evidence always blocks QA.
  }
}

function qaConfiguration({ config }, env = process.env, testEvidence = undefined) {
  const variant = env.SELLERTRAY_APP_VARIANT;
  if (!variant) return config; // Existing installed production app contract.
  if (variant !== 'qa-staging') throw new Error('Unsupported SellerTray build variant');
  if (config?.android?.package !== PRODUCTION_PACKAGE)
    throw new Error('QA variant base app identity does not match governed production configuration');

  const endpoint = env.EXPO_PUBLIC_SUPABASE_URL;
  const publishableKey = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (typeof endpoint !== 'string' || !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(endpoint)
      || endpoint === PRODUCTION_URL
      || !hasApprovedTestBackend(endpoint, testEvidence))
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
  if (firebase.project_info?.project_id !== QA_FIREBASE_PROJECT
      || String(firebase.project_info?.project_number ?? '') !== QA_FIREBASE_SENDER_ID)
    throw new Error('QA Android Firebase project identity does not match the registered Test project');
  const qaClients = Array.isArray(firebase.client) ? firebase.client.filter(
    (client) => client?.client_info?.android_client_info?.package_name === QA_PACKAGE
  ) : [];
  if (qaClients.length !== 1)
    throw new Error('QA Android Firebase package identity does not match the QA application ID');
  if (qaClients[0]?.client_info?.mobilesdk_app_id !== QA_FIREBASE_APP_ID)
    throw new Error('QA Android Firebase App ID does not match the registered Test application');
  return {
    ...config,
    name: 'SellerTray QA',
    // The QA Android app has its own package but shares the existing EAS project.
    slug: config.slug,
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
