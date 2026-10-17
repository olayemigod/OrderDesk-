import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { errorMessage, supabase } from './supabase';

type Supplier = {
  id: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  isActive: boolean;
};

type SupplierDraft = Omit<Supplier, 'id'>;

const EMPTY_SUPPLIER: SupplierDraft = {
  name: '',
  contactName: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
  isActive: true,
};

export default function SuppliersManagement({ tenantId }: { tenantId: string }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SupplierDraft>(EMPTY_SUPPLIER);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedSupplier = useMemo(
    () => suppliers.find((row) => row.id === selectedSupplierId) ?? null,
    [suppliers, selectedSupplierId],
  );

  useEffect(() => { void loadSuppliers(); }, [tenantId]);

  useEffect(() => {
    if (!selectedSupplier) return;
    setDraft({
      name: selectedSupplier.name,
      contactName: selectedSupplier.contactName,
      phone: selectedSupplier.phone,
      email: selectedSupplier.email,
      address: selectedSupplier.address,
      notes: selectedSupplier.notes,
      isActive: selectedSupplier.isActive,
    });
  }, [selectedSupplier]);

  async function loadSuppliers(preferredSupplierId?: string | null) {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_suppliers', { p_tenant_id: tenantId });
      if (rpcError) throw rpcError;
      const next = ((data ?? []) as Array<Record<string, unknown>>).map(mapSupplier);
      setSuppliers(next);
      const wanted = preferredSupplierId ?? selectedSupplierId;
      setSelectedSupplierId(wanted && next.some((row) => row.id === wanted) ? wanted : next[0]?.id ?? null);
      if (!next.length) setDraft(EMPTY_SUPPLIER);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load suppliers.'));
    } finally {
      setLoading(false);
    }
  }

  function startNewSupplier() {
    setSelectedSupplierId(null);
    setDraft(EMPTY_SUPPLIER);
    setError(null);
    setMessage(null);
  }

  async function saveSupplier(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('save_sellertray_supplier', {
        p_tenant_id: tenantId,
        p_supplier_id: selectedSupplierId,
        p_name: draft.name,
        p_contact_name: clean(draft.contactName),
        p_phone: clean(draft.phone),
        p_email: clean(draft.email),
        p_address: clean(draft.address),
        p_notes: clean(draft.notes),
        p_is_active: draft.isActive,
      });
      if (rpcError) throw rpcError;
      const row = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
      const supplierId = typeof row.supplierId === 'string' ? row.supplierId : selectedSupplierId;
      setMessage(selectedSupplierId ? 'Supplier updated.' : 'Supplier created.');
      await loadSuppliers(supplierId);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to save this supplier.'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <article className="panel"><p className="muted">Loading suppliers…</p></article>;

  return <div className="page-stack purchasing-page">
    <div className="section-heading purchasing-heading">
      <div><p className="eyebrow">Stock</p><h2>Suppliers</h2></div>
      <p className="muted">Manage the suppliers used for Purchase Orders and supplier payments.</p>
    </div>
    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button onClick={() => setMessage(null)}>Dismiss</button></div> : null}
    <div className="purchase-two-column">
      <article className="panel purchase-list-panel">
        <div className="panel-head"><div><p className="eyebrow">Suppliers</p><h3>Supplier directory</h3></div><button className="secondary-button" onClick={startNewSupplier}>New supplier</button></div>
        {suppliers.length ? <div className="device-list">{suppliers.map((row) => <button key={row.id} className={selectedSupplierId === row.id ? 'device-row selected' : 'device-row'} onClick={() => setSelectedSupplierId(row.id)}><span><strong>{row.name}</strong><small>{row.contactName || row.phone || row.email || 'No contact details'}</small></span><span className="device-row-badges"><em className={row.isActive ? 'good' : 'muted'}>{row.isActive ? 'Active' : 'Inactive'}</em></span></button>)}</div> : <div className="empty-state"><strong>No suppliers</strong><p>Add a supplier before creating a Purchase Order.</p></div>}
      </article>
      <form className="panel purchase-form" onSubmit={saveSupplier}>
        <div className="panel-head"><div><p className="eyebrow">Supplier details</p><h3>{selectedSupplier?.name ?? 'New supplier'}</h3></div></div>
        <div className="purchase-field-grid">
          <label>Supplier name<input required value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
          <label>Contact person<input value={draft.contactName} onChange={(event) => setDraft((current) => ({ ...current, contactName: event.target.value }))} /></label>
          <label>Phone<input value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} /></label>
          <label>Email<input type="email" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} /></label>
        </div>
        <label>Address<textarea rows={2} value={draft.address} onChange={(event) => setDraft((current) => ({ ...current, address: event.target.value }))} /></label>
        <label>Notes<textarea rows={3} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
        <label className="settings-toggle"><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))} /><span>Active supplier</span></label>
        <div className="purchase-actions"><button className="primary-button" disabled={busy}>{busy ? 'Saving' : 'Save supplier'}</button></div>
      </form>
    </div>
  </div>;
}

function mapSupplier(row: Record<string, unknown>): Supplier {
  return {
    id: String(row.id ?? row.supplier_id ?? ''),
    name: String(row.name ?? ''),
    contactName: String(row.contact_name ?? ''),
    phone: String(row.phone ?? ''),
    email: String(row.email ?? ''),
    address: String(row.address ?? ''),
    notes: String(row.notes ?? ''),
    isActive: row.is_active !== false,
  };
}

function clean(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}
