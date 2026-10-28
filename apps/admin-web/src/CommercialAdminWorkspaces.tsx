import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  invokeCommercialAdmin,
  loadCommercialOnboarding,
  loadCommercialOverview,
  type AdminRole,
  type BranchSetupState,
  type CommercialOnboarding,
  type CommercialOverview,
  type OnboardingOrder,
} from './commercial-admin-state';

type ListAddTab = 'list' | 'add';

export function CommercialPricingAdministration({ session, actorRole, tenantId }: { session: Session; actorRole: AdminRole; tenantId: string }) {
  const { state, loading, error, message, saving, reload, mutate, setError } = useOnboardingWorkspace(session, tenantId);
  const [tab, setTab] = useState<ListAddTab>('list');
  const [subscriptionForm, setSubscriptionForm] = useState({ planCode: 'business', currency: 'NGN', monthlyGross: '', taxRate: '', effectiveFrom: nowLocal(), reason: '' });
  const [setupForm, setSetupForm] = useState({ currency: 'NGN', gross: '', taxRate: '', effectiveFrom: nowLocal(), reason: '' });
  const canManage = actorRole === 'admin' && state?.canManage === true;

  useEffect(() => {
    if (!state?.plans[0] || state.plans.some((plan) => plan.code === subscriptionForm.planCode)) return;
    setSubscriptionForm((current) => ({ ...current, planCode: state.plans[0].code, currency: state.plans[0].currency || current.currency }));
  }, [state, subscriptionForm.planCode]);

  async function publishSubscriptionPrice() {
    if (!canManage) return;
    const monthlyGrossAmount = positiveNumber(subscriptionForm.monthlyGross);
    const taxRatePercent = optionalPercent(subscriptionForm.taxRate);
    const effectiveFrom = isoFromLocal(subscriptionForm.effectiveFrom);
    if (monthlyGrossAmount === null) return setError('Enter a positive VAT-inclusive monthly subscription price.');
    if (taxRatePercent === undefined) return setError('Tax rate must be blank or between 0 and 100%.');
    if (!effectiveFrom || subscriptionForm.reason.trim().length < 6) return setError('Enter a valid effective time and a reason of at least 6 characters.');
    const ok = await mutate('subscription-price', {
      action: 'admin_publish_subscription_price', tenantId,
      planCode: subscriptionForm.planCode, currency: subscriptionForm.currency,
      monthlyGrossAmount, taxRatePercent, effectiveFrom, reason: subscriptionForm.reason,
    }, 'Governed monthly and annual subscription prices published.');
    if (ok) {
      setSubscriptionForm((current) => ({ ...current, monthlyGross: '', taxRate: '', effectiveFrom: nowLocal(), reason: '' }));
      setTab('list');
    }
  }

  async function publishSetupPrice() {
    if (!canManage) return;
    const grossAmount = positiveNumber(setupForm.gross);
    const taxRatePercent = optionalPercent(setupForm.taxRate);
    const effectiveFrom = isoFromLocal(setupForm.effectiveFrom);
    if (grossAmount === null) return setError('Enter a positive VAT-inclusive Branch setup price.');
    if (taxRatePercent === undefined) return setError('Tax rate must be blank or between 0 and 100%.');
    if (!effectiveFrom || setupForm.reason.trim().length < 6) return setError('Enter a valid effective time and a reason of at least 6 characters.');
    const ok = await mutate('setup-price', {
      action: 'admin_publish_setup_price', tenantId,
      currency: setupForm.currency, grossAmount, taxRatePercent, effectiveFrom, reason: setupForm.reason,
    }, 'Governed Branch setup price published.');
    if (ok) {
      setSetupForm((current) => ({ ...current, gross: '', taxRate: '', effectiveFrom: nowLocal(), reason: '' }));
      setTab('list');
    }
  }

  return <WorkspaceState loading={loading} error={error} message={message} onReload={reload}>
    <WorkspaceTabs value={tab} onChange={setTab} tabs={[["list", "Price List"], ["add", "Add New"]]} label="Plans and pricing views" />
    {!canManage ? <div className="workspace-banner info">Platform Support can review effective prices. Publishing price changes remains restricted to authorised Platform Admin authority.</div> : null}
    {state && tab === 'list' ? <section className="workspace-panel">
      <PanelHeading title="Effective price history" description="Published commercial pricing is effective-dated and historical orders remain snapshotted." />
      <div className="workspace-table-wrap"><table className="workspace-table compact-table"><thead><tr><th>Price</th><th>Cycle</th><th>Gross</th><th>Tax</th><th>Effective</th></tr></thead><tbody>{state.prices.map((price) => <tr key={price.id}><td>{price.priceKind === 'branch_setup' ? 'Branch setup' : price.planCode ?? 'Subscription'}</td><td>{price.billingCycle ?? 'One-time'}</td><td>{money(price.grossAmount, price.currency)}</td><td>{price.taxRatePercent === null ? 'Not separately recorded' : `${price.taxRatePercent}%`}</td><td>{formatDate(price.effectiveFrom)}</td></tr>)}{!state.prices.length ? <tr><td colSpan={5}>No governed pricing has been published.</td></tr> : null}</tbody></table></div>
    </section> : null}
    {state && tab === 'add' ? <div className="workspace-grid two">
      <section className="workspace-panel workspace-form-stack">
        <PanelHeading title="Subscription pricing" description="Publish VAT-inclusive monthly pricing. The governed service derives the annual 10-for-12 price." />
        <fieldset disabled={!canManage || saving !== null} style={{ border: 0, padding: 0, display: 'contents' }}>
          <label>Plan<select value={subscriptionForm.planCode} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, planCode: event.target.value })}>{state.plans.filter((plan) => plan.active).map((plan) => <option key={plan.code} value={plan.code}>{plan.name}</option>)}</select></label>
          <div className="workspace-field-grid two"><label>Currency<input maxLength={3} value={subscriptionForm.currency} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, currency: event.target.value.toUpperCase() })} /></label><label>Monthly VAT-inclusive price<input inputMode="decimal" value={subscriptionForm.monthlyGross} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, monthlyGross: event.target.value })} /></label></div>
          <div className="workspace-field-grid two"><label>Underlying tax rate % (optional)<input inputMode="decimal" value={subscriptionForm.taxRate} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, taxRate: event.target.value })} /></label><label>Effective from<input type="datetime-local" value={subscriptionForm.effectiveFrom} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, effectiveFrom: event.target.value })} /></label></div>
          <label>Change reason<input maxLength={1000} value={subscriptionForm.reason} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, reason: event.target.value })} /></label>
          {positiveNumber(subscriptionForm.monthlyGross) !== null ? <small>Annual preview: {money((positiveNumber(subscriptionForm.monthlyGross) ?? 0) * 10, subscriptionForm.currency)} for 12 months.</small> : null}
          <button type="button" className="workspace-button primary" onClick={() => void publishSubscriptionPrice()}>{saving === 'subscription-price' ? 'Publishing…' : 'Publish subscription prices'}</button>
        </fieldset>
      </section>
      <section className="workspace-panel workspace-form-stack">
        <PanelHeading title="Branch setup pricing" description="Publish the separate one-time setup price used for each purchased Branch setup obligation." />
        <fieldset disabled={!canManage || saving !== null} style={{ border: 0, padding: 0, display: 'contents' }}>
          <div className="workspace-field-grid two"><label>Currency<input maxLength={3} value={setupForm.currency} onChange={(event) => setSetupForm({ ...setupForm, currency: event.target.value.toUpperCase() })} /></label><label>VAT-inclusive setup price<input inputMode="decimal" value={setupForm.gross} onChange={(event) => setSetupForm({ ...setupForm, gross: event.target.value })} /></label></div>
          <div className="workspace-field-grid two"><label>Underlying tax rate % (optional)<input inputMode="decimal" value={setupForm.taxRate} onChange={(event) => setSetupForm({ ...setupForm, taxRate: event.target.value })} /></label><label>Effective from<input type="datetime-local" value={setupForm.effectiveFrom} onChange={(event) => setSetupForm({ ...setupForm, effectiveFrom: event.target.value })} /></label></div>
          <label>Change reason<input maxLength={1000} value={setupForm.reason} onChange={(event) => setSetupForm({ ...setupForm, reason: event.target.value })} /></label>
          <button type="button" className="workspace-button primary" onClick={() => void publishSetupPrice()}>{saving === 'setup-price' ? 'Publishing…' : 'Publish Branch setup price'}</button>
        </fieldset>
      </section>
    </div> : null}
  </WorkspaceState>;
}

