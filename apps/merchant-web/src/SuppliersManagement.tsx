import { SellerTrayInput, SellerTraySelect, SellerTrayTextarea } from './SellerTrayElements';
import { useEffect, useState, type FormEvent } from 'react';
import { errorMessage, numberValue, supabase } from './supabase';

type Supplier = {
  id: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  isActive: boolean;
  purchaseCount: number;
  openPurchaseCount: number;
  purchaseTotal: number;
  paidAmount: number;
  outstandingAmount: number;
  lastPurchaseAt: string | null;
};

type PurchaseHistory = {
  purchaseOrderId: string;
  reference: string;
  status: string;
  branchName: string;
  currency: string;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  createdAt: string;
};

type SupplierDetail = Supplier & { purchaseHistory: PurchaseHistory[] };
type SupplierDraft = Pick<Supplier, 'name' | 'contactName' | 'phone' | 'email' | 'address' | 'notes' | 'isActive'>;
type SupplierStatus = 'all' | 'active' | 'inactive';

const PAGE_SIZE = 30;
const EMPTY_SUPPLIER: SupplierDraft = { name: '', contactName: '', phone: '', email: '', address: '', notes: '', isActive: true };

export default function SuppliersManagement({ tenantId, currency }: { tenantId: string; currency: string }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<SupplierDetail | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [draft, setDraft] = useState<SupplierDraft>(EMPTY_SUPPLIER);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<SupplierStatus>('all');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [filteredOutstanding, setFilteredOutstanding] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setQuery('');
    setStatusFilter('all');
    setPage(0);
    setSelectedSupplierId(null);
    setSelectedDetail(null);
    setIsNew(false);
  }, [tenantId]);

  useEffect(() => { setPage(0); }, [query, statusFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadSuppliers(); }, query.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [tenantId, query, statusFilter, page]);

  useEffect(() => {
    if (selectedSupplierId) void loadSupplierDetail(selectedSupplierId);
  }, [selectedSupplierId]);

  async function loadSuppliers(preferredSupplierId?: string | null, search = query, status = statusFilter, requestedPage = page) {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_suppliers_management_list', {
        p_tenant_id: tenantId,
        p_search: search.trim() || null,
        p_status: status === 'all' ? null : status,
        p_limit: PAGE_SIZE,
        p_offset: requestedPage * PAGE_SIZE,
      });
      if (rpcError) throw rpcError;
      const payload = (data ?? {}) as Record<string, unknown>;
      const next = (Array.isArray(payload.items) ? payload.items : []).map((row) => mapSupplier(row as Record<string, unknown>));
      const nextTotal = numberValue(payload.totalCount);
      setSuppliers(next);
      setTotalCount(nextTotal);
      setFilteredOutstanding(numberValue(payload.outstandingAmount));
      const wanted = preferredSupplierId ?? selectedSupplierId;
      if (preferredSupplierId && next.some((row) => row.id === preferredSupplierId)) {
        setIsNew(false);
        setSelectedSupplierId(preferredSupplierId);
      } else if (!isNew && (!wanted || !next.some((row) => row.id === wanted))) {
        setSelectedSupplierId(next[0]?.id ?? null);
        if (!next.length) setSelectedDetail(null);
      }
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load suppliers.'));
    } finally {
      setLoading(false);
    }
  }

  async function loadSupplierDetail(supplierId: string) {
    setDetailLoading(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_supplier_management_detail', { p_tenant_id: tenantId, p_supplier_id: supplierId });
      if (rpcError) throw rpcError;
      const detail = mapSupplierDetail((data ?? {}) as Record<string, unknown>);
      setSelectedDetail(detail);
      setDraft({ name: detail.name, contactName: detail.contactName, phone: detail.phone, email: detail.email, address: detail.address, notes: detail.notes, isActive: detail.isActive });
      setIsNew(false);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load this supplier.'));
    } finally {
      setDetailLoading(false);
    }
  }

  function selectSupplier(id: string) {
    setIsNew(false);
    setSelectedSupplierId(id);
    setError(null);
    setMessage(null);
  }

  function startNewSupplier() {
    setIsNew(true);
    setSelectedSupplierId(null);
    setSelectedDetail(null);
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
      setQuery('');
      setStatusFilter('all');
      setPage(0);
      setIsNew(false);
      await loadSuppliers(supplierId, '', 'all', 0);
      if (supplierId) await loadSupplierDetail(supplierId);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to save this supplier.'));
    } finally {
      setBusy(false);
    }
  }

  const pageStart = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const pageEnd = Math.min((page + 1) * PAGE_SIZE, totalCount);

  return <div className="page-stack purchasing-page">
    <div className="section-heading purchasing-heading">
      <div><p className="eyebrow">Purchasing</p><h2>Suppliers</h2></div>
      <p className="muted">Maintain supplier records, review purchasing history and monitor outstanding supplier obligations.</p>
    </div>
    {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button type="button" onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    <div className="metric-grid">
      <article className="metric-card"><span>Suppliers</span><strong>{totalCount}</strong><small>Matching the current search and status</small></article>
      <article className="metric-card"><span>Outstanding</span><strong>{money(filteredOutstanding, currency)}</strong><small>Placed purchases less effective supplier payments</small></article>
      <article className="metric-card"><span>Selected supplier</span><strong>{selectedDetail?.purchaseCount ?? 0}</strong><small>Placed Purchase Orders for the selected supplier</small></article>
      <article className="metric-card"><span>Open Purchase Orders</span><strong>{selectedDetail?.openPurchaseCount ?? 0}</strong><small>Placed or partially received for the selected supplier</small></article>
    </div>

    <div className="purchase-two-column">
      <article className="panel purchase-list-panel">
        <div className="panel-head"><div><p className="eyebrow">Suppliers</p><h3>Supplier directory</h3></div><button type="button" className="secondary-button" onClick={startNewSupplier}>New supplier</button></div>
        <div className="purchase-field-grid">
          <label>Search<SellerTrayInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, contact, phone or email" /></label>
          <label>Status<SellerTraySelect value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as SupplierStatus)}><option value="all">All suppliers</option><option value="active">Active</option><option value="inactive">Inactive</option></SellerTraySelect></label>
        </div>
        {loading ? <div className="empty-state"><p>Loading suppliers…</p></div> : suppliers.length ? <div className="device-list">{suppliers.map((row) => <button key={row.id} type="button" className={selectedSupplierId === row.id ? 'device-row selected' : 'device-row'} onClick={() => selectSupplier(row.id)}><span><strong>{row.name}</strong><small>{row.contactName || row.phone || row.email || 'No contact details'}</small></span><span className="device-row-badges"><em className={row.isActive ? 'good' : 'muted'}>{row.isActive ? 'Active' : 'Inactive'}</em><small>{money(row.outstandingAmount, currency)} due</small></span></button>)}</div> : <div className="empty-state"><strong>No matching suppliers</strong><p>Adjust the search or status filter, or add a supplier.</p></div>}
        <div className="toolbar-row"><span className="muted-copy">{pageStart}–{pageEnd} of {totalCount}</span><div className="topbar-actions"><button type="button" className="text-button" disabled={loading || page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</button><button type="button" className="text-button" disabled={loading || pageEnd >= totalCount} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
      </article>

      <form className="panel purchase-form" onSubmit={saveSupplier}>
        <div className="panel-head"><div><p className="eyebrow">Supplier details</p><h3>{isNew ? 'New supplier' : selectedDetail?.name ?? 'Select a supplier'}</h3></div>{selectedDetail ? <span className={selectedDetail.isActive ? 'status-chip success' : 'status-chip'}>{selectedDetail.isActive ? 'Active' : 'Inactive'}</span> : null}</div>
        {detailLoading ? <div className="empty-state"><p>Loading supplier details…</p></div> : null}
        {selectedDetail && !detailLoading ? <div className="status-grid"><div className="status-stat"><span>Purchase value</span><strong>{money(selectedDetail.purchaseTotal, currency)}</strong></div><div className="status-stat"><span>Paid</span><strong>{money(selectedDetail.paidAmount, currency)}</strong></div><div className="status-stat"><span>Outstanding</span><strong>{money(selectedDetail.outstandingAmount, currency)}</strong></div><div className="status-stat"><span>Purchase Orders</span><strong>{selectedDetail.purchaseCount}</strong></div></div> : null}
        <div className="purchase-field-grid">
          <label>Supplier name<SellerTrayInput required value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
          <label>Contact person<SellerTrayInput value={draft.contactName} onChange={(event) => setDraft((current) => ({ ...current, contactName: event.target.value }))} /></label>
          <label>Phone<SellerTrayInput value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} /></label>
          <label>Email<SellerTrayInput type="email" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} /></label>
        </div>
        <label>Address<SellerTrayTextarea rows={2} value={draft.address} onChange={(event) => setDraft((current) => ({ ...current, address: event.target.value }))} /></label>
        <label>Notes<SellerTrayTextarea rows={3} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
        <label className="settings-toggle"><SellerTrayInput type="checkbox" checked={draft.isActive} onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))} /><span>Active supplier</span></label>
        <div className="purchase-actions"><button className="primary-button" disabled={busy || (!isNew && !selectedSupplierId)}>{busy ? 'Saving' : 'Save supplier'}</button></div>

        {selectedDetail && !detailLoading ? <section className="page-stack">
          <div className="section-heading"><div><p className="eyebrow">Purchasing history</p><h4>Recent Purchase Orders</h4></div><p className="muted">Latest 100 Purchase Orders. Draft and cancelled records remain visible without being treated as supplier obligations.</p></div>
          {selectedDetail.purchaseHistory.length ? <div className="table-wrap"><table><thead><tr><th>Purchase Order</th><th>Branch</th><th>Status</th><th>Total</th><th>Outstanding</th><th>Date</th></tr></thead><tbody>{selectedDetail.purchaseHistory.map((row) => <tr key={row.purchaseOrderId}><td><strong>{row.reference}</strong></td><td>{row.branchName}</td><td>{statusLabel(row.status)}</td><td>{money(row.totalAmount, row.currency || currency)}</td><td>{isPayableStatus(row.status) ? money(row.outstandingAmount, row.currency || currency) : '—'}</td><td>{dateTime(row.createdAt)}</td></tr>)}</tbody></table></div> : <div className="empty-state"><strong>No Purchase Orders yet</strong><p>This supplier has no purchasing history.</p></div>}
        </section> : null}
      </form>
    </div>
  </div>;
}

