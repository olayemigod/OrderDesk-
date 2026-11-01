import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const helperSource = read('../../../supabase/functions/platform-admin/audit-explorer.ts');
const compiled = ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { auditParameters, auditCsv, csvCell } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('audit defaults and strict bounded request validation', () => {
  assert.equal(auditParameters({}, 'verified-actor', false).p_limit, 50);
  for (const limit of [0, 101, -1, 1.5, '50', NaN]) assert.throws(() => auditParameters({ limit }, 'actor', false));
  for (const body of [
    { afterId: 'bad' },
    { afterCreatedAt: '2026-11-01T00:00:00Z' },
    { from: 'yesterday' },
    { business: 'x'.repeat(201) },
    { search: 'x'.repeat(201) },
    { from: '2026-11-02T00:00:00Z', to: '2026-11-01T00:00:00Z' },
  ]) assert.throws(() => auditParameters(body, 'actor', false));
});

test('Business and audit filters pass to the service RPC; export restarts from newest match', () => {
  const body = {
    business: 'Retired Example Business',
    event: 'tenant_retired',
    actor: 'admin@example.com',
    search: 'controlled cleanup',
    from: '2026-10-01T00:00:00Z',
    to: '2026-11-01T00:00:00Z',
    afterId: '00000000-0000-4000-8000-000000000002',
    afterCreatedAt: '2026-10-31T12:00:00.123456Z',
  };
  const parameters = auditParameters(body, 'verified', false);
  assert.equal(parameters.p_actor_user_id, 'verified');
  for (const field of ['business', 'event', 'actor', 'search', 'from', 'to']) assert.ok(parameters[`p_${field}`]);
  assert.equal(parameters.p_after_created_at, body.afterCreatedAt);
  const exporting = auditParameters(body, 'verified', true);
  assert.equal(exporting.p_after_id, null);
  assert.equal(exporting.p_after_created_at, null);
  assert.equal(exporting.p_export, true);
});

test('CSV safely quotes Unicode, quotes, commas, newlines and spreadsheet formulas', () => {
  assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"');
  for (const cell of ['=SUM(A1)', '+1', '-2', '@cmd', '  =1', '\ttext', '\ntext']) assert.ok(csvCell(cell).startsWith('"\''));
  assert.ok(auditCsv([{ tenantName: 'Àdùn', detail: { message: 'hello' } }]).includes('Àdùn'));
  assert.equal(auditCsv(Array.from({ length: 1100 }, () => ({ id: 'one' }))).split('\r\n').length, 1001);
});

test('Governance uses the server-backed explorer while Communications keeps the legacy feed', () => {
  const workspace = read('../src/AdminWorkspace.tsx');
  const gateway = read('../../../supabase/functions/platform-admin/index.ts');
  const explorer = read('../src/AuditExplorer.tsx');
  const migration = read('../../../supabase/migrations/20261101063000_platform_admin_audit_explorer_convergence.sql');

  assert.match(workspace, /case 'governance\/audit': return <AuditExplorer session=\{session\} \/>/);
  assert.match(workspace, /action: 'audit', tenantId: null, limit: 100/);
  assert.match(workspace, /<CampaignHistory audit=\{audit\} \/>/);
  assert.ok(gateway.indexOf("identity.aal !== 'aal2'") < gateway.indexOf("if (action === 'audit_explorer'"));
  assert.match(gateway, /platform_admin_audit_log/);
  assert.match(gateway, /platform_admin_audit_explorer/);
  assert.doesNotMatch(explorer, /MerchantSelector/);
  assert.match(explorer, /Business name or ID/);
  assert.match(migration, /left join public\.tenants t on t\.id = a\.tenant_id/);
  assert.match(migration, /p_business text default null/);
  assert.doesNotMatch(migration, /where[^;]*retired_at\s+is\s+null/i);
});