export function CommercialOrdersAdministration({ session, actorRole, tenantId }: { session: Session; actorRole: AdminRole; tenantId: string }) {
  const { state, loading, error, message, saving, reload, mutate, setError } = useOnboardingWorkspace(session, tenantId);
  const [tab, setTab] = useState<ListAddTab>('list');
  const [purchase, setPurchase] = useState({ branchIds: [] as string[], structureCode: 'two_installment_70_30', orderReference: '', reason: '' });
  const canManage = actorRole === 'admin' && state?.canManage === true;

  useEffect(() => {
    if (!state) return;
    const activeIds = state.branches.filter((branch) => branch.active).map((branch) => branch.id);
    const activeSet = new Set(activeIds);
    setPurchase((current) => {
      const retained = current.branchIds.filter((id) => activeSet.has(id));
      return { ...current, branchIds: retained.length ? retained : activeIds };
    });
  }, [state?.branches]);

  function toggleBranch(branchId: string) {
    setPurchase((current) => ({ ...current, branchIds: current.branchIds.includes(branchId) ? current.branchIds.filter((id) => id !== branchId) : [...current.branchIds, branchId] }));
  }

  async function createInitialPurchase() {
    if (!canManage || !state) return;
    if (!state.eligibleForInitialInstallment) return setError('This Business is not eligible for the initial installment purchase.');
    if (!purchase.branchIds.length) return setError('Select at least one active Branch.');
    if (!purchase.orderReference.trim() || purchase.reason.trim().length < 6) return setError('Enter an order reference and a reason of at least 6 characters.');
    const plan = state.plans.find((row) => row.code === state.planCode) ?? state.plans[0];
    const ok = await mutate('purchase', {
      action: 'admin_create_initial_purchase', tenantId,
      planCode: plan?.code ?? state.planCode ?? 'business', currency: plan?.currency ?? 'NGN',
      branchIds: purchase.branchIds, structureCode: purchase.structureCode,
      orderReference: purchase.orderReference, reason: purchase.reason,
    }, 'Initial annual installment purchase created from governed prices.');
    if (ok) {
      setPurchase((current) => ({ ...current, orderReference: '', reason: '' }));
      setTab('list');
    }
  }

  return <WorkspaceState loading={loading} error={error} message={message} onReload={reload}>
    <WorkspaceTabs value={tab} onChange={setTab} tabs={[["list", "List View"], ["add", "Add New"]]} label="Commercial order views" />
    {!canManage ? <div className="workspace-banner info">Platform Support can review commercial orders. New purchase creation remains restricted to authorised Platform Admin authority.</div> : null}
    {state && tab === 'list' ? <section className="workspace-panel">
      <PanelHeading title="Commercial orders" description="Immutable order value remains separate from later discounts, direct payments and provider confirmations." />
      <div className="workspace-table-wrap"><table className="workspace-table compact-table"><thead><tr><th>Reference</th><th>Ordered</th><th>Total</th><th>Installment structure</th><th>Obligation</th></tr></thead><tbody>{state.orders.map((order) => <OrderRow key={order.id} order={order} />)}{!state.orders.length ? <tr><td colSpan={5}>No commercial orders have been created for this Business.</td></tr> : null}</tbody></table></div>
    </section> : null}
    {state && tab === 'add' ? <section className="workspace-panel workspace-form-stack">
      <PanelHeading title="Create initial commercial order" description="Create one immutable annual purchase from governed prices and the selected active Branch setup obligations." />
      {!state.eligibleForInitialInstallment ? <div className="workspace-banner warning">This Business is not currently eligible for the initial installment purchase flow.</div> : null}
      <fieldset disabled={!canManage || saving !== null || !state.eligibleForInitialInstallment} style={{ border: 0, padding: 0, display: 'contents' }}>
        <div><strong>Branches</strong><div className="workspace-filter-row" style={{ marginTop: 8 }}>{state.branches.filter((branch) => branch.active).map((branch) => <label key={branch.id} className="workspace-check-pill"><input type="checkbox" checked={purchase.branchIds.includes(branch.id)} onChange={() => toggleBranch(branch.id)} />{branch.name}</label>)}</div></div>
        <div className="workspace-field-grid two"><label>Installment structure<select value={purchase.structureCode} onChange={(event) => setPurchase({ ...purchase, structureCode: event.target.value })}><option value="two_installment_70_30">70% + 30%</option><option value="three_installment_60_20_20">60% + 20% + 20%</option></select></label><label>Commercial order reference<input maxLength={128} value={purchase.orderReference} onChange={(event) => setPurchase({ ...purchase, orderReference: event.target.value })} placeholder="e.g. ST-2026-0001" /></label></div>
        <label>Creation reason<input maxLength={1000} value={purchase.reason} onChange={(event) => setPurchase({ ...purchase, reason: event.target.value })} /></label>
        <button type="button" className="workspace-button primary" onClick={() => void createInitialPurchase()}>{saving === 'purchase' ? 'Creating…' : 'Create governed purchase'}</button>
      </fieldset>
    </section> : null}
  </WorkspaceState>;
}