function mapSupplier(row: Record<string, unknown>): Supplier {
  return {
    id: String(row.id ?? row.supplier_id ?? ''),
    name: String(row.name ?? ''),
    contactName: String(row.contactName ?? row.contact_name ?? ''),
    phone: String(row.phone ?? ''),
    email: String(row.email ?? ''),
    address: String(row.address ?? ''),
    notes: String(row.notes ?? ''),
    isActive: (row.isActive ?? row.is_active) !== false,
    purchaseCount: numberValue(row.purchaseCount ?? row.purchase_count),
    openPurchaseCount: numberValue(row.openPurchaseCount ?? row.open_purchase_count),
    purchaseTotal: numberValue(row.purchaseTotal ?? row.purchase_total),
    paidAmount: numberValue(row.paidAmount ?? row.paid_amount),
    outstandingAmount: numberValue(row.outstandingAmount ?? row.outstanding_amount),
    lastPurchaseAt: typeof (row.lastPurchaseAt ?? row.last_purchase_at) === 'string' ? String(row.lastPurchaseAt ?? row.last_purchase_at) : null,
  };
}

function mapSupplierDetail(row: Record<string, unknown>): SupplierDetail {
  const supplier = mapSupplier(row);
  const purchaseHistory = Array.isArray(row.purchaseHistory) ? row.purchaseHistory.map((raw) => {
    const history = raw as Record<string, unknown>;
    return {
      purchaseOrderId: String(history.purchaseOrderId ?? ''),
      reference: String(history.reference ?? 'Purchase Order'),
      status: String(history.status ?? 'draft'),
      branchName: String(history.branchName ?? 'Branch'),
      currency: String(history.currency ?? 'NGN'),
      totalAmount: numberValue(history.totalAmount),
      paidAmount: numberValue(history.paidAmount),
      outstandingAmount: numberValue(history.outstandingAmount),
      createdAt: String(history.createdAt ?? ''),
    };
  }) : [];
  return { ...supplier, purchaseHistory };
}

function clean(value: string) { const trimmed = value.trim(); return trimmed || null; }
function statusLabel(value: string) { return value === 'ordered' ? 'Placed' : value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function isPayableStatus(value: string) { return ['ordered', 'partially_received', 'received'].includes(value); }
function money(value: number, currency: string) { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(value); } catch { return `${currency || 'NGN'} ${value.toFixed(2)}`; } }
function dateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(date); }
