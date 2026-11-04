#!/usr/bin/env node
/**
 * Offline-only QA merchant fixture plan validator.
 *
 * Validates synthetic, non-production test scenarios. It deliberately has
 * no Supabase client, HTTP requests, seed commands, or write operations.
 * A passing check DOES NOT provision a merchant or attest a staging backend.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixturePath = new URL('../../docs/qa/oa5-test-merchant-fixtures.json', import.meta.url);
const exactKeys = (value, allowed, path, errors) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(path + ' must be an object');
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(path + ' contains forbidden/unknown field: ' + key);
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) errors.push(path + ' is missing ' + key);
  }
  return true;
};
const uniqueStrings = (value, path, errors, pattern) => {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(path + ' must be a nonempty list');
    return [];
  }
  const used = new Set();
  for (const item of value) {
    if (typeof item !== 'string' || !pattern.test(item)) {
      errors.push(path + ' contains a malformed item');
    } else if (used.has(item)) {
      errors.push(path + ' contains a duplicate item');
    }
    used.add(item);
  }
  return value;
};
const mandatoryScenarios = [
  'qa_registration_and_master_agreement',
  'qa_sandbox_payment_confirmation',
  'qa_setup_appointment',
  'qa_preactivation_register',
  'qa_58mm_80mm_printer_test',
  'qa_installer_handover',
  'qa_activation_reconciliation',
  'qa_optional_customer_phone',
  'qa_pos_sale_and_payment',
  'qa_branch_and_capability_isolation',
  'qa_uom_and_stock_ledger',
  'qa_partial_pay_later_receivables',
  'qa_receipt_reprint_idempotency',
  'qa_whatsapp_test_sink',
  'qa_offline_replay_integrity',
  'qa_inactive_branch_sale_denial',
  'qa_purchased_branch_device_setup',
  'qa_installer_aal1_denial',
  'qa_installer_assignment_expiry_revocation',
  'qa_cross_tenant_and_branch_denial',
];
const requiredSafety = [
  'isolated_backend_attested',
  'qa_apk_endpoint_sha_verified',
  'payment_sandbox_only',
  'whatsapp_and_email_inert_sinks',
  'no_live_customer_data',
  'no_production_fallback',
  'no_real_merchant_app_rebinding',
];
const merchantKeys = ['code', 'name', 'branches', 'merchant_roles', 'oa5_scenarios'];
const branchKeys = ['code', 'name', 'scenario_state'];
const rootKeys = [
  'schema_version', 'environment', 'state',
  'can_mutate_database', 'can_copy_production_records',
  'merchants', 'internal_roles', 'required_safety_checks', 'deferred_c2_scenarios',
];
const namePattern = /^SellerTray QA - [A-Za-z0-9 ]+$/;
const codePattern = /^QA_[A-Z0-9_]+$/;
const scenarioPattern = /^qa_[a-z0-9_]+$/;
const statusStates = new Set(['purchased_not_ready', 'active_after_governed_activation']);

export function validateTestMerchantFixturePlan(plan) {
  const errors = [];
  if (!exactKeys(plan, rootKeys, 'plan', errors)) {
    return { ok: false, errors, merchantCount: 0, branchCount: 0 };
  }
  if (plan.schema_version !== 1) errors.push('Unsupported fixture plan version');
  if (plan.environment !== 'test-staging' || plan.state !== 'planned-not-provisioned')
    errors.push('Fixture plan must be for unprovisioned Test/Staging only');
  if (plan.can_mutate_database !== false || plan.can_copy_production_records !== false)
    errors.push('Fixture plan must prohibit database mutations and production-record copying');
  const merchants = plan.merchants;
  if (!Array.isArray(merchants) || merchants.length !== 3) {
    errors.push('Exactly three independent synthetic merchant cases are required');
  }
  const codes = new Set();
  const names = new Set();
  const allScenarios = new Set();
  const allRoles = new Set();
  let branches = 0;
  for (const [index, merchant] of (Array.isArray(merchants) ? merchants : []).entries()) {
    const path = 'merchants[' + index + ']';
    if (!exactKeys(merchant, merchantKeys, path, errors)) continue;
    if (typeof merchant.code !== 'string' || !codePattern.test(merchant.code) || codes.has(merchant.code))
      errors.push(path + ' requires a unique QA_ merchant code');
    codes.add(merchant.code);
    if (typeof merchant.name !== 'string' || !namePattern.test(merchant.name) || names.has(merchant.name))
      errors.push(path + ' requires a unique synthetic SellerTray QA name');
    names.add(merchant.name);
    const localBranches = new Set();
    if (!Array.isArray(merchant.branches) || merchant.branches.length === 0 || merchant.branches.length > 2) {
      errors.push(path + ' requires one or two test branches');
    }
    for (const [i, branch] of (Array.isArray(merchant.branches) ? merchant.branches : []).entries()) {
      const branchPath = path + '.branches[' + i + ']';
      if (!exactKeys(branch, branchKeys, branchPath, errors)) continue;
      branches += 1;
      if (typeof branch.code !== 'string' || !codePattern.test(branch.code) || localBranches.has(branch.code))
        errors.push(branchPath + ' requires a unique QA_ branch code within its merchant');
      localBranches.add(branch.code);
      if (typeof branch.name !== 'string' || !/^QA [A-Za-z0-9 ]+$/.test(branch.name))
        errors.push(branchPath + ' requires a synthetic QA branch name');
      if (!statusStates.has(branch.scenario_state))
        errors.push(branchPath + ' has an unsupported hypothetical branch status');
    }
    for (const role of uniqueStrings(merchant.merchant_roles, path + '.merchant_roles', errors, /^(owner|manager|cashier)$/)) {
      allRoles.add(role);
    }
    if (!merchant.merchant_roles?.includes('owner')) errors.push(path + ' requires an Owner');
    for (const scenario of uniqueStrings(merchant.oa5_scenarios, path + '.oa5_scenarios', errors, scenarioPattern)) {
      allScenarios.add(scenario);
    }
  }
  for (const code of ['QA_FIRST_PURCHASE','QA_OPERATIONS','QA_UNREADY']) {
    if (!codes.has(code)) errors.push('Missing required QA merchant scenario: ' + code);
  }
  for (const role of ['owner','manager','cashier']) {
    if (!allRoles.has(role)) errors.push('Merchant role coverage missing: ' + role);
  }
  for (const scenario of mandatoryScenarios) {
    if (!allScenarios.has(scenario)) errors.push('Missing OA5 scenario coverage: ' + scenario);
  }
  const internalRoles = uniqueStrings(plan.internal_roles, 'internal_roles', errors, /^(platform_admin|platform_support|setup_installer)$/);
  for (const role of ['platform_admin','platform_support','setup_installer']) {
    if (!internalRoles.includes(role)) errors.push('Internal identity coverage missing: ' + role);
  }
  const safety = uniqueStrings(plan.required_safety_checks, 'required_safety_checks', errors, /^[a-z][a-z0-9_]+$/);
  for (const item of requiredSafety) if (!safety.includes(item)) errors.push('Missing isolation precondition: ' + item);
  const future = uniqueStrings(plan.deferred_c2_scenarios, 'deferred_c2_scenarios', errors, /^qa_[a-z0-9_]+$/);
  if (!future.every(item => item.startsWith('qa_')) || future.some(item => allScenarios.has(item)))
    errors.push('Future C2 scenarios must not run in the OA5 scenario set');
  if (!future.some(item => item.includes('branch_owned_subscription')))
    errors.push('Future C2 independent Branch subscription coverage missing');
  return { ok: errors.length === 0, errors, merchantCount: Array.isArray(merchants) ? merchants.length : 0, branchCount: branches };
}

export function loadTestMerchantFixturePlan() {
  return JSON.parse(readFileSync(fileURLToPath(fixturePath), 'utf8'));
}

function main() {
  if (process.argv.some((arg, i) => i > 1 && arg !== '--check')) {
    console.error('Unsupported action. This validator has no --seed, --apply or network mode.');
    process.exitCode = 2;
    return;
  }
  let result;
  try {
    result = validateTestMerchantFixturePlan(loadTestMerchantFixturePlan());
  } catch {
    console.error('Unable to parse the versioned QA merchant fixture plan.');
    process.exitCode = 1;
    return;
  }
  if (!result.ok) {
    console.error('SellerTray QA fixture plan is BLOCKED:');
    for (const error of result.errors) console.error(' - ' + error);
    process.exitCode = 1;
    return;
  }
  console.log('QA fixture plan valid: ' + result.merchantCount + ' synthetic merchants, '
    + result.branchCount + ' Branch scenarios.');
  console.log('Not provisioned: no Supabase contact, merchant creation, payments or writes.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL('file://' + process.argv[1]))) main();