export function InstallmentEntitlementAdministration({ session, tenantId }: { session: Session; tenantId: string }) {
  const { state, loading, error, reload } = useOverviewWorkspace(session, tenantId);
  return <WorkspaceState loading={loading} error={error} onReload={reload}>
    {state ? <section className="workspace-panel">
      <PanelHeading title="Installment & entitlement review" description="Agreement, payment, setup and entitlement are separate governed facts. Payment-policy mutations remain in Payments & Settlement." />
      {state.installmentBilling.length ? <div className="workspace-form-stack">{state.installmentBilling.map((item) => <article key={item.installmentObligationId} className="workspace-module-card"><div className="workspace-panel-heading"><div><h3>{structureLabel(item.structureCode)}</h3><p>{money(item.obligatedAmount, item.currency)} · {item.paidInstallmentCount} of {item.installmentCount} installments confirmed</p></div><span className="workspace-status info">{label(item.entitlementState)}</span></div><div className="workspace-detail-grid"><Detail label="Agreement" value={item.agreementAccepted ? 'Accepted' : 'Awaiting acceptance'} /><Detail label="Branch setup" value={item.setupReady ? 'Ready' : `${item.setupReadyCount} of ${item.setupRequiredCount} ready`} /><Detail label="Activation" value={item.activationAt ? formatDate(item.activationAt) : 'Not activated'} /><Detail label="Entitlement end" value={item.fullTermUntil ? formatDate(item.fullTermUntil) : item.provisionalUntil ? formatDate(item.provisionalUntil) : 'Pending prerequisites'} /></div><div className="workspace-table-wrap"><table className="workspace-table compact-table"><thead><tr><th>Installment</th><th>Share</th><th>Amount</th><th>Due</th><th>Payment</th></tr></thead><tbody>{item.schedule.map((line) => <tr key={line.id}><td>{line.sequenceNo}</td><td>{line.percentage}%</td><td>{money(line.amountDue, item.currency)}</td><td>{line.dueAt ? formatDate(line.dueAt) : 'Not scheduled'}</td><td>{line.paymentStatus === 'settled' ? 'Settled' : line.paymentStatus === 'partial' ? 'Partial' : 'Unpaid'}</td></tr>)}</tbody></table></div></article>)}</div> : <Empty title="No installment purchase" body="This Business has no installment obligation." />}
    </section> : null}
  </WorkspaceState>;
}

