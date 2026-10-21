import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
const read = (path) => readFileSync(resolve(import.meta.dirname,'../..',path),'utf8');
const workspace = read('admin-web/src/AdminWorkspace.tsx');
const main = read('admin-web/src/main.tsx');
const commercial = read('admin-web/src/CommercialBillingAdministration.tsx');
const dashboard = read('admin-web/src/BusinessDashboard.tsx');
test('active entry keeps trial UI unreachable', () => {
  assert.match(main,/import AdminWorkspace/);
  assert.doesNotMatch(main+workspace+dashboard,/import .*SubscriptionAccess|import .*['"]\.\/App['"]|action: 'extend_trial_days'/);
});
test('active Admin UI uses business terminology', () => assert.doesNotMatch(workspace+commercial+dashboard,/C1B|C1A|pre-C2|No C2|deliberate C2/));
test('dashboard requests governed aggregates and bounds stale results', () => {
  assert.match(dashboard,/action: 'business_dashboard'/);
  assert.doesNotMatch(dashboard,/overview\.tenants|\.reduce\(/);
  assert.match(dashboard,/active = false/);
});
test('attention drill-down survives hash routing', () => {
  assert.match(dashboard,/#merchants\?tenant=/);
  assert.match(workspace,/split\('\?'\)\[0\]/);
  assert.match(workspace,/setSelectedId\(merchantFromHash\(\)\)/);
});
