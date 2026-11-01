import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const entry = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const baseWorkspace = readFileSync(new URL('../src/admin-workspace.css', import.meta.url), 'utf8');
const convergence = readFileSync(new URL('../src/admin-context-convergence.css', import.meta.url), 'utf8');

test('narrow Admin tables preserve semantic column headers instead of ambiguous unlabeled cards', () => {
  const compositionIndex = entry.indexOf("import './admin-workspace-composition-v2.css'");
  const convergenceIndex = entry.indexOf("import './admin-context-convergence.css'");
  assert.ok(compositionIndex >= 0 && convergenceIndex > compositionIndex, 'convergence overrides must load after the composition layer');
  assert.match(convergence, /@media \(max-width: 680px\)/);
  assert.match(convergence, /\.workspace-table-wrap \{[\s\S]*overflow: auto !important/);
  assert.match(convergence, /\.workspace-table thead \{[\s\S]*display: table-header-group !important/);
  assert.match(convergence, /\.workspace-table tbody \{[\s\S]*display: table-row-group !important/);
  assert.match(convergence, /\.workspace-table tr \{[\s\S]*display: table-row !important/);
  assert.match(convergence, /\.workspace-table tbody td \{[\s\S]*display: table-cell !important/);
});

test('settlement order rows do not inherit the Merchant-selector checkbox column on narrow screens', () => {
  assert.match(baseWorkspace, /\.workspace-tenant-row \{[^}]*grid-template-columns: 28px minmax\(160px,1fr\) auto auto;/);
  assert.match(baseWorkspace, /\.workspace-tenant-row \{ grid-template-columns: 26px minmax\(0,1fr\); \}/);
  assert.match(convergence, /\.workspace-tenant-row:not\(:has\(\.workspace-tenant-check\)\) \{\s*grid-template-columns: minmax\(0, 1fr\) auto auto;/);
  assert.match(convergence, /@media \(max-width: 680px\)[\s\S]*\.workspace-tenant-row:not\(:has\(\.workspace-tenant-check\)\) \{\s*grid-template-columns: minmax\(0, 1fr\) !important;/);
  assert.match(convergence, /\.workspace-tenant-row:not\(:has\(\.workspace-tenant-check\)\) \.workspace-status-pill \{\s*display: inline-flex !important;\s*justify-self: start;/);
});