export function BranchReadinessAdministration({ session, tenantId }: { session: Session; tenantId: string }) {
  const { state, loading, error, reload } = useOverviewWorkspace(session, tenantId);
  const readyCount = state?.branchSetup.filter((row) => row.ready).length ?? 0;
  return <WorkspaceState loading={loading} error={error} onReload={reload}>
    {state ? <>
      <section className="workspace-panel">
        <PanelHeading title="Branch readiness" description="Readiness is an immutable fact tied to the exact commercial order + Branch + Branch setup obligation." />
        <div className="workspace-detail-grid"><Detail label="Setup obligations" value={String(state.branchSetup.length)} /><Detail label="Ready" value={`${readyCount} of ${state.branchSetup.length}`} /></div>
        <div className="workspace-banner info" style={{ marginTop: 16 }}>Readiness is produced by the governed setup-completion path. This review surface does not expose the legacy generic “Record ready” shortcut. OA4 structured completion and recovery will extend this workspace without creating a second activation state.</div>
      </section>
      <section className="workspace-panel">
        <div className="workspace-table-wrap"><table className="workspace-table compact-table"><thead><tr><th>Branch</th><th>Order</th><th>Setup obligation</th><th>Amount</th><th>Status</th><th>Ready at</th></tr></thead><tbody>{state.branchSetup.map((row) => <ReadinessRow key={readinessKey(row)} row={row} />)}{!state.branchSetup.length ? <tr><td colSpan={6}>No Branch setup purchase obligations.</td></tr> : null}</tbody></table></div>
      </section>
    </> : null}
  </WorkspaceState>;
}

