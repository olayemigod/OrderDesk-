import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const workspace = readFileSync(new URL('../src/AdminWorkspace.tsx', import.meta.url), 'utf8');
const selector = readFileSync(new URL('../src/MerchantSelector.tsx', import.meta.url), 'utf8');
const commercial = readFileSync(new URL('../src/CommercialAdminWorkspaces.tsx', import.meta.url), 'utf8');
const communications = readFileSync(new URL('../src/AdminCommunicationsWorkspaces.tsx', import.meta.url), 'utf8');
const operations = readFileSync(new URL('../src/AdminOperationsWorkspaces.tsx', import.meta.url), 'utf8');
const revenue = readFileSync(new URL('../src/RevenueDashboard.tsx', import.meta.url), 'utf8');
const setup = readFileSync(new URL('../src/SetupSchedulingAdministration.tsx', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const governance = readFileSync(new URL('../../../.agents/skills/sellertray-project-implementation/ADMIN_NAVIGATION.md', import.meta.url), 'utf8');

test('Admin shell uses grouped two-level navigation instead of one flat task pile', () => {
  for (const group of ['Overview', 'Merchants', 'Commercial', 'Onboarding & Setup', 'Communications', 'Platform Operations', 'Insights & Reports', 'Governance']) {
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
    'setup/resources',
    'setup/readiness',
  ]) assert.match(workspace, new RegExp(route.replace('/', '\\/')));
  assert.match(workspace, /CommercialOrdersAdministration/);
  assert.match(workspace, /CommercialPricingAdministration/);
  assert.match(workspace, /InstallmentEntitlementAdministration/);
  assert.match(workspace, /CommercialAgreementAdministration/);
  assert.match(workspace, /BranchReadinessAdministration/);
  assert.match(workspace, /view="appointments" showMerchantSelector=\{false\}/);
  assert.match(workspace, /view="resources" showMerchantSelector=\{false\}/);
  assert.match(setup, /type SetupView = 'all' \| 'appointments' \| 'resources'/);
  assert.doesNotMatch(workspace, /CommercialBillingAdministrationLegacy/);
});

test('Agreements navigation is platform-scoped and does not expose retired bespoke agreement jobs', () => {
  assert.match(workspace, /\{ id: 'commercial\/agreements', label: 'Agreements', description: 'Master Agreement publication and Business acceptance history' \}/);
  assert.match(workspace, /case 'commercial\/agreements': return <PageFrame/);
  assert.doesNotMatch(workspace, /commercial\/agreements'.*merchantScoped: true/);
  assert.doesNotMatch(workspace, /Templates, issuance, acceptance and replacement/);
  assert.doesNotMatch(workspace, /Publish governed templates, issue merchant agreements/);
  assert.doesNotMatch(commercial, /Publish agreement template|Issue merchant agreement|admin_publish_template|admin_issue/);
  assert.match(commercial, /Legacy agreement history/);
  assert.match(commercial, /historical evidence only/);
  assert.match(governance, /platform-scoped for publication/i);
  assert.match(governance, /must not expose bespoke merchant agreement issuance\/replacement actions/i);
});

test('Communications and platform operations are split into task-specific destinations', () => {
  for (const route of ['communications/compose', 'communications/history', 'operations/whatsapp', 'operations/ai']) {
    assert.match(workspace, new RegExp(route.replace('/', '\\/')));
  }
  assert.match(workspace, /MerchantMessageComposer/);
  assert.match(workspace, /CampaignHistory/);
  assert.match(workspace, /WhatsAppOperations/);
  assert.match(workspace, /AiOperations/);
  assert.match(communications, /platform-merchant-message/);
  assert.match(communications, /merchant_message_published/);
  assert.match(operations, /operations_summary/);
  assert.match(operations, /ai_parser_probe/);
});

test('Revenue Dashboard is a governed first-class Insights & Reports destination', () => {
  assert.match(workspace, /'reports\/revenue'/);
  assert.match(workspace, /label: 'Revenue Dashboard'/);
  assert.match(workspace, /<RevenueDashboard session=\{session\}/);
  assert.match(revenue, /action: 'business_dashboard'/);
  assert.match(revenue, /recognised revenue is not calculated or displayed here/i);
  assert.match(revenue, /Amounts are never combined across currencies/);
  assert.match(governance, /Revenue Dashboard/);
  assert.match(governance, /recognised revenue must not be calculated or displayed until an approved SellerTray revenue-recognition\/accounting authority exists/i);
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

test('Canonical Admin entrypoint is wired and retired shells stay retired', () => {
  assert.match(entry, /import AdminWorkspace from '.\/AdminWorkspace'/);
  assert.doesNotMatch(entry, /AdminWorkspaceV3/);
  assert.match(entry, /admin-navigation\.css/);
  for (const retired of [
    '../src/AdminWorkspaceV2.tsx',
    '../src/AdminWorkspaceV3.tsx',
    '../src/CommercialBillingAdministration.tsx',
    '../src/CommercialBillingAdministrationLegacy.tsx',
  ]) assert.equal(existsSync(new URL(retired, import.meta.url)), false, `${retired} must stay retired`);
  assert.match(governance, /One Admin page represents one primary administrative job/);
  assert.match(governance, /group -> destination/);
  assert.match(governance, /OA4 Admin work must land in this group/);
  assert.match(governance, /Commercial Orders/);
  assert.match(governance, /Plans & Pricing/);
  assert.match(governance, /must not expose the legacy generic `Record ready` shortcut/);
});

test('Legacy hashes remain recoverable after navigation convergence', () => {
  for (const legacy of ['overview', 'merchants', 'billing', 'commercial/core', 'communications', 'communications/messages', 'operations', 'operations/health', 'revenue', 'reports', 'audit', 'settings']) {
    assert.match(workspace, new RegExp(`['\"]?${legacy.replace('/', '\\/')}['\"]?:`));
  }
});

test('Browser history tracks the full hash so same-route Merchant context restores on Back and Forward', () => {
  assert.match(workspace, /const \[locationHash, setLocationHash\] = useState\(\(\) => window\.location\.hash\)/);
  assert.match(workspace, /const route = routeFromHash\(locationHash\)/);
  assert.match(workspace, /const tenantId = tenantFromHash\(locationHash\)/);
  assert.match(workspace, /const handleHashChange = \(\) => setLocationHash\(window\.location\.hash\)/);
  assert.match(workspace, /\[session\.access_token, tenantId\]/);
  assert.doesNotMatch(workspace, /const \[route, setRoute\]/);
});
