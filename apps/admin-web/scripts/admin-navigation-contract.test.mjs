import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workspace = readFileSync(new URL('../src/AdminWorkspaceV2.tsx', import.meta.url), 'utf8');
const selector = readFileSync(new URL('../src/MerchantSelector.tsx', import.meta.url), 'utf8');
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

test('Independent settlement and setup workspaces are no longer mounted through the catch-all billing component', () => {
  assert.match(workspace, /CommercialSettlementAdministration/);
  assert.match(workspace, /SetupSchedulingAdministration/);
  assert.match(workspace, /CommercialBillingAdministrationLegacy/);
  assert.doesNotMatch(workspace, /import CommercialBillingAdministration from/);
  assert.match(workspace, /'commercial\/settlement'/);
  assert.match(workspace, /'setup\/appointments'/);
});

test('Merchant scope is persistent shell state and selectors are pure by default', () => {
  assert.match(workspace, /Merchant context/);
  assert.match(workspace, /tenantFromHash/);
  assert.match(workspace, /setMerchantContext/);
  assert.match(selector, /showCommercialPortfolio === true/);
  assert.doesNotMatch(selector, /showCommercialPortfolio \?\? mode === 'single'/);
});

test('New Admin entrypoint and governance contract are wired', () => {
  assert.match(entry, /AdminWorkspaceV2/);
  assert.match(entry, /admin-navigation\.css/);
  assert.match(governance, /One Admin page represents one primary administrative job/);
  assert.match(governance, /group -> destination/);
  assert.match(governance, /OA4 Admin work must land in this group/);
});

test('Legacy hashes remain recoverable after navigation convergence', () => {
  for (const legacy of ['overview', 'merchants', 'billing', 'communications', 'operations', 'audit', 'settings']) {
    assert.match(workspace, new RegExp(`${legacy}:`));
  }
});
