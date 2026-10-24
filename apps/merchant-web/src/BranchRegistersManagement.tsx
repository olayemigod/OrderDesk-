import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { SellerTrayInput } from './SellerTrayElements';
import { errorMessage, supabase } from './supabase';

type Register = {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
};

type RegisterDraft = {
  code: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
};

const EMPTY_REGISTER: RegisterDraft = { code: '', name: '', isDefault: false, isActive: true };

export default function BranchRegistersManagement({
  tenantId,
  branchId,
  branchName,
}: {
  tenantId: string;
  branchId: string;
  branchName: string;
}) {
  const [registers, setRegisters] = useState<Register[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RegisterDraft>(EMPTY_REGISTER);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selected = useMemo(() => registers.find((row) => row.id === selectedId) ?? null, [registers, selectedId]);
  const activeCount = useMemo(() => registers.filter((row) => row.isActive).length, [registers]);

  useEffect(() => {
    setSelectedId(null);
    setDraft(EMPTY_REGISTER);
    void load();
  }, [tenantId, branchId]);

  useEffect(() => {
    if (!selected) return;
    setDraft({
      code: selected.code,
      name: selected.name,
      isDefault: selected.isDefault,
      isActive: selected.isActive,
    });
  }, [selected]);

  async function load(preferredId?: string | null) {
    if (!tenantId || !branchId) {
      setRegisters([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_device_management_overview', {
        p_tenant_id: tenantId,
        p_branch_id: branchId,
      });
      if (rpcError) throw rpcError;
      const root = object(data);
      const next = Array.isArray(root.registers)
        ? root.registers.map((item) => {
          const row = object(item);
          return {
            id: String(row.id ?? ''),
            code: String(row.code ?? ''),
            name: String(row.name ?? 'Register'),
            isDefault: row.isDefault === true,
            isActive: row.isActive === true,
          } satisfies Register;
        }).filter((row) => row.id)
        : [];
      setRegisters(next);
      const wanted = preferredId ?? selectedId;
      const nextId = wanted && next.some((row) => row.id === wanted)
        ? wanted
        : next.find((row) => row.isDefault)?.id ?? next[0]?.id ?? null;
      setSelectedId(nextId);
      if (!nextId) setDraft({ ...EMPTY_REGISTER, isDefault: true });
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load this Branch\'s registers.'));
    } finally {
      setLoading(false);
    }
  }

  function startNew() {
    setSelectedId(null);
    setDraft({ ...EMPTY_REGISTER, isDefault: registers.length === 0 });
    setError(null);
    setMessage(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft.code.trim() || !draft.name.trim()) {
      setError('Enter the register code and name.');
      return;
    }
    if (selected?.isDefault && !draft.isActive) {
      setError('Choose another default register before deactivating this one.');
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('save_sellertray_register', {
        p_tenant_id: tenantId,
        p_register_id: selectedId,
        p_branch_id: branchId,
        p_code: draft.code.trim().toUpperCase(),
        p_name: draft.name.trim(),
        p_is_default: draft.isDefault,
        p_is_active: draft.isDefault ? true : draft.isActive,
      });
      if (rpcError) throw rpcError;
      const saved = object(data);
      const savedId = typeof saved.registerId === 'string' ? saved.registerId : selectedId;
      await load(savedId);
      setMessage(selectedId ? 'Register updated.' : 'Register created.');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to save this register.'));
    } finally {
      setSaving(false);
    }
  }

  if (!branchId) return null;

  return <div className="page-stack branch-registers">
    <div className="section-heading">
      <div><p className="eyebrow">{branchName}</p><h3>Registers</h3></div>
      <div className="topbar-actions"><span className="muted">{activeCount} active</span><button type="button" className="secondary-button" onClick={startNew}>Add register</button></div>
    </div>
    <p className="muted">Registers belong to this Branch. Printer assignment can read these registers, but register lifecycle management stays here.</p>
    {error ? <div className="error-banner compact">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner compact">{message}<button type="button" onClick={() => setMessage(null)}>Dismiss</button></div> : null}
    <div className="two-column">
      <article className="panel">
        {loading ? <p className="muted">Loading registers…</p> : registers.length ? <div className="table-wrap"><table><thead><tr><th>Register</th><th>Code</th><th>Status</th><th></th></tr></thead><tbody>{registers.map((row) => <tr key={row.id}><td><strong>{row.name}</strong>{row.isDefault ? <div className="muted">Default register</div> : null}</td><td>{row.code}</td><td>{row.isActive ? 'Active' : 'Inactive'}</td><td><button type="button" className="text-button" onClick={() => setSelectedId(row.id)}>Manage</button></td></tr>)}</tbody></table></div> : <div className="empty-state"><strong>No registers yet</strong><p>Add the first sales register for this Branch.</p></div>}
      </article>
      <form className="panel form-stack" onSubmit={save}>
        <div><p className="eyebrow">{selected ? 'Register details' : 'New register'}</p><h3>{selected ? selected.name : 'Add register'}</h3></div>
        <label>Register name<SellerTrayInput required maxLength={120} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
        <label>Register code<SellerTrayInput required maxLength={40} value={draft.code} onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value.toUpperCase() }))} /></label>
        <label className="check-row"><SellerTrayInput type="checkbox" checked={draft.isDefault} onChange={(event) => setDraft((current) => ({ ...current, isDefault: event.target.checked, isActive: event.target.checked ? true : current.isActive }))} /><span>Default register</span></label>
        <label className="check-row"><SellerTrayInput type="checkbox" checked={draft.isActive} disabled={draft.isDefault} onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))} /><span>Active</span></label>
        <div className="topbar-actions"><button className="primary-button" disabled={saving}>{saving ? 'Saving' : 'Save register'}</button>{selected ? <button type="button" className="secondary-button" onClick={startNew}>Add another</button> : null}</div>
      </form>
    </div>
  </div>;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
