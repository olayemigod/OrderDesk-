#!/usr/bin/env node
/**
 * OA5 standalone Test-only Auth decommission sequencing prerequisite.
 * A passing census confirms ONLY that external FK/trigger dependencies are absent.
 * This script NEVER revokes sessions, deletes users, edits SQL or authorizes cleanup.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEST_REF = 'iukgsukdoowvnhlfmpml';
export const PURPOSE = 'pre-auth-decommission-dependency-only';
export const COUNT_KEYS = Object.freeze([
  'external_auth_user_fks',
  'external_restrict_fks',
  'external_cascade_fks',
  'external_set_null_fks',
  'external_other_fks',
  'auth_users_custom_triggers'
]);
const FRESH_MS = 10 * 60 * 1000;
const exact = (value, keys) => value !== null &&
  typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join('|') === [...keys].sort().join('|');

export function assessTestAuthDecommissionBoundary(snapshot, now = new Date()) {
  const reasons = [];
  const result = () => ({
    dependencies_clear: reasons.length === 0,
    auth_user_deletion_authorized: false,
    destructive_execution_authorized: false,
    reasons
  });
  if (!exact(snapshot, ['schema_version','project_ref','purpose','captured_at_utc','counts'])) {
    reasons.push('Missing or overbroad Test Auth dependency snapshot');
    return result();
  }
  if (snapshot.schema_version !== 1 || snapshot.project_ref !== TEST_REF ||
      snapshot.purpose !== PURPOSE) {
    reasons.push('Incorrect project, purpose or snapshot schema');
  }
  const ts = typeof snapshot.captured_at_utc === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(snapshot.captured_at_utc)
    ? Date.parse(snapshot.captured_at_utc) : NaN;
  if (!Number.isFinite(ts) || ts > now.getTime() || now.getTime() - ts > FRESH_MS) {
    reasons.push('Auth dependency snapshot missing, future-dated or older than ten minutes');
  }
  if (!exact(snapshot.counts, COUNT_KEYS)) {
    reasons.push('Auth dependency snapshot counts incomplete or contain unapproved fields');
    return result();
  }
  for (const key of COUNT_KEYS) {
    const number = snapshot.counts[key];
    if (!Number.isSafeInteger(number) || number < 0) {
      reasons.push('Invalid count for ' + key);
    } else if (number > 0) {
      reasons.push('Historical Auth user deletion dependency still exists: ' + key);
    }
  }
  const c = snapshot.counts;
  if (COUNT_KEYS.every(key => Number.isSafeInteger(c[key]) && c[key] >= 0) &&
      c.external_auth_user_fks !== c.external_restrict_fks +
      c.external_cascade_fks + c.external_set_null_fks + c.external_other_fks) {
    reasons.push('Inconsistent Auth user foreign-key classification');
  }
  return result();
}

function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--check') {
    console.error('Usage: node scripts/qa/oa5-test-auth-decommission-boundary.mjs --check <private-Test-auth-fk-census.json>');
    process.exitCode = 2;
    return;
  }
  let snapshot;
  try { snapshot = JSON.parse(readFileSync(resolve(process.argv[3]), 'utf8')); }
  catch {
    console.error('BLOCKED: missing or unreadable private Test Auth dependency snapshot');
    process.exitCode = 1; return;
  }
  const evaluated = assessTestAuthDecommissionBoundary(snapshot);
  if (!evaluated.dependencies_clear) {
    console.error('BLOCKED: legacy App-to-Auth references or evidence defects prevent Auth cleanup');
    for (const reason of evaluated.reasons) console.error(' - ' + reason);
    process.exitCode = 1; return;
  }
  console.log('PASS: externally referencing FKs and Auth user custom triggers are absent in this fresh Test snapshot.');
  console.log('NOT AUTHORIZED: do not delete Auth users, revoke sessions, reset SQL, alter providers or change Production.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
