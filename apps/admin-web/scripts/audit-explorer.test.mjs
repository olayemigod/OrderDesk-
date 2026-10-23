import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const source = read('../../../supabase/functions/platform-admin/audit-explorer.ts');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { auditParameters, auditCsv, csvCell } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('audit defaults and strict bounded request validation', () => {
  assert.equal(auditParameters({}, 'verified-actor', false).p_limit, 50);
  for (const limit of [0, 101, -1, 1.5, '50', NaN]) assert.throws(() => auditParameters({ limit }, 'actor', false));
  for (const body of [{ tenantId: 'bad' }, { afterId: 'bad' }, { afterCreatedAt: '2026-10-22T00:00:00Z' }, { from: 'yesterday' }, { search: 'x'.repeat(201) }, { from: '2026-10-23T00:00:00Z', to: '2026-10-22T00:00:00Z' }]) assert.throws(() => auditParameters(body, 'actor', false));
});

test('all filters and microsecond cursor pass to governed RPC; export restarts matching set', () => {
  const body = { tenantId: '00000000-0000-4000-8000-000000000001', event: 'published', actor: 'admin@example.com', search: 'needle', from: '2026-10-01T00:00:00Z', to: '2026-10-22T00:00:00Z', afterId: '00000000-0000-4000-8000-000000000002', afterCreatedAt: '2026-10-21T12:00:00.123456Z' };
  const parameters = auditParameters(body, 'verified', false);
  assert.equal(parameters.p_actor_user_id, 'verified');
  for (const field of ['tenant_id', 'event', 'actor', 'search', 'from', 'to']) assert.ok(parameters[`p_${field}`]);
  assert.equal(parameters.p_after_created_at, body.afterCreatedAt);
  const exporting = auditParameters(body, 'verified', true);
  assert.equal(exporting.p_after_id, null);
  assert.equal(exporting.p_export, true);
});

test('CSV safely quotes Unicode, quotes, commas, newlines and spreadsheet formulas', () => {
  assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"');
  for (const cell of ['=SUM(A1)', '+1', '-2', '@cmd', '  =1', '\ttext', '\ntext']) assert.ok(csvCell(cell).startsWith('"\''));
  assert.ok(auditCsv([{ tenantName: 'Àdùn', detail: { message: 'hello' } }]).includes('Àdùn'));
  assert.equal(auditCsv(Array.from({ length: 1100 }, () => ({ id: 'one' }))).split('\r\n').length, 1001);
});

test('Audit alone switches reads while Communications keeps the legacy bounded feed', () => {
  const workspace = read('../src/AdminWorkspace.tsx');
  const gateway = read('../../../supabase/functions/platform-admin/index.ts');
  assert.match(workspace, /case 'audit': return <AuditExplorer session=\{session\}/);
  assert.match(workspace, /action: 'audit', tenantId: null, limit: 100/);
  assert.match(workspace, /audit.filter\(\(event\) => event.action === 'merchant_message_published'/);
  assert.ok(gateway.indexOf("identity.aal !== 'aal2'") < gateway.indexOf("if (action === 'audit_explorer'"));
  assert.match(gateway, /platform_admin_audit_log/);
  const explorer = read('../src/AuditExplorer.tsx');
  const selector = read('../src/MerchantSelector.tsx');
  assert.match(explorer, /showCommercialPortfolio=\{false\} showAgreementLifecycle=\{false\}/);
  assert.match(selector, /showAgreementLifecycle = true/);
  assert.match(selector, /showAgreementLifecycle && selectedTenantId/);
});
