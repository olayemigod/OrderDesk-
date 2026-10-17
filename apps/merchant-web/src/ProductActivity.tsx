import { useEffect, useState } from 'react';

import { errorMessage, numberValue, supabase } from './supabase';

type ProductActivityItem = {
  eventId: string;
  kind: 'configuration' | 'stock';
  eventType: string;
  summary: string;
  occurredAt: string;
  recordedAt: string;
  actorName: string;
  branchName: string | null;
  quantityDelta: number | null;
  stockUom: string | null;
  referenceType: string | null;
  referenceId: string | null;
  details: Record<string, unknown>;
};

export default function ProductActivity({ tenantId, productId }: { tenantId: string; productId: string }) {
  const [items, setItems] = useState<ProductActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void load(); }, [tenantId, productId]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_product_activity', {
        p_tenant_id: tenantId,
        p_product_id: productId,
        p_limit: 100,
      });
      if (rpcError) throw rpcError;
      setItems(array(data).map(parseActivity).filter((item) => item.eventId));
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load Product activity.'));
    } finally {
      setLoading(false);
    }
  }

  return <section className="panel product-activity-panel">
    <div className="panel-head">
      <div><p className="eyebrow">Activity</p><h3>Product history</h3><p className="muted">Configuration changes and governed stock movements, ordered by business time.</p></div>
      <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh activity'}</button>
    </div>
    {error ? <div className="error-banner compact">{error}</div> : null}
    {loading && items.length === 0 ? <div className="product-loading">Loading Product activity…</div> : null}
    {!loading && !error && items.length === 0 ? <div className="empty-state"><strong>No Product activity yet</strong><p>Future Product configuration changes and governed stock movements will appear here.</p></div> : null}
    {items.length ? <div className="table-wrap"><table className="compact-table"><thead><tr><th>When</th><th>Activity</th><th>Branch</th><th>Change</th><th>By</th><th>Reference</th></tr></thead><tbody>
      {items.map((item) => <tr key={`${item.kind}-${item.eventId}`}>
        <td><strong>{dateTime(item.occurredAt)}</strong>{recordedLater(item) ? <small className="muted">Recorded {dateTime(item.recordedAt)}</small> : null}</td>
        <td><strong>{item.summary}</strong>{reason(item) ? <small className="muted">{reason(item)}</small> : null}</td>
        <td>{item.branchName || 'Business-wide'}</td>
        <td>{item.kind === 'stock' && item.quantityDelta != null ? <strong>{signed(item.quantityDelta)} {item.stockUom || ''}</strong> : '—'}</td>
        <td>{item.actorName || 'SellerTray system'}</td>
        <td>{item.referenceId ? <><strong>{item.referenceId}</strong>{item.referenceType ? <small className="muted">{label(item.referenceType)}</small> : null}</> : '—'}</td>
      </tr>)}
    </tbody></table></div> : null}
    <p className="muted">Configuration audit starts when Product activity tracking is enabled. Stock history continues to use the immutable inventory ledger and preserves each movement's business time.</p>
  </section>;
}

function parseActivity(value: unknown): ProductActivityItem {
  const row = object(value);
  const kind = row.kind === 'stock' ? 'stock' : 'configuration';
  return {
    eventId: String(row.eventId ?? ''),
    kind,
    eventType: String(row.eventType ?? ''),
    summary: String(row.summary ?? 'Product activity'),
    occurredAt: String(row.occurredAt ?? ''),
    recordedAt: String(row.recordedAt ?? row.occurredAt ?? ''),
    actorName: String(row.actorName ?? 'SellerTray system'),
    branchName: nullableString(row.branchName),
    quantityDelta: row.quantityDelta == null ? null : numberValue(row.quantityDelta),
    stockUom: nullableString(row.stockUom),
    referenceType: nullableString(row.referenceType),
    referenceId: nullableString(row.referenceId),
    details: object(row.details),
  };
}

function reason(item: ProductActivityItem): string | null {
  return nullableString(item.details.reason);
}
function recordedLater(item: ProductActivityItem): boolean {
  if (item.kind !== 'stock') return false;
  const occurred = new Date(item.occurredAt).getTime();
  const recorded = new Date(item.recordedAt).getTime();
  return Number.isFinite(occurred) && Number.isFinite(recorded) && Math.abs(recorded - occurred) >= 60_000;
}
function signed(value: number): string {
  const formatted = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 6 }).format(Math.abs(value));
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatted}`;
}
function label(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}
function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function nullableString(value: unknown): string | null { const text = typeof value === 'string' ? value.trim() : ''; return text || null; }
