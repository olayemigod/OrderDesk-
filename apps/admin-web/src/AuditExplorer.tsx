import { useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { invokeJson, isRecord } from './supabase';

type AuditCursor = { afterCreatedAt: string; afterId: string };
type AuditFilters = { business: string; event: string; actor: string; search: string; from: string; to: string };
type AuditRow = {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
  actorUserId: string;
  actorEmail: string;
};
type AuditPageResult = {
  items: AuditRow[];
  hasMore: boolean;
  nextCursor: AuditCursor | null;
  limit: number;
  generatedAt: string | null;
};

const EMPTY_FILTERS: AuditFilters = { business: '', event: '', actor: '', search: '', from: '', to: '' };

export default function AuditExplorer({ session }: { session: Session }) {
  const [draft, setDraft] = useState<AuditFilters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [history, setHistory] = useState<(AuditCursor | null)[]>([null]);
  const [page, setPage] = useState<AuditPageResult>({ items: [], hasMore: false, nextCursor: null, limit: 50, generatedAt: null });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const cursor = history[history.length - 1] ?? null;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const request = requestBody(filters, cursor);
    void invokeJson<{ explorer?: unknown }>('platform-admin', { action: 'audit_explorer', ...request }, session)
      .then((response) => { if (active) setPage(normalizePage(response.explorer)); })
      .catch((cause) => { if (active) setError(messageFrom(cause, 'Unable to load administrator activity.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session.access_token, filters, cursor, refreshKey]);

  function apply(event: FormEvent) {
    event.preventDefault();
    if (draft.from && draft.to && new Date(draft.from).getTime() >= new Date(draft.to).getTime()) {
      setError('The start time must be earlier than the end time.');
      return;
    }
    setNotice(null);
    setError(null);
    setHistory([null]);
    setFilters({ ...draft });
  }

  function reset() {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setHistory([null]);
    setNotice(null);
    setError(null);
  }

  function refresh() {
    setHistory([null]);
    setNotice(null);
    setRefreshKey((value) => value + 1);
  }

  async function exportCsv() {
    setExporting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await invokeJson<{ csv?: unknown; count?: unknown; truncated?: unknown }>(
        'platform-admin',
        { action: 'audit_export', ...requestBody(filters, null) },
        session,
      );
      if (typeof response.csv !== 'string') throw new Error('Audit export returned an invalid file.');
      const blob = new Blob([response.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `sellertray-admin-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      const count = typeof response.count === 'number' ? response.count : 0;
      setNotice(response.truncated === true
        ? `Exported the newest ${count.toLocaleString('en-NG')} matching events. More records matched the filters.`
        : `Exported ${count.toLocaleString('en-NG')} matching event${count === 1 ? '' : 's'}.`);
    } catch (cause) {
      setError(messageFrom(cause, 'Unable to export administrator activity.'));
    } finally {
      setExporting(false);
    }
  }

  return <div className="workspace-page">
    <header className="workspace-page-header">
      <div>
        <p className="workspace-eyebrow">Governance</p>
        <h1>Audit log</h1>
        <p>Search ProcessEdge administrator activity across active and retired Businesses. Applied filters are also used for CSV export.</p>
      </div>
    </header>

    <section className="workspace-panel">
      <form className="workspace-form-stack" onSubmit={apply}>
        <div className="workspace-grid two">
          <label>Business
            <input value={draft.business} maxLength={200} onChange={(event) => setDraft({ ...draft, business: event.target.value })} placeholder="Business name or ID" />
          </label>
          <label>Event
            <input value={draft.event} maxLength={120} onChange={(event) => setDraft({ ...draft, event: event.target.value })} placeholder="Exact event name" />
          </label>
          <label>Actor
            <input value={draft.actor} maxLength={254} onChange={(event) => setDraft({ ...draft, actor: event.target.value })} placeholder="Email or user ID" />
          </label>
          <label>Search
            <input value={draft.search} maxLength={200} onChange={(event) => setDraft({ ...draft, search: event.target.value })} placeholder="Action, Business, actor or details" />
          </label>
          <label>From
            <input type="datetime-local" step="1" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
          </label>
          <label>To
            <input type="datetime-local" step="1" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
            <small className="workspace-muted">Events at the end time itself are not included.</small>
          </label>
        </div>
        <div className="workspace-toolbar">
          <div className="workspace-filter-row">
            <button className="workspace-button primary" type="submit" disabled={loading}>Apply filters</button>
            <button className="workspace-button subtle" type="button" onClick={reset} disabled={loading}>Reset</button>
            <button className="workspace-button subtle" type="button" onClick={refresh} disabled={loading}>Refresh</button>
          </div>
          <button className="workspace-button subtle" type="button" onClick={() => void exportCsv()} disabled={loading || exporting}>{exporting ? 'Preparing CSV…' : 'Export CSV'}</button>
        </div>
      </form>
      {error ? <div className="workspace-banner error">{error}</div> : null}
      {notice ? <div className="workspace-banner success">{notice}</div> : null}
    </section>

    <section className="workspace-panel">
      <div className="workspace-panel-heading">
        <div><h2>Administrator activity</h2><p>{loading ? 'Loading activity…' : `${page.items.length} event${page.items.length === 1 ? '' : 's'} on this page`}</p></div>
        <span className="workspace-status-pill neutral">Page {history.length}</span>
      </div>
      <div className="workspace-table-wrap">
        <table className="workspace-table">
          <thead><tr><th>Time</th><th>Business</th><th>Event</th><th>Actor</th><th>Details</th></tr></thead>
          <tbody>
            {!loading && page.items.map((row) => <tr key={row.id}>
              <td>{formatDate(row.createdAt)}</td>
              <td><strong>{row.tenantName || (row.tenantId ? 'Business record' : 'Platform-wide')}</strong>{row.tenantId ? <small>{row.tenantId}</small> : null}</td>
              <td><strong>{friendlyLabel(row.action)}</strong><small>{row.action}</small></td>
              <td>{row.actorEmail || 'ProcessEdge administrator'}<small>{row.actorUserId}</small></td>
              <td><details><summary>View details</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxWidth: 520, margin: '10px 0 0' }}>{JSON.stringify(row.detail, null, 2)}</pre></details></td>
            </tr>)}
            {loading ? <tr><td colSpan={5}><div className="workspace-empty"><strong>Loading audit log</strong><p>Retrieving the requested administrator activity.</p></div></td></tr> : null}
            {!loading && !page.items.length ? <tr><td colSpan={5}><div className="workspace-empty"><strong>No audit events found</strong><p>Adjust the filters or reset the search.</p></div></td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="workspace-toolbar" style={{ marginTop: 16, marginBottom: 0 }}>
        <button className="workspace-button subtle" type="button" disabled={loading || history.length <= 1} onClick={() => setHistory((current) => current.slice(0, -1))}>Previous</button>
        <p className="workspace-muted small" style={{ margin: 0 }}>Results are ordered newest first. CSV export is capped at the newest 1,000 matching events.</p>
        <button className="workspace-button subtle" type="button" disabled={loading || !page.hasMore || !page.nextCursor} onClick={() => page.nextCursor && setHistory((current) => [...current, page.nextCursor])}>Next</button>
      </div>
    </section>
  </div>;
}

function requestBody(filters: AuditFilters, cursor: AuditCursor | null) {
  return {
    business: clean(filters.business),
    event: clean(filters.event),
    actor: clean(filters.actor),
    search: clean(filters.search),
    from: toIso(filters.from),
    to: toIso(filters.to),
    afterCreatedAt: cursor?.afterCreatedAt ?? null,
    afterId: cursor?.afterId ?? null,
    limit: 50,
  };
}

function normalizePage(value: unknown): AuditPageResult {
  if (!isRecord(value)) throw new Error('Audit explorer returned an invalid response.');
  const source = Array.isArray(value.items) ? value.items : [];
  const items = source.filter(isRecord).map((row) => ({
    id: stringValue(row.id),
    tenantId: nullableString(row.tenantId),
    tenantName: nullableString(row.tenantName),
    action: stringValue(row.action),
    detail: isRecord(row.detail) ? row.detail : {},
    createdAt: stringValue(row.createdAt),
    actorUserId: stringValue(row.actorUserId),
    actorEmail: stringValue(row.actorEmail),
  })).filter((row) => row.id && row.createdAt);
  const next = isRecord(value.nextCursor) && typeof value.nextCursor.afterCreatedAt === 'string' && typeof value.nextCursor.afterId === 'string'
    ? { afterCreatedAt: value.nextCursor.afterCreatedAt, afterId: value.nextCursor.afterId }
    : null;
  return {
    items,
    hasMore: value.hasMore === true,
    nextCursor: next,
    limit: typeof value.limit === 'number' ? value.limit : 50,
    generatedAt: nullableString(value.generatedAt),
  };
}

function clean(value: string): string | null { const result = value.trim(); return result || null; }
function toIso(value: string): string | null { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
function nullableString(value: unknown): string | null { return typeof value === 'string' && value ? value : null; }
function messageFrom(value: unknown, fallback: string): string { return value instanceof Error && value.message ? value.message : fallback; }
function friendlyLabel(value: string): string { return value ? value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase()) : 'Unknown'; }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
