import { useEffect, useMemo, useState } from 'react';
import { PurchasePaymentManagement } from './SupplierPaymentManagement';
import { errorMessage, numberValue, supabase } from './supabase';

type PurchaseRow = {
  id: string;
  reference: string;
  status: string;
  branchName: string;
  supplierId: string;
  supplierName: string;
  currency: string;
  totalAmount: number;
  createdAt: string;
};

type SupplierOutstanding = {
  supplierId: string;
  supplierName: string;
  currency: string;
  purchaseTotal: number;
  paidAmount: number;
  outstandingAmount: number;
  purchaseCount: number;
};

export default function SupplierPaymentsCenter({ tenantId }: { tenantId: string }) {
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOutstanding[]>([]);
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(null);
  const [supplierFilter, setSupplierFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh(preferredPurchaseId?: string | null) {
    setLoading(true);
    setError(null);
    try {
      const [purchaseResult, supplierResult] = await Promise.all([
        supabase.rpc('get_sellertray_purchase_orders', {
          p_tenant_id: tenantId,
          p_branch_id: null,
          p_limit: 300,
        }),
        supabase.rpc('get_sellertray_supplier_outstanding_summary', {
          p_tenant_id: tenantId,
        }),
      ]);
      if (purchaseResult.error) throw purchaseResult.error;
      if (supplierResult.error) throw supplierResult.error;

      const nextPurchases = rows(purchaseResult.data)
        .map(mapPurchase)
        .filter((row) => row.id && ['ordered', 'partially_received', 'received'].includes(row.status));
      const nextSuppliers = rows(supplierResult.data).map(mapSupplierOutstanding);
      setPurchases(nextPurchases);
      setSuppliers(nextSuppliers);

      const wanted = preferredPurchaseId ?? selectedPurchaseId;
      setSelectedPurchaseId(
        wanted && nextPurchases.some((row) => row.id === wanted)
          ? wanted
          : nextPurchases[0]?.id ?? null,
      );
    } catch (cause) {
      setPurchases([]);
      setSuppliers([]);
      setSelectedPurchaseId(null);
      setError(errorMessage(cause, 'Unable to load supplier payment records.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [tenantId]);

  const filteredPurchases = useMemo(
    () => supplierFilter ? purchases.filter((row) => row.supplierId === supplierFilter) : purchases,
    [purchases, supplierFilter],
  );
  const selectedPurchase = purchases.find((row) => row.id === selectedPurchaseId) ?? null;
  const totalOutstanding = suppliers.reduce((sum, row) => sum + row.outstandingAmount, 0);
  const totalPaid = suppliers.reduce((sum, row) => sum + row.paidAmount, 0);
  const currency = suppliers.find((row) => row.currency)?.currency ?? selectedPurchase?.currency ?? 'NGN';

  function chooseSupplier(supplierId: string) {
    setSupplierFilter(supplierId);
    const first = purchases.find((row) => !supplierId || row.supplierId === supplierId);
    setSelectedPurchaseId(first?.id ?? null);
  }

  return <div className="page-stack supplier-payments-center">
    <div className="section-heading">
      <div><p className="eyebrow">Purchasing</p><h2>Supplier Payments</h2></div>
      <button className="secondary-button" disabled={loading} onClick={() => void refresh(selectedPurchaseId)}>Refresh</button>
    </div>

    <div className="info-banner">Supplier payment records track commercial settlement only. They do not create accounting entries or change cashier drawer balances.</div>
    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}

    <div className="summary-grid">
      <article className="summary-card"><span>Supplier outstanding</span><strong>{money(totalOutstanding, currency)}</strong><small>Across placed Purchase Orders</small></article>
      <article className="summary-card"><span>Supplier payments</span><strong>{money(totalPaid, currency)}</strong><small>Effective unreversed evidence</small></article>
      <article className="summary-card"><span>Suppliers with purchases</span><strong>{suppliers.filter((row) => row.purchaseCount > 0).length}</strong><small>{purchases.length} placed Purchase Orders</small></article>
    </div>

    <div className="purchase-two-column supplier-payment-center-layout">
      <article className="panel purchase-list-panel">
        <div className="panel-head"><div><p className="eyebrow">Outstanding</p><h3>Suppliers</h3></div></div>
        <button className={!supplierFilter ? 'device-row selected' : 'device-row'} onClick={() => chooseSupplier('')}>
          <span><strong>All suppliers</strong><small>Show all placed purchases</small></span>
          <span className="device-row-badges"><em>{money(totalOutstanding, currency)}</em></span>
        </button>
        <div className="device-list">
          {suppliers.map((row) => <button key={row.supplierId} className={supplierFilter === row.supplierId ? 'device-row selected' : 'device-row'} onClick={() => chooseSupplier(row.supplierId)}>
            <span><strong>{row.supplierName}</strong><small>{row.purchaseCount} placed {row.purchaseCount === 1 ? 'purchase' : 'purchases'} · Paid {money(row.paidAmount, row.currency)}</small></span>
            <span className="device-row-badges"><em className={row.outstandingAmount > 0 ? 'warning' : 'good'}>{money(row.outstandingAmount, row.currency)}</em></span>
          </button>)}
        </div>
      </article>

      <article className="panel purchase-list-panel">
        <div className="panel-head"><div><p className="eyebrow">Purchase Orders</p><h3>Payment allocation</h3></div></div>
        {loading ? <p className="muted">Loading purchases…</p> : filteredPurchases.length ? <div className="purchase-order-list">
          {filteredPurchases.map((row) => <button key={row.id} className={selectedPurchaseId === row.id ? 'purchase-order-row selected' : 'purchase-order-row'} onClick={() => setSelectedPurchaseId(row.id)}>
            <span><strong>{row.reference}</strong><small>{row.supplierName} · {row.branchName}</small></span>
            <span><strong>{money(row.totalAmount, row.currency)}</strong><small>{statusLabel(row.status)} · {date(row.createdAt)}</small></span>
          </button>)}
        </div> : <div className="empty-state"><strong>No placed purchases</strong><p>Place a Purchase Order before recording supplier payment evidence.</p></div>}
      </article>
    </div>

    {selectedPurchase ? <div className="page-stack">
      <div className="section-heading compact-heading"><div><p className="eyebrow">Selected Purchase Order</p><h3>{selectedPurchase.reference}</h3><p className="muted">{selectedPurchase.supplierName} · {selectedPurchase.branchName}</p></div><strong>{money(selectedPurchase.totalAmount, selectedPurchase.currency)}</strong></div>
      <PurchasePaymentManagement tenantId={tenantId} purchaseOrderId={selectedPurchase.id} />
    </div> : null}
  </div>;
}

function mapPurchase(row: Record<string, unknown>): PurchaseRow {
  return {
    id: String(row.id ?? ''),
    reference: String(row.reference ?? 'Purchase Order'),
    status: String(row.status ?? 'draft'),
    branchName: String(row.branch_name ?? 'Branch'),
    supplierId: String(row.supplier_id ?? ''),
    supplierName: String(row.supplier_name ?? 'Supplier'),
    currency: String(row.currency ?? 'NGN'),
    totalAmount: numberValue(row.total_amount),
    createdAt: String(row.created_at ?? ''),
  };
}

function mapSupplierOutstanding(row: Record<string, unknown>): SupplierOutstanding {
  return {
    supplierId: String(row.supplier_id ?? ''),
    supplierName: String(row.supplier_name ?? 'Supplier'),
    currency: String(row.currency ?? 'NGN'),
    purchaseTotal: numberValue(row.purchase_total),
    paidAmount: numberValue(row.paid_amount),
    outstandingAmount: numberValue(row.outstanding_amount),
    purchaseCount: numberValue(row.purchase_count),
  };
}

function rows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.map((item) => item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {})
    : [];
}

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency || 'NGN'} ${value.toFixed(2)}`;
  }
}

function statusLabel(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function date(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(parsed);
}
