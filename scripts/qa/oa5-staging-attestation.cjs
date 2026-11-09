'use strict';
// Single source-controlled staging attestation gate for Mobile QA,
// Merchant/Admin previews and release isolation checks.
// Metadata checks never replace hosted restore proof or human approval.
const PROD_REF = 'eujxswjspolugrzlsjnn';
const AGREEMENT_REF = 'iukgsukdoowvnhlfmpml';
const REQUIRED = [
  'clean_migration_replay_verified',
  'historical_agreement_evidence_archived',
  'restore_path_verified',
  'vercel_preview_dependencies_reconciled',
  // Before allowing Test QA clients, independently verify that existing
  // Preview protection challenges signed-out viewers while Production
  // remains reachable, and that historic reviewer access is preserved.
  // This is a PRE-BINDING checkpoint, not post-binding hostname proof.
  'qa_preview_access_protection_preflight_verified',
  'test_only_auth_and_provider_config_verified',
  'qa_edge_functions_deployed_and_verified',
];
function attestationIsValid(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return false;
  return a.schema_version === 1 && a.state === 'verified'
    && typeof a.approved_staging_project_ref === 'string'
    && /^[a-z0-9]{20}$/.test(a.approved_staging_project_ref)
    && a.approved_staging_project_ref !== PROD_REF
    && /^[0-9a-f]{40}$/.test(a.reviewed_source_sha ?? '')
    && typeof a.approved_at === 'string'
    && /^[0-3][0-9][/][01][0-9][/]20[0-9]{2}$/.test(a.approved_at)
    && REQUIRED.every(key => a[key] === true);
}
function stagingBackendApproved(a, endpoint) {
  if (!attestationIsValid(a) || typeof endpoint !== 'string') return false;
  const match = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/.exec(endpoint);
  return match?.[1] === a.approved_staging_project_ref;
}
function reusedTestProjectApproved(a, endpoint) {
  return endpoint === 'https://' + AGREEMENT_REF + '.supabase.co'
    && stagingBackendApproved(a, endpoint);
}
module.exports = { attestationIsValid, stagingBackendApproved, reusedTestProjectApproved };
