#!/usr/bin/env node
/**
 * OA5 Test-only pre-reset managed-state census.
 * Offline count/shape check ONLY; no hosted connection or cleanup permission.
 * Dated baseline is a point-in-time review, NOT an archive of managed records.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEST_REF = 'iukgsukdoowvnhlfmpml';
export const BASELINE_20261109 = Object.freeze({
  auth_users: 5,
  auth_sessions: 6,
  auth_identities: 1,
  auth_refresh_tokens: 21,
  auth_mfa_factors: 1,
  auth_mfa_challenges: 8,
  storage_buckets: 3,
  storage_public_buckets: 1,
  storage_private_buckets: 2,
  storage_objects: 0,
  storage_policies: 3,
  storage_multipart_uploads: 0,
  storage_multipart_parts: 0,
  public_auth_user_foreign_keys: 64,
  public_auth_user_restrict_foreign_keys: 30,
  public_auth_user_cascade_foreign_keys: 8,
  public_auth_user_set_null_foreign_keys: 26
});
const FRESH_MS = 10 * 60 * 1000;
const exactKeys = (obj, names) =>
  obj !== null && typeof obj === 'object' && !Array.isArray(obj) &&
  Object.keys(obj).sort().join('|') === [...names].sort().join('|');

export function assessTestManagedBoundary(snapshot, now = new Date()) {
  const reasons = [];
  const denied = () => ({
    ok: reasons.length === 0,
    managed_cleanup_authorized: false,
    destructive_execution_authorized: false,
    reasons
  });
  if (!exactKeys(snapshot, ['schema_version', 'project_ref', 'captured_at_utc', 'counts'])) {
    reasons.push('Missing or overbroad private Test managed-service snapshot');
    return denied();
  }
  if (snapshot.schema_version !== 1 || snapshot.project_ref !== TEST_REF)
    reasons.push('Wrong project ref or managed-state schema version');
  const ts = typeof snapshot.captured_at_utc === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(snapshot.captured_at_utc)
    ? Date.parse(snapshot.captured_at_utc) : NaN;
  if (!Number.isFinite(ts) || ts > now.getTime() || now.getTime() - ts > FRESH_MS)
    reasons.push('Managed-service census absent, future-dated or over ten minutes old');
  if (!exactKeys(snapshot.counts, Object.keys(BASELINE_20261109))) {
    reasons.push('Unexpected, missing or secret-bearing managed-service count field');
    return denied();
  }
  for (const [name, baseline] of Object.entries(BASELINE_20261109)) {
    const count = snapshot.counts[name];
    if (!Number.isSafeInteger(count) || count < 0)
      reasons.push('Invalid managed-service count: ' + name);
    else if (count !== baseline)
      reasons.push('Managed-service baseline drift: ' + name);
  }
  if (snapshot.counts.storage_buckets !==
      snapshot.counts.storage_public_buckets + snapshot.counts.storage_private_buckets)
    reasons.push('Storage bucket classification mismatch');
  if (snapshot.counts.public_auth_user_foreign_keys !==
      snapshot.counts.public_auth_user_restrict_foreign_keys +
      snapshot.counts.public_auth_user_cascade_foreign_keys +
      snapshot.counts.public_auth_user_set_null_foreign_keys)
    reasons.push('Unclassified public Auth user dependency');
  return denied();
}

function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--check') {
    console.error('Usage: node scripts/qa/oa5-test-managed-boundary.mjs --check <private-readonly-managed-counts.json>');
    process.exitCode = 2;
    return;
  }
  let snapshot;
  try { snapshot = JSON.parse(readFileSync(resolve(process.argv[3]), 'utf8')); }
  catch { console.error('BLOCKED: missing private Test managed-service counts'); process.exitCode = 1; return; }
  const result = assessTestManagedBoundary(snapshot);
  if (!result.ok) {
    console.error('BLOCKED: Test managed-state census not independently reconcilable');
    for (const reason of result.reasons) console.error(' - ' + reason);
    process.exitCode = 1;
    return;
  }
  console.log('PASS: count-only Test managed-service census matches dated baseline.');
  console.log('NOT AUTHORIZED: no Auth deletion, Storage operation, cron pause, SQL reset, Edge deployment or provider action.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
