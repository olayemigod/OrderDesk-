import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const navigation = readFileSync(new URL('../src/admin-navigation.css', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../src/AdminWorkspace.tsx', import.meta.url), 'utf8');
const boundary = readFileSync(new URL('../ADMIN_VISUAL_REDESIGN_BOUNDARY.md', import.meta.url), 'utf8');
const governance = readFileSync(new URL('../../../.agents/skills/sellertray-project-implementation/ADMIN_VISUAL_DESIGN.md', import.meta.url), 'utf8');

test('approved PR149/PR158 Admin presentation remains the active visual baseline', () => {
  assert.match(governance, /PR #149/);
  assert.match(governance, /PR #158/);
  assert.match(boundary, /approved presentation baseline/i);
  assert.match(boundary, /must not restore a pre-redesign shell/i);
});

test('canonical Admin entrypoint keeps the complete redesigned stylesheet stack', () => {
  for (const stylesheet of ['./styles.css', './brand.css', './admin-workspace.css', './admin-navigation.css']) {
    assert.match(entry, new RegExp(`import ['\"]${stylesheet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\"]`));
  }
});

test('redesigned sidebar keeps approved SellerTray identity and desktop sticky rail', () => {
  assert.match(navigation, /workspace-sidebar \.workspace-sidebar-brand::before/);
  assert.match(navigation, /sellertray-app-icon-v2\.png/);
  assert.match(navigation, /content: 'Seller'/);
  assert.match(navigation, /content: 'Tray'/);
  assert.match(navigation, /content: 'Admin Web'/);
  assert.match(navigation, /@media \(min-width: 821px\)/);
  assert.match(navigation, /position: sticky !important/);
  assert.match(navigation, /height: 100dvh !important/);
});

test('redesigned shell preserves grouped desktop navigation, responsive Merchant context and drawer contract', () => {
  assert.match(workspace, /admin-nav-group-button/);
  assert.match(workspace, /admin-nav-submenu-link/);
  assert.match(workspace, /mobileNavOpen/);
  assert.match(workspace, /workspace-mobile-scrim/);
  assert.match(navigation, /@media \(max-width: 820px\)/);
  assert.match(navigation, /admin-merchant-context-popover/);
  assert.match(navigation, /position: fixed/);
});

test('root overflow correction that protects sticky navigation cannot silently disappear', () => {
  assert.match(navigation, /html,\s*\nbody,\s*\n#root/);
  assert.match(navigation, /overflow-x: clip !important/);
  assert.match(navigation, /overflow-y: visible !important/);
});
