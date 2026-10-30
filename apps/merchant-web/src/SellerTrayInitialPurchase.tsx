import { useEffect, useMemo, useState } from 'react';
import { errorMessage, supabase } from './supabase';
import { SellerTrayInput, SellerTraySelect } from './SellerTrayElements';

type PurchasePlan = { code: string; name: string; billingCycle: string; currency: string; subscriptionGrossAmount: number; branchSetupGrossAmount: number };
type PurchaseBranch = { id: string; code: string; name: string; isDefault: boolean };
type PurchaseCenter = { actorRole: 'owner' | 'manager'; canPurchaseInitial: boolean; availablePlans: PurchasePlan[]; activeBranches: PurchaseBranch[]; supportedInstallmentStructures: string[]; orders: unknown[] };
type InitialPurchaseProps = { tenantId: string; onChanged: () => void | Promise<void>; onContinueToOrderForm: () => void };

export default function SellerTrayInitialPurchase({ tenantId, onChanged, onContinueToOrderForm }: InitialPurchaseProps) {
  const [center, setCenter] = useState<PurchaseCenter | null>(null);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);
  const [structure, setStructure] = useState('two_installment_70_30');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void load(); }, [tenantId]);

  async function load() {
    setLoading(true); setError(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('commercial-billing', { body: { action: 'center', tenantId } });
      if (functionError) throw functionError;
      const next = parseCenter(record(data).center);
      setCenter(next);
      setSelectedPlan((current) => next.availablePlans.some((plan) => plan.code === current) ? current : next.availablePlans[0]?.code ?? '');
      setSelectedBranches((current) => {
        const valid = current.filter((id) => next.activeBranches.some((branch) => branch.id === id));
        return valid.length ? valid : next.activeBranches.map((branch) => branch.id);
      });
      setStructure((current) => next.supportedInstallmentStructures.includes(current) ? current : next.supportedInstallmentStructures[0] ?? 'two_installment_70_30');
    } catch (cause) {
      setCenter(null);
      setError(errorMessage(cause, 'Unable to load SellerTray purchase options.'));
    } finally { setLoading(false); }
  }

  const plan = useMemo(() => center?.availablePlans.find((row) => row.code === selectedPlan) ?? null, [center, selectedPlan]);
  const branchSetupTotal = plan ? plan.branchSetupGrossAmount * selectedBranches.length : 0;
  const purchaseTotal = plan ? plan.subscriptionGrossAmount + branchSetupTotal : 0;

  async function purchase() {
    if (!center?.canPurchaseInitial || !plan || !selectedBranches.length || submitting) return;
    const storageKey = `sellertray:first-purchase:${tenantId}`;
    const stored = safeSessionStorageGet(storageKey);
    const commandId = isUuid(stored) ? stored : crypto.randomUUID();
    safeSessionStorageSet(storageKey, commandId);
    setSubmitting(true); setError(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('commercial-billing', {
        body: { action: 'create_initial_purchase', tenantId, planCode: plan.code, currency: plan.currency, branchIds: selectedBranches, structureCode: structure, commandId },
      });
      if (functionError) throw functionError;
      const payload = record(data);
      if (payload.ok !== true) throw new Error('SellerTray could not prepare the purchase.');
      safeSessionStorageRemove(storageKey);
      await onChanged();
      onContinueToOrderForm();
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to prepare the SellerTray purchase. Retry to continue the same purchase request.'));
    } finally { setSubmitting(false); }
  }

  if (loading && !center) return <article className="panel"><p className="muted">Loading purchase options…</p></article>;
  if (!center || center.orders.length > 0) return error ? <div className="error-banner">{error}</div> : null;

  return <article className="panel">
    <div className="panel-head">
      <div><p className="eyebrow">First SellerTray purchase</p><h3>Choose your SellerTray plan</h3><p className="muted">Review your subscription, Branch setup charges and payment option before SellerTray prepares the Order Form.</p></div>
      <span className="role-pill">{center.actorRole === 'owner' ? 'Business Owner' : 'Owner approval required'}</span>
    </div>
    {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}

    {!center.availablePlans.length ? <div className="empty-state"><strong>No SellerTray plan is currently available</strong><p>Subscription and Branch setup prices must be published before the first purchase can be prepared.</p></div> : <>
      <div className="settings-grid two">
        {center.availablePlans.map((option) => <label className="role-lock" key={`${option.code}:${option.currency}`}>
          <span><SellerTrayInput type="radio" name="sellertray-plan" checked={selectedPlan === option.code} disabled={!center.canPurchaseInitial || submitting} onChange={() => setSelectedPlan(option.code)} /> {option.name}</span>
          <strong>{money(option.subscriptionGrossAmount, option.currency)} / year</strong>
          <small>Branch setup: {money(option.branchSetupGrossAmount, option.currency)} per selected Branch</small>
        </label>)}
      </div>

      <div className="section-heading"><div><h3>Branches included in setup</h3><p className="muted">Choose the Branches included in this first SellerTray purchase.</p></div></div>
      <div className="settings-grid two">
        {center.activeBranches.map((branch) => <label className="role-lock" key={branch.id}>
          <span><SellerTrayInput type="checkbox" checked={selectedBranches.includes(branch.id)} disabled={!center.canPurchaseInitial || submitting} onChange={() => setSelectedBranches((current) => current.includes(branch.id) ? current.filter((id) => id !== branch.id) : [...current, branch.id])} /> {branch.name}</span>
          <small>{branch.code}{branch.isDefault ? ' · Default Branch' : ''}</small>
        </label>)}
      </div>

      <label className="field-label">Payment option
        <SellerTraySelect value={structure} disabled={!center.canPurchaseInitial || submitting} onChange={(event) => setStructure(event.target.value)}>
          {center.supportedInstallmentStructures.map((value) => <option key={value} value={value}>{installmentLabel(value)}</option>)}
        </SellerTraySelect>
      </label>

      {plan ? <div className="settings-grid two">
        <Fact label="Subscription" value={money(plan.subscriptionGrossAmount, plan.currency)} />
        <Fact label={`Branch setup · ${selectedBranches.length}`} value={money(branchSetupTotal, plan.currency)} />
        <Fact label="Purchase total" value={money(purchaseTotal, plan.currency)} />
        <Fact label="Payment option" value={installmentLabel(structure)} />
      </div> : null}

      <div className="access-card">
        <span style={{ flex: 1 }}><strong>Prepare your Order Form</strong><small>Your Order Form will show the exact plan, Branches, prices and payment schedule for review before you confirm the purchase or make payment.</small></span>
        {center.canPurchaseInitial ? <button type="button" className="primary-button" disabled={!plan || !selectedBranches.length || submitting} onClick={() => void purchase()}>{submitting ? 'Preparing Order Form…' : 'Continue to Order Form'}</button> : <span className="role-pill">Business Owner only</span>}
      </div>
    </>}
  </article>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div className="role-lock"><span>{label}</span><strong>{value}</strong></div>; }
