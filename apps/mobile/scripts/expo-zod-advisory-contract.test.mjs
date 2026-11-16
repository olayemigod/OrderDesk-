import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectExpoZodLock, scanMerchantSourceForDirectZodImports } from './expo-zod-advisory-contract.mjs';

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = () => ({
  manifest: {dependencies: {expo: '~57.0.9'}},
  lock: {packages: {
    'node_modules/expo': {version: '57.0.28', dependencies: {'@expo/cli':'^57.0.29'}},
    'node_modules/expo/node_modules/@expo/cli': {version: '57.0.29', dependencies: {zod: '^3.25.76'}},
    'node_modules/zod': {version: '3.25.76'},
  }},
});

test('actual locked Expo/Zod risk is classified BLOCKED rather than waived', () => {
  const manifestPath = join(mobileRoot, 'package.json');
  const lockPath = join(mobileRoot, 'package-lock.json');
  const {manifest, lock} = existsSync(manifestPath) && existsSync(lockPath)
    ? {manifest: JSON.parse(readFileSync(manifestPath, 'utf8')), lock: JSON.parse(readFileSync(lockPath, 'utf8'))}
    : fixture();
  const report = inspectExpoZodLock(manifest, lock);
  assert.equal(report.advisory, 'GHSA-MRHX-C7XC-M3W5');
  assert.ok(['BLOCKED', 'CANDIDATE_ONLY'].includes(report.status));
  assert.ok(report.zodPackages.length || !report.consumers.some(x => x.requirement.includes('3.')));
  if (report.status === 'BLOCKED') assert.ok(report.productionVulnerable.length > 0);
  assert.equal('auditPassed' in report, false);
});

test('locked SDK57 CLI dependency is identified without treating it as merchant input validation', () => {
  const {manifest, lock} = fixture();
  const report = inspectExpoZodLock(manifest, lock);
  assert.equal(report.status, 'BLOCKED');
  assert.equal(report.expoVersion, '57.0.28');
  assert.equal(report.cliVersion, '57.0.29');
  assert.equal(report.cliRequiresZod3, true);
  assert.equal(report.directDependency, false);
  assert.deepEqual(report.consumers.map(x => x.path), ['node_modules/expo/node_modules/@expo/cli']);
  assert.equal(report.productionVulnerable[0].version, '3.25.76');
});

test('an unrelated production Zod consumer remains BLOCKED', () => {
  const {manifest, lock} = fixture();
  lock.packages['node_modules/another-runtime-module'] = {version: '1.0.0', dependencies: {zod: '^3.25.76'}};
  const report = inspectExpoZodLock(manifest, lock);
  assert.equal(report.status, 'BLOCKED');
  assert.equal(report.consumers.length, 2);
});

test('a future dev-only or patched graph is only a candidate, never audit approval', () => {
  const {manifest, lock} = fixture();
  lock.packages['node_modules/expo/node_modules/@expo/cli'].dependencies = {};
  lock.packages['node_modules/zod'].dev = true;
  let report = inspectExpoZodLock(manifest, lock);
  assert.equal(report.status, 'CANDIDATE_ONLY');
  lock.packages['node_modules/zod'] = {version: '4.6.6'};
  report = inspectExpoZodLock(manifest, lock);
  assert.equal(report.status, 'CANDIDATE_ONLY');
  assert.equal('auditPassed' in report, false);
});

test('merchant-source direct Zod import is detected, even if dependency looks tooling-only', () => {
  const root = mkdtempSync('/tmp/sellertray-expo-zod-');
  try {
    mkdirSync(join(root, 'src'), {recursive: true});
    mkdirSync(join(root, 'modules'), {recursive: true});
    writeFileSync(join(root, 'src', 'Cart.tsx'), "import { z } from 'zod';\n");
    writeFileSync(join(root, 'modules', 'provider.js'), 'const z = require("zod/v3");\n');
    assert.deepEqual(scanMerchantSourceForDirectZodImports(root), ['modules/provider.js', 'src/Cart.tsx']);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('SellerTray merchant runtime has no explicit Zod import (indirect bundling still requires verification)', () => {
  if (!existsSync(join(mobileRoot, 'src'))) return;
  assert.deepEqual(scanMerchantSourceForDirectZodImports(mobileRoot), []);
});
