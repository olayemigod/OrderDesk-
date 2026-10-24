import { SellerTraySelect, SellerTrayInput } from './SellerTrayElements';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import InventoryCostBasisManagement from './InventoryCostBasisManagement';
import { errorMessage, numberValue, supabase } from './supabase';

type Branch = { id: string; code: string; name: string; isDefault: boolean };
type ValuationRow = {
  catalog_item_id: string;
  item_name: string;
  sku: string | null;
  category: string | null;
  stock_uom: string;
  currency: string;
  quantity_on_hand: number | string;
  valued_quantity_on_hand: number | string;
  unvalued_quantity_on_hand: number | string;
  known_inventory_value: number | string;
  average_unit_cost: number | string | null;
  valuation_status: 'empty' | 'valued' | 'partial' | 'unvalued' | string;
  last_movement_at: string | null;
};

export default function InventoryReportCenter({ tenantId, currency }: { tenantId: string; currency: string }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [asOf, setAsOf] = useState(() => localDateTimeValue(new Date()));
  const [rows, setRows] = useState<ValuationRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void loadBranches(); }, [tenantId]);

  async function loadBranches() {
    setLoading(true); setError(null); setRows([]);
    try {
      const { data, error: branchError } = await supabase.rpc('get_sellertray_accessible_branches', { p_tenant_id: tenantId });
      if (branchError) throw branchError;
      const next = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id ?? ''),
        code: String(row.code ?? ''),
        name: String(row.name ?? 'Branch'),
        isDefault: row.is_default === true,
      } satisfies Branch)).filter((row) => row.id);
      const selected = next.find((row) => row.isDefault)?.id ?? next[0]?.id ?? '';
      setBranches(next); setBranchId(selected);
      if (selected) await loadValuation(selected, asOf);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load inventory valuation.'));
    } finally {
      setLoading(false);
    }
  }

  async function loadValuation(selectedBranchId = branchId, selectedAsOf = asOf) {
    if (!selectedBranchId) { setRows([]); return; }
    const instant = new Date(selectedAsOf);
    if (Number.isNaN(instant.getTime())) { setError('Choose a valid date and time.'); return; }
    setLoading(true); setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_branch_stock_valuation', {
        p_tenant_id: tenantId,
        p_branch_id: selectedBranchId,
        p_as_of: instant.toISOString(),
      });
      if (rpcError) throw rpcError;
      setRows((data ?? []) as ValuationRow[]);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load inventory value for this Branch.'));
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await loadValuation();
  }

  async function chooseBranch(next: string) {
    setBranchId(next);
    await loadValuation(next, asOf);
  }

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => !needle || [row.item_name, row.sku ?? '', row.category ?? ''].some((value) => value.toLowerCase().includes(needle)));
  }, [rows, search]);

  const summary = useMemo(() => rows.reduce((result, row) => {
    const status = row.valuation_status;
    result.knownValue += numberValue(row.known_inventory_value);
    if (status === 'valued') result.valued += 1;
    else if (status === 'partial') result.partial += 1;
    else if (status === 'unvalued') result.unvalued += 1;
    return result;
  }, { knownValue: 0, valued: 0, partial: 0, unvalued: 0 }), [rows]);

  const branch = branches.find((row) => row.id === branchId) ?? null;
  const reportCurrency = rows.find((row) => row.currency)?.currency || currency || 'NGN';

  return <div className="page-stack report-center">
    <div className="section-heading report-heading">
      <div><p className="eyebrow">Inventory valuation</p><h2>Stock value by Branch</h2><p className="muted">Historical values follow the stock ledger's business date and SellerTray's governed moving weighted-average valuation.</p></div>
    </div>

    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}

    <form className="panel product-editor-stack" onSubmit={submit}>
      <div className="form-grid">
        <label className="field">Branch<SellerTraySelect value={branchId} disabled={!branches.length || loading} onChange={(event) => void chooseBranch(event.target.value)}>{branches.map((row) => <option key={row.id} value={row.id}>{row.name}{row.code ? ` · ${row.code}` : ''}</option>)}</SellerTraySelect></label>
        <label className="field">Value as of<SellerTrayInput type="datetime-local" value={asOf} onChange={(event) => setAsOf(event.target.value)} /></label>
        <label className="field">Search<SellerTrayInput value={search} placeholder="Product, SKU or category" onChange={(event) => setSearch(event.target.value)} /></label>
      </div>
      <div className="form-actions"><button className="primary-button" disabled={loading || !branchId}>{loading ? 'Loading…' : 'Run valuation'}</button></div>
    </form>

    <div className="metric-grid">
      <Metric label="Known inventory value" value={money(summary.knownValue, reportCurrency)} note={branch?.name ?? 'Selected Branch'} />
      <Metric label="Fully valued products" value={formatNumber(summary.valued)} note="Complete cost history" />
      <Metric label="Partially valued" value={formatNumber(summary.partial)} note="Some stock lacks cost evidence" />
      <Metric label="Unvalued" value={formatNumber(summary.unvalued)} note="No governed cost evidence" />
    </div>

    {branch ? <InventoryCostBasisManagement tenantId={tenantId} branchId={branch.id} branchName={branch.name} currency={reportCurrency} onChanged={() => loadValuation(branch.id, asOf)} /> : null}

    <article className="panel">
      <div className="panel-head"><div><p className="eyebrow">As-of stock value</p><h3>{branch ? branch.name : 'Inventory valuation'}</h3></div><span className="muted">{asOfLabel(asOf)}</span></div>
      <p className="muted">Known inventory value never invents cost. Partial or unvalued stock stays visible until authoritative purchase-cost history or verified historical cost evidence is available.</p>
      {visibleRows.length ? <div className="table-wrap"><table><thead><tr><th>Product</th><th>On hand</th><th>Valued</th><th>Unvalued</th><th>Average unit cost</th><th>Known value</th><th>Status</th><th>Last movement</th></tr></thead><tbody>
        {visibleRows.map((row) => <tr key={row.catalog_item_id}>
          <td><strong>{row.item_name}</strong><small className="report-subline">{row.sku || 'No SKU'}{row.category ? ` · ${row.category}` : ''}</small></td>
          <td>{formatQuantity(row.quantity_on_hand)} {row.stock_uom}</td>
          <td>{formatQuantity(row.valued_quantity_on_hand)} {row.stock_uom}</td>
          <td className={Math.abs(numberValue(row.unvalued_quantity_on_hand)) > 0.000001 ? 'danger-text' : ''}>{formatQuantity(row.unvalued_quantity_on_hand)} {row.stock_uom}</td>
          <td>{row.average_unit_cost == null ? '—' : money(numberValue(row.average_unit_cost), row.currency || reportCurrency)}</td>
          <td>{money(numberValue(row.known_inventory_value), row.currency || reportCurrency)}</td>
          <td><strong>{statusLabel(row.valuation_status)}</strong></td>
          <td>{row.last_movement_at ? dateTime(row.last_movement_at) : '—'}</td>
        </tr>)}
      </tbody></table></div> : !loading ? <Empty title="No valued stock movements" body="Posted receipts, sales, returns, adjustments and transfers will appear here once the selected Branch has stock history." /> : null}
    </article>
  </div>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }
function Empty({ title, body }: { title: string; body: string }) { return <div className="empty-state"><strong>{title}</strong><p>{body}</p></div>; }
function formatNumber(value: number): string { return new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 }).format(value); }
function formatQuantity(value: number | string): string { return new Intl.NumberFormat('en-NG', { maximumFractionDigits: 3 }).format(numberValue(value)); }
function money(value: number, currency: string): string { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(value); } catch { return `${currency || 'NGN'} ${formatNumber(value)}`; } }
function statusLabel(value: string): string { return value === 'valued' ? 'Valued' : value === 'partial' ? 'Partially valued' : value === 'unvalued' ? 'Unvalued' : value === 'empty' ? 'No stock' : value.replaceAll('_', ' '); }
function dateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function localDateTimeValue(date: Date): string { const offset = date.getTimezoneOffset(); return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16); }
function asOfLabel(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Invalid date' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