function useOnboardingWorkspace(session: Session, tenantId: string) {
  const [state, setState] = useState<CommercialOnboarding | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const sequence = useRef(0);

  async function reload() {
    const current = ++sequence.current;
    setLoading(true); setError(null);
    try {
      const next = await loadCommercialOnboarding(session, tenantId);
      if (current === sequence.current) setState(next);
    } catch (cause) {
      if (current === sequence.current) { setState(null); setError(messageFrom(cause, 'Unable to load governed commercial onboarding state.')); }
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, [tenantId, session.access_token]);

  async function mutate(key: string, payload: Record<string, unknown>, success: string) {
    if (saving) return false;
    setSaving(key); setError(null); setMessage(null);
    try { await invokeCommercialAdmin(session, payload); await reload(); setMessage(success); return true; }
    catch (cause) { setError(messageFrom(cause, 'Unable to complete the governed commercial action.')); return false; }
    finally { setSaving(null); }
  }

  return { state, loading, saving, error, message, reload, mutate, setError };
}

function useOverviewWorkspace(session: Session, tenantId: string) {
  const [state, setState] = useState<CommercialOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  async function reload() {
    const current = ++sequence.current;
    setLoading(true); setError(null);
    try { const next = await loadCommercialOverview(session, tenantId); if (current === sequence.current) setState(next); }
    catch (cause) { if (current === sequence.current) { setState(null); setError(messageFrom(cause, 'Unable to load governed commercial status.')); } }
    finally { if (current === sequence.current) setLoading(false); }
  }
  useEffect(() => { void reload(); }, [tenantId, session.access_token]);
  return { state, loading, error, reload };
}

function WorkspaceTabs<T extends string>({ value, onChange, tabs, label: ariaLabel }: { value: T; onChange: (value: T) => void; tabs: readonly (readonly [T, string])[]; label: string }) {
  return <nav className="workspace-panel" aria-label={ariaLabel} style={{ padding: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>{tabs.map(([id, text]) => <button key={id} type="button" className={`workspace-button ${value === id ? 'primary' : 'secondary'}`} aria-current={value === id ? 'page' : undefined} onClick={() => onChange(id)}>{text}</button>)}</nav>;
}

function WorkspaceState({ loading, error, message, onReload, children }: { loading: boolean; error?: string | null; message?: string | null; onReload: () => Promise<void>; children: ReactNode }) {
  return <div className="workspace-stack">
    {loading ? <div className="workspace-banner info">Loading governed state…</div> : null}
    {error ? <div className="workspace-banner error">{error} <button type="button" className="workspace-button text compact" onClick={() => void onReload()}>Retry</button></div> : null}
    {message ? <div className="workspace-banner success">{message}</div> : null}
    {!loading ? children : null}
  </div>;
}

function PanelHeading({ title, description }: { title: string; description: string }) { return <div className="workspace-panel-heading"><div><h2>{title}</h2><p>{description}</p></div></div>; }
function Detail({ label: text, value }: { label: string; value: string }) { return <div className="workspace-detail"><span>{text}</span><strong>{value}</strong></div>; }
function Empty({ title, body }: { title: string; body: string }) { return <div className="workspace-empty"><strong>{title}</strong><p>{body}</p></div>; }
function OrderRow({ order }: { order: OnboardingOrder }) { return <tr><td><strong>{order.reference || shortId(order.id)}</strong><small>{shortId(order.id)}</small></td><td>{formatDate(order.orderedAt)}</td><td>{money(order.totalGrossAmount, order.currency)}</td><td>{order.structureCode ? structureLabel(order.structureCode) : 'Not installment-linked'}</td><td>{order.installmentObligationId ? shortId(order.installmentObligationId) : '—'}</td></tr>; }
function ReadinessRow({ row }: { row: BranchSetupState }) { return <tr><td><strong>{row.branchName}</strong><small>{row.branchCode}</small></td><td>{shortId(row.commercialOrderId)}</td><td>{row.description}</td><td>{money(row.grossAmount, row.currency)}</td><td><span className={`workspace-status ${row.ready ? 'success' : 'attention'}`}>{row.ready ? 'Ready' : 'Pending'}</span></td><td>{row.readyAt ? formatDate(row.readyAt) : '—'}</td></tr>; }
function readinessKey(row: BranchSetupState) { return `${row.commercialOrderId}:${row.lineNo}:${row.branchId}`; }
function positiveNumber(value: string): number | null { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? Math.round((parsed + Number.EPSILON) * 100) / 100 : null; }
function optionalPercent(value: string): number | null | undefined { if (!value.trim()) return null; const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : undefined; }
function isoFromLocal(value: string): string | null { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function nowLocal() { const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000); return date.toISOString().slice(0, 16); }
function money(value: number, currency: string) { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN' }).format(value); } catch { return `${currency || 'NGN'} ${value.toLocaleString()}`; } }
function formatDate(value: string) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function structureLabel(value: string) { return value === 'two_installment_70_30' ? '70% + 30%' : value === 'three_installment_60_20_20' ? '60% + 20% + 20%' : label(value); }
function label(value: string) { return value ? value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : '—'; }
function shortId(value: string) { return value ? `${value.slice(0, 8)}…` : '—'; }
function messageFrom(value: unknown, fallback: string) { return value instanceof Error && value.message ? value.message : fallback; }
