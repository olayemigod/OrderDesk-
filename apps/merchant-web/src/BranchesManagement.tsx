import { useEffect, useMemo, useState, type FormEvent } from 'react';
import BranchRegistersManagement from './BranchRegistersManagement';
import { SellerTrayInput } from './SellerTrayElements';
import { errorMessage, supabase } from './supabase';

type Branch = { id: string; code: string; name: string; isDefault: boolean; isActive: boolean; createdAt: string };
type BranchDraft = { code: string; name: string; isDefault: boolean; isActive: boolean };
type BranchTab = 'overview' | 'registers';
const EMPTY_BRANCH: BranchDraft = { code: '', name: '', isDefault: false, isActive: true };

export default function BranchesManagement({ tenantId, onBranchesChanged }: { tenantId: string; onBranchesChanged?: () => void | Promise<void> }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<BranchDraft>(EMPTY_BRANCH);
  const [activeTab, setActiveTab] = useState<BranchTab>('overview');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selected = branches.find((branch) => branch.id === selectedId) ?? null;
  const activeCount = useMemo(() => branches.filter((branch) => branch.isActive).length, [branches]);

  useEffect(() => { void load(); }, [tenantId]);
  useEffect(() => {
    if (!selected) return;
    setDraft({ code: selected.code, name: selected.name, isDefault: selected.isDefault, isActive: selected.isActive });
  }, [selectedId, selected?.code, selected?.name, selected?.isDefault, selected?.isActive]);

  async function load(preferredId?: string | null) {
    setLoading(true); setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_manageable_branches', { p_tenant_id: tenantId });
      if (rpcError) throw rpcError;
      const next = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id ?? ''), code: String(row.code ?? ''), name: String(row.name ?? 'Branch'),
        isDefault: row.is_default === true, isActive: row.is_active === true, createdAt: String(row.created_at ?? ''),
      } satisfies Branch)).filter((row) => row.id);
      setBranches(next);
      const wanted = preferredId ?? selectedId;
      const nextId = wanted && next.some((row) => row.id === wanted) ? wanted : next.find((row) => row.isDefault)?.id ?? next[0]?.id ?? null;
      setSelectedId(nextId);
      if (!nextId) setDraft(EMPTY_BRANCH);
    } catch (cause) { setError(errorMessage(cause, 'Unable to load Branches.')); }
    finally { setLoading(false); }
  }

  function manageBranch(branchId: string) {
    setSelectedId(branchId);
    setActiveTab('overview');
    setError(null);
    setMessage(null);
  }

  function startNew() {
    setSelectedId(null);
    setDraft(EMPTY_BRANCH);
    setActiveTab('overview');
    setError(null);
    setMessage(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft.code.trim() || !draft.name.trim()) { setError('Enter the Branch code and name.'); return; }
    setSaving(true); setError(null); setMessage(null);
    try {
      const { data, error: saveError } = await supabase.rpc('save_sellertray_branch', {
        p_tenant_id: tenantId, p_branch_id: selectedId, p_code: draft.code, p_name: draft.name,
        p_is_default: draft.isDefault, p_is_active: draft.isActive,
      });
      if (saveError) throw saveError;
      const savedId = typeof data === 'string' ? data : selectedId;
      await load(savedId);
      await onBranchesChanged?.();
      setMessage(selectedId ? 'Branch updated.' : 'Branch created.');
    } catch (cause) { setError(errorMessage(cause, 'Unable to save this Branch.')); }
    finally { setSaving(false); }
  }

  if (loading && branches.length === 0) return <article className="panel">Loading Branches…</article>;

  return <div className="page-stack">
    <div className="section-heading"><div><p className="eyebrow">Business structure</p><h2>Branches</h2></div><div className="topbar-actions"><span className="muted">{activeCount} active</span><button className="primary-button" onClick={startNew}>Add Branch</button></div></div>
    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    <article className="panel">
      <div className="section-heading"><div><p className="eyebrow">Locations</p><h3>Business Branches</h3></div></div>
      {branches.length ? <div className="table-wrap"><table><thead><tr><th>Branch</th><th>Code</th><th>Status</th><th></th></tr></thead><tbody>{branches.map((branch) => <tr key={branch.id}><td><strong>{branch.name}</strong>{branch.isDefault ? <div className="muted">Default Branch</div> : null}</td><td>{branch.code}</td><td>{branch.isActive ? 'Active' : 'Inactive'}</td><td><button className="text-button" onClick={() => manageBranch(branch.id)}>Manage</button></td></tr>)}</tbody></table></div> : <div className="empty-state"><strong>No Branches yet</strong><p>Add the first Branch before assigning staff or running Branch operations.</p></div>}
    </article>

    {selected ? <div className="branch-detail-shell">
      <div className="management-tabs" role="tablist" aria-label={`${selected.name} management`}>
        <button type="button" role="tab" aria-selected={activeTab === 'overview'} className={activeTab === 'overview' ? 'active' : ''} onClick={() => setActiveTab('overview')}>Branch Overview</button>
        <button type="button" role="tab" aria-selected={activeTab === 'registers'} className={activeTab === 'registers' ? 'active' : ''} onClick={() => setActiveTab('registers')}>Registers</button>
      </div>
      {activeTab === 'overview' ? <form className="panel form-stack" onSubmit={save}>
        <div><p className="eyebrow">Branch details</p><h3>{selected.name}</h3><p className="muted">Branch identity is shared by sales, inventory, purchasing, cash, permissions and reporting.</p></div>
        <label>Branch name<SellerTrayInput value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} maxLength={120} required /></label>
        <label>Branch code<SellerTrayInput value={draft.code} onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))} maxLength={40} required /></label>
        <label className="check-row"><SellerTrayInput type="checkbox" checked={draft.isDefault} onChange={(event) => setDraft((current) => ({ ...current, isDefault: event.target.checked }))} /><span>Default Branch</span></label>
        <label className="check-row"><SellerTrayInput type="checkbox" checked={draft.isActive} onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))} /><span>Active</span></label>
        <div className="topbar-actions"><button className="primary-button" disabled={saving}>{saving ? 'Saving' : 'Save Branch'}</button><button type="button" className="secondary-button" onClick={startNew}>Add another</button></div>
      </form> : <BranchRegistersManagement tenantId={tenantId} branchId={selected.id} branchName={selected.name} />}
    </div> : <form className="panel form-stack" onSubmit={save}>
      <div><p className="eyebrow">New Branch</p><h3>Add Branch</h3><p className="muted">Create the Branch first, then manage its sales registers from Branch detail.</p></div>
      <label>Branch name<SellerTrayInput value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} maxLength={120} required /></label>
      <label>Branch code<SellerTrayInput value={draft.code} onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))} maxLength={40} required /></label>
      <label className="check-row"><SellerTrayInput type="checkbox" checked={draft.isDefault} onChange={(event) => setDraft((current) => ({ ...current, isDefault: event.target.checked }))} /><span>Default Branch</span></label>
      <label className="check-row"><SellerTrayInput type="checkbox" checked={draft.isActive} onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))} /><span>Active</span></label>
      <button className="primary-button" disabled={saving}>{saving ? 'Saving' : 'Save Branch'}</button>
    </form>}
  </div>;
}
