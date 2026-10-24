import { useEffect, useState, type FormEvent } from 'react';
import { SellerTrayInput, SellerTraySelect } from './SellerTrayElements';
import { errorMessage, numberValue, supabase } from './supabase';

type Kind = 'category' | 'unit';
type Status = 'active' | 'archived' | 'all';
type Master = { id: string; name: string; isActive: boolean; usageCount: number; protected: boolean; updatedAt: string };

export default function CatalogueMasterManagement({ tenantId, kind }: { tenantId: string; kind: Kind }) {
  const [items, setItems] = useState<Master[]>([]);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Status>('active');
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<Master | null>(null);
  const [editName, setEditName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => { setSearchDraft(''); setSearch(''); setStatus('active'); setEditing(null); setNewName(''); }, [tenantId, kind]);
  useEffect(() => { void load(); }, [tenantId, kind, search, status]);

  async function load() {
    setLoading(true); setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_catalogue_master_management', { p_tenant_id: tenantId, p_kind: kind, p_search: search.trim() || null, p_status: status });
      if (rpcError) throw rpcError;
      const root = object(data);
      setItems(array(root.items).map((value) => { const row = object(value); return { id: String(row.id ?? ''), name: String(row.name ?? ''), isActive: row.isActive === true, usageCount: numberValue(row.usageCount), protected: row.protected === true, updatedAt: String(row.updatedAt ?? '') } satisfies Master; }).filter((item) => item.id));
    } catch (cause) { setError(errorMessage(cause, `Unable to load ${plural(kind)}.`)); }
    finally { setLoading(false); }
  }

  async function create(event: FormEvent) {
    event.preventDefault(); const name = newName.trim(); if (!name || busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const { error: rpcError } = await supabase.rpc('save_sellertray_catalogue_master', { p_tenant_id: tenantId, p_kind: kind, p_master_id: null, p_name: name, p_is_active: true });
      if (rpcError) throw rpcError;
      setNewName(''); await load(); setMessage(`${title(kind)} “${name}” created.`);
    } catch (cause) { setError(errorMessage(cause, `Unable to create this ${kind}.`)); }
    finally { setBusy(false); }
  }

  function beginEdit(item: Master) { setEditing(item); setEditName(item.name); setError(null); setMessage(null); }

  async function saveEdit(event: FormEvent) {
    event.preventDefault(); if (!editing) return;
    const name = editName.trim(); if (!name) { setError(`Enter a ${kind} name.`); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      const { error: rpcError } = await supabase.rpc('save_sellertray_catalogue_master', { p_tenant_id: tenantId, p_kind: kind, p_master_id: editing.id, p_name: name, p_is_active: editing.isActive });
      if (rpcError) throw rpcError;
      setEditing(null); await load(); setMessage(`${title(kind)} updated.`);
    } catch (cause) { setError(errorMessage(cause, `Unable to update this ${kind}.`)); }
    finally { setBusy(false); }
  }

  async function setActive(item: Master, active: boolean) {
    setBusy(true); setError(null); setMessage(null);
    try {
      const { error: rpcError } = await supabase.rpc('save_sellertray_catalogue_master', { p_tenant_id: tenantId, p_kind: kind, p_master_id: item.id, p_name: item.name, p_is_active: active });
      if (rpcError) throw rpcError;
      if (editing?.id === item.id) setEditing(null);
      await load(); setMessage(active ? `${title(kind)} restored.` : `${title(kind)} archived.`);
    } catch (cause) { setError(errorMessage(cause, `Unable to ${active ? 'restore' : 'archive'} this ${kind}.`)); }
    finally { setBusy(false); }
  }

  function applySearch(event: FormEvent) { event.preventDefault(); setSearch(searchDraft.trim()); }
  const label = kind === 'category' ? 'Categories' : 'Units';
  const note = kind === 'category'
    ? 'Reusable Product Categories shared across SellerTray. Rename updates current Product classification; referenced Categories must be reassigned before archive.'
    : 'Reusable Business Units shared across Product and commerce setup. Referenced Units cannot be renamed or archived because Stock-UOM history must remain stable.';

  return <div className="page-stack catalogue-master-management">
    <div className="section-heading"><div><p className="eyebrow">Catalogue & Inventory</p><h2>{label}</h2></div><p className="muted">{note}</p></div>
    {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button type="button" onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    <form className="panel product-editor-stack" onSubmit={create}><div className="panel-head"><div><p className="eyebrow">Create</p><h3>Add {title(kind)}</h3></div></div><div className="form-grid"><label className="field"><span>Name</span><SellerTrayInput value={newName} maxLength={kind === 'category' ? 120 : 80} onChange={(event) => setNewName(event.target.value)} placeholder={kind === 'category' ? 'e.g. Beverages' : 'e.g. Carton'} /></label></div><div className="form-actions"><button className="primary-button" disabled={busy || !newName.trim()}>{busy ? 'Saving…' : `Add ${title(kind)}`}</button></div></form>

    <section className="panel"><div className="panel-head"><div><p className="eyebrow">Master data</p><h3>{label}</h3></div><span className="muted">{loading ? 'Refreshing…' : `${items.length} shown`}</span></div><form className="form-grid" onSubmit={applySearch}><label className="field"><span>Search</span><SellerTrayInput value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder={`Search ${label.toLowerCase()}`} /></label><label className="field"><span>Status</span><SellerTraySelect value={status} onChange={(event) => setStatus(event.target.value as Status)}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></SellerTraySelect></label><div className="field"><span>Filters</span><button className="secondary-button" disabled={loading}>Apply filters</button></div></form>
      <div className="table-wrap"><table><thead><tr><th>Name</th><th>Status</th><th>Product use</th><th>Governance</th><th>Updated</th><th>Action</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td><span className={item.isActive ? 'status-pill good' : 'status-pill neutral'}>{item.isActive ? 'Active' : 'Archived'}</span></td><td>{item.usageCount}</td><td>{item.protected ? 'Protected default' : item.usageCount ? 'Referenced' : 'Available'}</td><td>{dateOnly(item.updatedAt)}</td><td><div className="form-actions"><button className="text-button" type="button" disabled={busy || item.protected} onClick={() => beginEdit(item)}>Rename</button>{item.isActive ? <button className="text-button" type="button" disabled={busy || item.protected || item.usageCount > 0} onClick={() => void setActive(item, false)}>Archive</button> : <button className="text-button" type="button" disabled={busy} onClick={() => void setActive(item, true)}>Restore</button>}</div></td></tr>)}</tbody></table></div>
      {!loading && !items.length ? <div className="empty-state"><strong>No {label.toLowerCase()} found</strong><p>Change the filters or create a new {kind}.</p></div> : null}
    </section>

    {editing ? <form className="panel product-editor-stack" onSubmit={saveEdit}><div className="panel-head"><div><p className="eyebrow">Rename</p><h3>{editing.name}</h3><p className="muted">{kind === 'unit' && editing.usageCount ? 'Referenced Units cannot be renamed; migrate Product configuration first.' : 'The change is audited and remains scoped to this Business.'}</p></div><button type="button" className="text-button" disabled={busy} onClick={() => setEditing(null)}>Close</button></div><div className="form-grid"><label className="field"><span>New name</span><SellerTrayInput required value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={kind === 'category' ? 120 : 80} /></label></div><div className="form-actions"><button className="primary-button" disabled={busy || !editName.trim() || (kind === 'unit' && editing.usageCount > 0)}>{busy ? 'Saving…' : 'Save name'}</button></div></form> : null}
  </div>;
}

function title(kind: Kind) { return kind === 'category' ? 'Category' : 'Unit'; }
function plural(kind: Kind) { return kind === 'category' ? 'categories' : 'units'; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function dateOnly(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(date); }
