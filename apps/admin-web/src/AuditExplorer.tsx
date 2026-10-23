import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import MerchantSelector from './MerchantSelector';
import { invokeJson } from './supabase';

type Cursor = { afterCreatedAt: string; afterId: string };
type AuditRow = { id: string; createdAt: string; tenantName: string | null; tenantId: string | null; action: string; actorEmail: string; actorUserId: string; detail: Record<string, unknown> };
type Page = { items: AuditRow[]; hasMore: boolean; nextCursor: Cursor | null };
type Filters = { tenantId: string | null; event: string; actor: string; search: string; from: string; to: string };
const emptyFilters: Filters = { tenantId: null, event: '', actor: '', search: '', from: '', to: '' };
const message = (error: unknown) => error instanceof Error ? error.message : 'Unable to retrieve audit events. Please retry.';

export default function AuditExplorer({ session }: { session: Session }) {
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [history, setHistory] = useState<Cursor[]>([]);
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const sequence = useRef(0);
  const exportSequence = useRef(0);
  const cursor = history.at(-1);

  useEffect(() => {
    const request = ++sequence.current;
    ++exportSequence.current;
    setExporting(false);
    setLoading(true);
    setError('');
    setNotice('');
    setPage(null);
    void invokeJson<{ page: Page }>('platform-admin', { action: 'audit_explorer', ...filters, ...cursor, limit: 50 }, session)
      .then(result => { if (sequence.current === request) setPage(result.page); })
      .catch(cause => { if (sequence.current === request) setError(message(cause)); })
      .finally(() => { if (sequence.current === request) setLoading(false); });
    return () => { ++sequence.current; ++exportSequence.current; };
  }, [session.access_token, filters, cursor, refresh]);

  function apply(event: FormEvent) {
    event.preventDefault();
    if (draft.from && draft.to && draft.from >= draft.to) { setError('From must precede To.'); return; }
    setFilters({ ...draft, from: draft.from ? new Date(draft.from).toISOString() : '', to: draft.to ? new Date(draft.to).toISOString() : '' });
    setHistory([]);
  }

  async function download() {
    const request = ++exportSequence.current;
    setExporting(true); setError(''); setNotice('');
    try {
      const result = await invokeJson<{ csv: string; count: number; truncated: boolean }>('platform-admin', { action: 'audit_export', ...filters }, session);
      if (request !== exportSequence.current) return;
      const url = URL.createObjectURL(new Blob([result.csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = 'sellertray-audit.csv'; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`${result.count} records exported.${result.truncated ? ' Limited to the newest 1,000 matching records. Narrow the filters for a smaller export.' : ''}`);
    } catch (cause) { if (request === exportSequence.current) setError(message(cause)); }
    finally { if (request === exportSequence.current) setExporting(false); }
  }

  return <div className="workspace-page">
    <header className="workspace-page-header"><div><p className="workspace-eyebrow">Audit</p><h1>Privileged activity</h1><p>Search administrator activity across businesses. Dates use your local time; To is exclusive. Apply filters before exporting. Export includes the newest 1,000 matching records.</p></div></header>
    <section className="workspace-panel">
      <h2>Business</h2>
      <MerchantSelector session={session} selectedIds={new Set(draft.tenantId ? [draft.tenantId] : [])} onChange={ids => setDraft(value => ({ ...value, tenantId: [...ids][0] ?? null }))} mode="single" showCommercialPortfolio={false} showAgreementLifecycle={false} />
      <button type="button" className="workspace-button subtle compact" onClick={() => setDraft(value => ({ ...value, tenantId: null }))}>All businesses</button>
      <form onSubmit={apply} className="workspace-form-stack">
        <div className="workspace-field-grid two">
          {(['event', 'actor', 'search'] as const).map(key => <label className="workspace-field" key={key}>{key === 'event' ? 'Event (exact name)' : key === 'actor' ? 'Actor (email or ID)' : 'Search'}<input maxLength={key === 'actor' ? 254 : key === 'event' ? 120 : 200} value={draft[key]} onChange={event => setDraft(value => ({ ...value, [key]: event.target.value }))} /></label>)}
          {(['from', 'to'] as const).map(key => <label className="workspace-field" key={key}>{key === 'from' ? 'From' : 'To'}<input type="datetime-local" value={draft[key]} onChange={event => setDraft(value => ({ ...value, [key]: event.target.value }))} /></label>)}
        </div>
        <div className="workspace-toolbar"><button className="workspace-button primary" type="submit">Apply filters</button><button type="button" className="workspace-button subtle" onClick={() => { setDraft(emptyFilters); setFilters({ ...emptyFilters }); setHistory([]); }}>Reset</button></div>
      </form>
    </section>
    <section className="workspace-panel" aria-busy={loading}>
      <div className="workspace-toolbar"><button className="workspace-button subtle" disabled={loading} onClick={() => { setHistory([]); setRefresh(value => value + 1); }}>Refresh</button><button className="workspace-button primary" disabled={loading || exporting || !page} onClick={() => void download()}>{exporting ? 'Exporting…' : 'Export CSV'}</button><span>50 records per page · page {history.length + 1}</span></div>
      {error && <div className="workspace-banner error" role="alert">{error}</div>}
      {notice && <div className="workspace-banner" role="status">{notice}</div>}
      {loading ? <p role="status">Loading audit events…</p> : <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Time</th><th>Business</th><th>Event</th><th>Actor</th><th>Details</th></tr></thead><tbody>
        {page?.items.map(row => <tr key={row.id}><td>{new Date(row.createdAt).toLocaleString()}</td><td>{row.tenantName ?? (row.tenantId || 'Platform-wide')}</td><td>{row.action}</td><td>{row.actorEmail || row.actorUserId}</td><td><details><summary>View details</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(row.detail, null, 2)}</pre><small>{row.id}</small></details></td></tr>)}
        {page && !page.items.length && <tr><td colSpan={5}>No audit events found. Adjust the filters and try again.</td></tr>}
      </tbody></table></div>}
      <div className="workspace-toolbar"><button className="workspace-button subtle" disabled={loading || !history.length} onClick={() => setHistory(value => value.slice(0, -1))}>Previous</button><button className="workspace-button subtle" disabled={loading || !page?.hasMore || !page.nextCursor} onClick={() => { if (page?.nextCursor) setHistory(value => [...value, page.nextCursor!]); }}>Next</button></div>
    </section>
  </div>;
}
