import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const navigation = readFileSync(new URL('../src/admin-navigation.css', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../src/AdminWorkspace.tsx', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/BusinessDashboard.tsx', import.meta.url), 'utf8');
const revenue = readFileSync(new URL('../src/RevenueDashboard.tsx', import.meta.url), 'utf8');
const commercial = readFileSync(new URL('../src/CommercialAdminWorkspaces.tsx', import.meta.url), 'utf8');
const settlement = readFileSync(new URL('../src/CommercialSettlementAdministration.tsx', import.meta.url), 'utf8');
const setup = readFileSync(new URL('../src/SetupSchedulingAdministration.tsx', import.meta.url), 'utf8');
const contextConvergence = readFileSync(new URL('../src/admin-context-convergence.css', import.meta.url), 'utf8');
const boundary = readFileSync(new URL('../ADMIN_VISUAL_REDESIGN_BOUNDARY.md', import.meta.url), 'utf8');
const governance = readFileSync(new URL('../../../.agents/skills/sellertray-project-implementation/ADMIN_VISUAL_DESIGN.md', import.meta.url), 'utf8');

const redesignedStylesheets = [
  './styles.css',
  './brand.css',
  './admin-workspace.css',
  './admin-navigation.css',
  './admin-redesign.css',
  './admin-workspaces-redesign.css',
  './admin-responsive-hardening.css',
  './admin-portfolio-revenue-redesign.css',
  './admin-workspace-composition-v2.css',
  './admin-console-v3.css',
  './admin-context-convergence.css',
];

test('approved PR149/PR158 Admin presentation remains the active visual baseline', () => {
  assert.match(governance, /PR #149/);
  assert.match(governance, /PR #158/);
  assert.match(boundary, /approved presentation baseline/i);
  assert.match(boundary, /must not restore a pre-redesign shell/i);
});

test('canonical Admin entrypoint keeps the complete redesigned stylesheet stack', () => {
  for (const stylesheet of redesignedStylesheets) {
    assert.ok(entry.includes(`import '${stylesheet}'`) || entry.includes(`import "${stylesheet}"`), `missing stylesheet import ${stylesheet}`);
    readFileSync(new URL(`../src/${stylesheet.slice(2)}`, import.meta.url), 'utf8');
  }
});

test('redesigned sidebar keeps approved SellerTray identity and desktop sticky rail', () => {
  assert.ok(navigation.includes('workspace-sidebar .workspace-sidebar-brand::before'));
  assert.ok(navigation.includes('sellertray-app-icon-v2.png'));
  assert.ok(navigation.includes("content: 'Seller'"));
  assert.ok(navigation.includes("content: 'Tray'"));
  assert.ok(navigation.includes("content: 'Admin Web'"));
  assert.ok(navigation.includes('@media (min-width: 821px)'));
  assert.ok(navigation.includes('position: sticky !important'));
  assert.ok(navigation.includes('height: 100dvh !important'));
});

test('redesigned shell preserves grouped navigation, persistent Merchant context and drawer contract', () => {
  assert.ok(workspace.includes('admin-nav-group-button'));
  assert.ok(workspace.includes('admin-nav-submenu-link'));
  assert.ok(workspace.includes('mobileNavOpen'));
  assert.ok(workspace.includes('workspace-nav-backdrop'));
  assert.ok(workspace.includes('admin-merchant-context-button'));
  assert.ok(workspace.includes("const query = tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : '';"));
  assert.ok(navigation.includes('@media (max-width: 820px)'));
  assert.ok(navigation.includes('admin-merchant-context-popover'));
  assert.ok(navigation.includes('position: fixed'));
  assert.ok(contextConvergence.includes('.workspace-content > .admin-context-strip'));
  assert.ok(contextConvergence.includes('display: none !important'));
});

test('Dashboard keeps the approved operations-console composition instead of generic legacy panels', () => {
  for (const marker of ['admin-dashboard-page', 'admin-dashboard-hero', 'admin-dashboard-kpis', 'admin-attention-card', 'admin-onboarding-panel', 'Revenue Dashboard']) assert.ok(dashboard.includes(marker), `missing Dashboard marker ${marker}`);
});

test('Revenue Dashboard keeps governed currency-specific financial composition', () => {
  for (const marker of ['admin-revenue-workspace', 'admin-accounting-boundary', 'admin-currency-stack', 'admin-financial-kpis']) assert.ok(revenue.includes(marker), `missing Revenue marker ${marker}`);
  assert.match(revenue, /recognised revenue is not calculated or displayed/i);
});

test('Commercial and setup task workspaces keep approved focused tabs and controls', () => {
  assert.ok(commercial.includes("type ListAddTab = 'list' | 'add'"));
  assert.ok(commercial.includes('invokeCommercialPriceLifecycle'));
  assert.ok(commercial.includes('Price List'));
  assert.ok(settlement.includes("type SettlementTab = 'overview' | 'payment' | 'adjustments' | 'policy' | 'history'"));
  assert.ok(settlement.includes('Payments and settlement views'));
  assert.ok(setup.includes("type ResourceTab = 'list' | 'area' | 'worker'"));
  assert.ok(setup.includes('Setup resource views'));
});

test('root overflow correction that protects sticky navigation cannot silently disappear', () => {
  assert.ok(navigation.includes('html,\nbody,\n#root'));
  assert.ok(navigation.includes('overflow-x: clip !important'));
  assert.ok(navigation.includes('overflow-y: visible !important'));
});
