export function csvCell(value: unknown): string {
  let text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function auditCsv(events: Record<string, unknown>[]): string {
  const columns = ['id', 'createdAt', 'tenantId', 'tenantName', 'action', 'actorUserId', 'actorEmail', 'detail'];
  return '\uFEFF' + [columns.join(','), ...events.slice(0, 1000).map(row => columns.map(key => csvCell(row[key])).join(','))].join('\r\n');
}

export function auditParameters(body: Record<string, unknown>, actorId: string, exporting: boolean): Record<string, unknown> {
  const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const text = (key: string, max: number) => {
    const value = body[key];
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid ${key}`);
    return value.trim() || null;
  };
  const date = (key: string) => {
    const value = text(key, 40);
    if (value && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))) throw new Error(`Invalid ${key}`);
    return value;
  };
  const tenantId = text('tenantId', 36);
  if (tenantId && !uuid(tenantId)) throw new Error('Invalid Business');
  const afterId = text('afterId', 36);
  const afterCreatedAt = date('afterCreatedAt');
  if ((afterId && !uuid(afterId)) || Boolean(afterId) !== Boolean(afterCreatedAt)) throw new Error('Invalid audit cursor');
  const from = date('from');
  const to = date('to');
  if (from && to && Date.parse(from) >= Date.parse(to)) throw new Error('From must precede To');
  const limit = body.limit ?? 50;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Audit page size must be between 1 and 100');
  return { p_actor_user_id: actorId, p_tenant_id: tenantId, p_event: text('event', 120), p_actor: text('actor', 254), p_search: text('search', 200), p_from: from, p_to: to, p_after_created_at: exporting ? null : afterCreatedAt, p_after_id: exporting ? null : afterId, p_limit: limit, p_export: exporting };
}
