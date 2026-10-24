import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const workspace = readFileSync(new URL('../src/AdminWorkspaceV3.tsx', import.meta.url), 'utf8');
const selector = readFileSync(new URL('../src/MerchantSelector.tsx', import.meta.url), 'utf8');
const commercial = readFileSync(new URL('../src/CommercialAdminWorkspaces.tsx', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const governance = readFileSync(new URL('../../../.agents/skills/sellertray-project-implementation/ADMIN_NAVIGATION.md', import.meta.url), 'utf8');

test('Admin shell uses grouped two-level navigation instead of one flat task pile', () => {
  for (const group of ['Overview', 'Merchants', 'Commercial', 'Onboarding & Setup', 'Communications', 'Platform Operations', 'Governance']) {
    assert.match(workspace, new RegExp(`label: '${group.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  }
  assert.match(workspace, /admin-nav-group-button/);
  assert.match(workspace, /admin-nav-submenu-link/);
  assert.doesNotMatch(workspace, /label: 'Settings'/);
});

test('Commercial and onboarding jobs have focused first-class destinations', () => {
  for (const route of [
    'commercial/orders',
    'commercial/pricing',
    'commercial/settlement',
    'commercial/installments',
    'commercial/agreements',
    'setup/appointments',
    'setup/readiness',
  ]) assert.match(workspace, new RegExp(route.replace('/', '\\/')));
  assert.match(workspace, /CommercialOrdersAdministration/);
  assert.match(workspace, /CommercialPricingAdministration/);
  assert.match(workspace, /InstallmentEntitlementAdministration/);
  assert.match(workspace, /CommercialAgreementAdministration/);
  assert.match(workspace, /BranchReadinessAdministration/);
  assert.doesNotMatch(workspace, /CommercialBillingAdministrationLegacy/);
});

test('Branch readiness review cannot expose the legacy generic readiness shortcut', () => {
  assert.match(commercial, /governed setup-completion path/);
  assert.match(commercial, /does not expose the legacy generic/);
  assert.doesNotMatch(commercial, /admin_mark_setup_ready/);
  assert.doesNotMatch(commercial, /Record setup ready/);
});

test('Merchant scope is persistent shell state and selectors are pure by default', () => {
  assert.match(workspace, /Merchant context/);
  assert.match(workspace, /tenantFromHash/);
  assert.match(workspace, /setMerchantContext/);
  assert.match(selector, /showCommercialPortfolio === true/);
  assert.doesNotMatch(selector, /showCommercialPortfolio \?\? mode === 'single'/);
});

test('Active Admin entrypoint and governance contract are wired without retired shells', () => {
  assert.match(entry, /AdminWorkspaceV3/);
  assert.match(entry, /admin-navigation\.css/);
  for (const retired of [
    '../src/AdminWorkspace.tsx',
    '../src/AdminWorkspaceV2.tsx',
    '../src/CommercialBillingAdministration.tsx',
    '../src/CommercialBillingAdministrationLegacy.tsx',
  ]) assert.equal(existsSync(new URL(retired, import.meta.url)), false, `${retired} must stay retired`);
  assert.match(governance, /One Admin page represents one primary administrative job/);
  assert.match(governance, /group -> destination/);
  assert.match(governance, /OA4 Admin work must land in this group/);
  assert.match(governance, /Commercial Orders/);
  assert.match(governance, /Plans & Pricing/);
  assert.match(governance, /must not expose the legacy generic `Record ready` shortcut/);
  assert.match(governance, /must not mount them once their jobs have focused destinations/);
});

test('Legacy hashes remain recoverable after navigation convergence', () => {
  for (const legacy of ['overview', 'merchants', 'billing', 'commercial/core', 'communications', 'operations', 'audit', 'settings']) {
    assert.match(workspace, new RegExp(`['\"]?${legacy.replace('/', '\\/')}['\"]?:`));
  }
});