function parseCenter(value: unknown): PurchaseCenter {
  const root = record(value);
  return {
    actorRole: root.actorRole === 'owner' ? 'owner' : 'manager', canPurchaseInitial: root.canPurchaseInitial === true, orders: Array.isArray(root.orders) ? root.orders : [],
    availablePlans: Array.isArray(root.availablePlans) ? root.availablePlans.flatMap((raw) => { const row = record(raw); const code = text(row.code); const name = text(row.name); const currency = text(row.currency); if (!code || !name || !currency) return []; return [{ code, name, currency, billingCycle: text(row.billingCycle) || 'yearly', subscriptionGrossAmount: numberValue(row.subscriptionGrossAmount), branchSetupGrossAmount: numberValue(row.branchSetupGrossAmount) }]; }) : [],
    activeBranches: Array.isArray(root.activeBranches) ? root.activeBranches.flatMap((raw) => { const row = record(raw); const id = text(row.id); const name = text(row.name); if (!isUuid(id) || !name) return []; return [{ id, name, code: text(row.code), isDefault: row.isDefault === true }]; }) : [],
    supportedInstallmentStructures: Array.isArray(root.supportedInstallmentStructures) ? root.supportedInstallmentStructures.filter((value): value is string => typeof value === 'string') : [],
  };
}
function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown) { return typeof value === 'string' ? value : ''; }
function numberValue(value: unknown) { const number = typeof value === 'number' ? value : Number(value ?? 0); return Number.isFinite(number) ? number : 0; }
function installmentLabel(value: string) { return value === 'three_installment_60_20_20' ? '3 installments · 60% / 20% / 20%' : '2 installments · 70% / 30%'; }
function money(value: number, currency: string) { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency }).format(value); } catch { return `${currency} ${value.toLocaleString()}`; } }
function isUuid(value: string | null): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function safeSessionStorageGet(key: string) { try { return window.sessionStorage.getItem(key); } catch { return null; } }
function safeSessionStorageSet(key: string, value: string) { try { window.sessionStorage.setItem(key, value); } catch { /* browser storage unavailable */ } }
function safeSessionStorageRemove(key: string) { try { window.sessionStorage.removeItem(key); } catch { /* browser storage unavailable */ } }
