import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadTestMerchantFixturePlan, validateTestMerchantFixturePlan } from './oa5-test-merchant-fixtures.mjs';

const original = loadTestMerchantFixturePlan();
const check = (modify) => {
  const plan = structuredClone(original);
  modify(plan);
  return validateTestMerchantFixturePlan(plan);
};

test('three synthetic merchants and five independent Branch scenarios form the baseline', () => {
  const result = validateTestMerchantFixturePlan(original);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.merchantCount, 3);
  assert.equal(result.branchCount, 5);
});

test('fixture plan is never authorized to run against a real or writable environment', () => {
  const result = check(p => { p.environment = 'production'; p.can_mutate_database = true; });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /Test\/Staging|prohibit database mutations/);
});

test('rejects copy of production records and a live merchant name', () => {
  const result = check(p => {
    p.can_copy_production_records = true;
    p.merchants[0].name = 'Tandar Oil Solutions';
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /production-record copying/);
  assert.match(result.errors.join('\n'), /synthetic SellerTray QA name/);
});

test('rejects credentials, contacts, URLs and database identifiers inserted into the plan', () => {
  for (const [path, value] of [
    ['email', 'real@example.com'],
    ['password', 'never-commit-a-password'],
    ['url', 'https://eujxswjspolugrzlsjnn.supabase.co'],
    ['auth_user_id', '00000000-0000-0000-0000-000000000001'],
  ]) {
    const result = check(p => { p.merchants[0][path] = value; });
    assert.equal(result.ok, false, path);
    assert.match(result.errors.join('\n'), /forbidden\/unknown field/);
  }
});

test('rejects duplicate merchants and non-synthetic Branch identifiers', () => {
  const result = check(p => {
    p.merchants[1].code = p.merchants[0].code;
    p.merchants[2].branches[0].name = 'Real Customer Branch';
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /unique QA_/);
  assert.match(result.errors.join('\n'), /synthetic QA branch name/);
});

test('rejects internal platform/installer roles as merchant Team members', () => {
  for (const internalRole of ['setup_installer', 'platform_admin', 'platform_support']) {
    const result = check(p => { p.merchants[0].merchant_roles.push(internalRole); });
    assert.equal(result.ok, false, internalRole);
  }
});

test('rejects loss of capability, payment or branch QA scenario coverage', () => {
  const result = check(p => {
    p.merchants[1].oa5_scenarios = ['qa_pos_sale_and_payment'];
    p.required_safety_checks = ['isolated_backend_attested'];
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /Missing OA5 scenario coverage/);
  assert.match(result.errors.join('\n'), /Missing isolation precondition/);
});

test('C2-only scenarios may not be pulled into the pre-C2 OA5 acceptance plan', () => {
  const result = check(p => {
    p.merchants[0].oa5_scenarios.push('qa_branch_owned_subscription_profiles');
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /Future C2 scenarios must not run/);
});

test('rejects unsupported mode and never exposes a seed/apply operation', () => {
  const run = spawnSync(process.execPath,['scripts/qa/oa5-test-merchant-fixtures.mjs','--apply'],{
    cwd:fileURLToPath(new URL('../../',import.meta.url)), encoding:'utf8'
  });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /no --seed, --apply or network mode/);
});

test('offline CLI validates the fixture plan but explicitly claims no provisioning', () => {
  const run = spawnSync(process.execPath,['scripts/qa/oa5-test-merchant-fixtures.mjs','--check'],{
    cwd:fileURLToPath(new URL('../../',import.meta.url)), encoding:'utf8'
  });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /3 synthetic merchants, 5 Branch scenarios/);
  assert.match(run.stdout, /Not provisioned: no Supabase contact/);
});
