import { useEffect, useState, type FormEvent } from 'react';
import { errorMessage, numberValue, supabase } from './supabase';

type CostBasisRow = {
  movement_id: string;
  catalog_item_id: string;
  item_name: string;
  sku: string | null;
  movement_type: string;
  quantity_delta: number | string;
  stock_uom: string;
  business_at: string;
  reference_type: string;
  reference_id: string;
  valuation_source: string | null;
  current_evidence_id: string | null;
  current_stock_unit_cost: number | string | null;
  currency: string;
  evidence_reference: string | null;
  evidence_reason: string | null;
  evidence_created_at: string | null;
};

type AuthorityRow = { can_manage_historical_cost: boolean };

type Props = {
  tenantId: string;
  branchId: string;
  branchName: string;
  currency: string;
  onChanged: () => Promise<void> | void;
};

export default function InventoryCostBasisManagement({ tenantId, branchId, branchName, currency, onChanged }: Props) {
  const [rows, setRows] = useState<CostBasisRow[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [editing, setEditing] = useState<CostBasisRow | null>(null);
  const [unitCost, setUnitCost] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setEditing(null); setMessage(null); setError(null);
    if (branchId) void load();
    else setRows([]);
  }, [tenantId, branchId]);

  async function load() {
    if (!branchId) return;
    setLoading(true); setError(null);
    try {
      const [authorityResult, candidateResult] = await Promise.all([
        supabase.rpc('get_sellertray_inventory_valuation_authority', { p_tenant_id: tenantId, p_branch_id: branchId }),
        supabase.rpc('get_sellertray_inventory_cost_basis_candidates', { p_tenant_id: tenantId, p_branch_id: branchId, p_limit: 200 }),
      ]);
      if (authorityResult.error) throw authorityResult.error;
      if (candidateResult.error) throw candidateResult.error;
      const authority = (Array.isArray(authorityResult.data) ? authorityResult.data[0] : authorityResult.data) as AuthorityRow | null;
      setCanManage(authority?.can_manage_historical_cost === true);
      setRows((candidateResult.data ?? []) as CostBasisRow[]);
    } catch (cause) {
      setRows([]); setCanManage(false);
      setError(errorMessage(cause, 'Unable to load historical inventory cost evidence.'));
    } finally {
      setLoading(false);
    }
  }

  function beginEdit(row: CostBasisRow) {
    setEditing(row);
    setUnitCost(row.current_stock_unit_cost == null ? '' : String(numberValue(row.current_stock_unit_cost)));
    setReference(row.evidence_reference ?? '');
    setReason('');
    setError(null); setMessage(null);
  }

  function closeEditor() {
    if (busy) return;
    setEditing(null); setUnitCost(''); setReference(''); setReason('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing || !canManage) return;
    const cost = Number(unitCost);
    const nextReference = reference.trim();
    const nextReason = reason.trim();
    if (!Number.isFinite(cost) || cost < 0) { setError('Enter a valid cost per Stock UOM.'); return; }
    if (!nextReference) { setError('Enter the invoice, count sheet, opening-stock schedule or other evidence reference.'); return; }
    if (!nextReason) { setError('Enter an audit reason explaining why this historical cost is authoritative.'); return; }

    setBusy(true); setError(null); setMessage(null);
    try {
      const commandId = crypto.randomUUID();
      const { error: rpcError } = await supabase.rpc('record_sellertray_inventory_cost_basis', {
        p_tenant_id: tenantId,
        p_inventory_movement_id: editing.movement_id,
        p_stock_unit_cost: cost,
        p_reference: nextReference,
        p_reason: nextReason,
        p_command_id: commandId,
        p_supersedes_evidence_id: editing.current_evidence_id,
      });
      if (rpcError) throw rpcError;
      setEditing(null); setUnitCost(''); setReference(''); setReason('');
      setMessage(editing.current_evidence_id ? 'Historical cost basis corrected and valuation replayed.' : 'Historical cost evidence recorded and valuation replayed.');
      await load();
      await onChanged();
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to record historical inventory cost evidence.'));
    } finally {
      setBusy(false);
    }
  }

  return <article className="panel">
    <div className="panel-head">
      <div>
        <p className="eyebrow">Historical cost evidence</p>
        <h3>Resolve unvalued inventory</h3>
        <p className="muted">Attach verified historical cost to an eligible inbound stock event in {branchName}. Quantity is never changed. SellerTray replays valuation from the original business date, so historical COGS and profitability may change.</p>
      </div>
      <button className="text-button" type="button" disabled={loading || busy} onClick={() => void load()}>{loading ? 'Loading…' : 'Refresh'}</button>
    </div>

    {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}</div> : null}

    {rows.length ? <div className="table-wrap"><table><thead><tr><th>Product</th><th>Source</th><th>Business date</th><th>Quantity</th><th>Current cost basis</th><th>Evidence</th><th>Action</th></tr></thead><tbody>
      {rows.map((row) => <tr key={row.movement_id}>
        <td><strong>{row.item_name}</strong><small className="report-subline">{row.sku || 'No SKU'}</small></td>
        <td>{sourceLabel(row.movement_type)}<small className="report-subline">{row.reference_id || row.reference_type}</small></td>
        <td>{dateTime(row.business_at)}</td>
        <td>{formatQuantity(row.quantity_delta)} {row.stock_uom}</td>
        <td>{row.current_stock_unit_cost == null ? <span className="danger-text">Unvalued</span> : money(numberValue(row.current_stock_unit_cost), row.currency || currency)}</td>
        <td>{row.current_evidence_id ? <><strong>{row.evidence_reference || 'Recorded evidence'}</strong><small className="report-subline">{row.evidence_reason || '—'}</small></> : 'No governed evidence'}</td>
        <td>{canManage ? <button className="text-button" type="button" disabled={busy} onClick={() => beginEdit(row)}>{row.current_evidence_id ? 'Correct basis' : 'Set cost basis'}</button> : <span className="muted">View only</span>}</td>
      </tr>)}
    </tbody></table></div> : !loading ? <div className="empty-state"><strong>No unresolved historical cost sources</strong><p>Eligible opening stock, positive corrections or legacy receipts without governed purchase cost will appear here. Supplier receipts with Purchase Receiving cost evidence cannot be overridden here.</p></div> : null}

    {editing ? <form className="product-editor-stack" onSubmit={submit}>
      <div className="panel-head"><div><p className="eyebrow">{editing.current_evidence_id ? 'Correct cost basis' : 'Set cost basis'}</p><h3>{editing.item_name}</h3><p className="muted">{formatQuantity(editing.quantity_delta)} {editing.stock_uom} posted {dateTime(editing.business_at)}. Enter cost per {editing.stock_uom} in {editing.currency || currency} from real historical evidence.</p></div><button className="text-button" type="button" disabled={busy} onClick={closeEditor}>Close</button></div>
      <div className="form-grid">
        <label className="field">Cost per {editing.stock_uom}<input type="number" min="0" step="0.00000001" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} required /></label>
        <label className="field">Evidence reference<input value={reference} maxLength={160} placeholder="Invoice, opening schedule, count sheet…" onChange={(event) => setReference(event.target.value)} required /></label>
        <label className="field">Audit reason<input value={reason} maxLength={500} placeholder="Why this historical cost is authoritative" onChange={(event) => setReason(event.target.value)} required /></label>
      </div>
      <p className="muted">This appends an immutable audit record. Corrections preserve the previous evidence instead of editing it. Stock quantity and the original movement date remain unchanged.</p>
      <div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? 'Replaying valuation…' : editing.current_evidence_id ? 'Record corrected basis' : 'Record cost evidence'}</button></div>
    </form> : null}
  </article>;
}

function sourceLabel(value: string): string {
  if (value === 'opening') return 'Opening stock';
  if (value === 'count_reconciliation') return 'Stock count';
  if (value === 'purchase_receipt') return 'Legacy purchase receipt';
  if (value === 'adjustment') return 'Positive adjustment';
  return value.replaceAll('_', ' ');
}
function formatQuantity(value: number | string): string { return new Intl.NumberFormat('en-NG', { maximumFractionDigits: 3 }).format(numberValue(value)); }
function money(value: number, currency: string): string { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(value); } catch { return `${currency || 'NGN'} ${value.toLocaleString('en-NG')}`; } }
function dateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
