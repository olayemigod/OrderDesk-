import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { invokeJson } from './supabase';

export type CommercialAdminTenant = {
  id: string;
  name: string;
  businessEmail: string | null;
  businessPhone: string | null;
  slug: string;
  planCode: string | null;
  subscriptionStatus: string;
};

type BranchSetupState = {
  commercialOrderId: string;
  installmentObligationId: string | null;
  lineNo: number;
  branchId: string;
  branchCode: string;
  branchName: string;
  description: string;
  currency: string;
  grossAmount: number;
  ready: boolean;
  readinessId: string | null;
  readyAt: string | null;
};

type InstallmentLine = {
  id: string;
  sequenceNo: number;
  percentage: number;
  amountDue: number;
  dueAt: string | null;
  paymentStatus: 'paid' | 'unpaid';
  paidAt: string | null;
};

type InstallmentState = {
  commercialOrderId: string;
  installmentObligationId: string;
  structureCode: string;
  currency: string;
  obligatedAmount: number;
  agreementAccepted: boolean;
  setupRequiredCount: number;
  setupReadyCount: number;
  setupReady: boolean;
  paidInstallmentCount: number;
  installmentCount: number;
  entitlementState: string;
  activationAt: string | null;
  provisionalUntil: string | null;
  fullTermUntil: string | null;
  schedule: InstallmentLine[];
};

type CommercialOverview = {
  canManage: boolean;
  installmentBilling: InstallmentState[];
  branchSetup: BranchSetupState[];
};

type OnboardingPlan = { code: string; name: string; currency: string; active: boolean };
type OnboardingBranch = { id: string; code: string; name: string; active: boolean; isDefault: boolean };
type OnboardingPrice = {
  id: string;
  priceKind: 'subscription' | 'branch_setup';
  planCode: string | null;
  billingCycle: 'monthly' | 'yearly' | null;
  currency: string;
  grossAmount: number;
  taxRatePercent: number | null;
  effectiveFrom: string;
};
type OnboardingOrder = {
  id: string;
  reference: string;
  currency: string;
  totalGrossAmount: number;
  orderedAt: string;
  installmentObligationId: string | null;
  structureCode: string | null;
};
type OnboardingTemplate = { id: string; family: string; versionCode: string; title: string; effectiveFrom: string; publishedAt: string };
type OnboardingAgreement = { id: string; commercialOrderId: string; reference: string; accepted: boolean };
type AdminOnboardingState = {
  stage: string;
  merchantMessage: string;
  nextActionLabel: string;
  operationalAccessAllowed: boolean;
  activationComplete: boolean;
  activeBranchCount: number;
  setupRequiredCount: number;
  setupReadyCount: number;
  blockers: string[];
};
type CommercialOnboarding = {
  canManage: boolean;
  eligibleForInitialInstallment: boolean;
  planCode: string | null;
  plans: OnboardingPlan[];
  branches: OnboardingBranch[];
  prices: OnboardingPrice[];
  orders: OnboardingOrder[];
  templates: OnboardingTemplate[];
  agreements: OnboardingAgreement[];
  onboardingState: AdminOnboardingState | null;
};

type AdminResponse = { ok?: boolean; overview?: unknown; onboarding?: unknown };
type SetupForm = { key: string; reason: string; readyAtLocal: string; confirmed: boolean };

const AGREEMENT_FAMILIES = [
  ['installment_agreement', 'Installment agreement'],
  ['subscription_order', 'Subscription order'],
  ['terms_of_service', 'Terms of service'],
  ['money_back_guarantee_terms', 'Money-back guarantee terms'],
  ['branch_setup_equipment_acknowledgement', 'Branch setup & equipment acknowledgement'],
  ['privacy_data_terms', 'Privacy & data terms'],
] as const;

export default function CommercialBillingAdministration({
  session,
  actorRole,
  tenants,
}: {
  session: Session;
  actorRole: 'admin' | 'support';
  tenants: CommercialAdminTenant[];
}) {
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [search, setSearch] = useState('');
  const [overview, setOverview] = useState<CommercialOverview | null>(null);
  const [onboarding, setOnboarding] = useState<CommercialOnboarding | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [setupForm, setSetupForm] = useState<SetupForm | null>(null);
  const setupCommandIds = useRef(new Map<string, string>());
  const tenantLoadSequence = useRef(0);

  const [subscriptionForm, setSubscriptionForm] = useState({ planCode: 'business', currency: 'NGN', monthlyGross: '', taxRate: '', effectiveFrom: nowLocal(), reason: '' });
  const [setupPriceForm, setSetupPriceForm] = useState({ currency: 'NGN', gross: '', taxRate: '', effectiveFrom: nowLocal(), reason: '' });
  const [purchaseForm, setPurchaseForm] = useState({ branchIds: [] as string[], structureCode: 'two_installment_70_30', orderReference: '', reason: '' });
  const [templateForm, setTemplateForm] = useState({ family: 'installment_agreement', versionCode: '', title: '', contentBody: '', effectiveFrom: nowLocal(), reason: '' });
  const [agreementForm, setAgreementForm] = useState({ commercialOrderId: '', templateVersionId: '', reference: '', renderedContent: '', reason: '' });

  const filteredTenants = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return tenants;
    return tenants.filter((tenant) => [tenant.name, tenant.businessEmail ?? '', tenant.businessPhone ?? '', tenant.slug, tenant.planCode ?? '', tenant.subscriptionStatus]
      .some((value) => value.toLowerCase().includes(needle)));
  }, [search, tenants]);
  const selectedTenant = tenants.find((tenant) => tenant.id === selectedTenantId) ?? null;
  const selectedOrder = onboarding?.orders.find((order) => order.id === agreementForm.commercialOrderId) ?? null;
  const canManage = actorRole === 'admin' && onboarding?.canManage === true;

  useEffect(() => {
    setSetupForm(null);
    setupCommandIds.current.clear();
    setPurchaseForm((current) => ({ ...current, branchIds: [], orderReference: '', reason: '' }));
    setAgreementForm((current) => ({ ...current, commercialOrderId: '', templateVersionId: '', reference: '', renderedContent: '', reason: '' }));

    if (!selectedTenantId) {
      tenantLoadSequence.current += 1;
      setOverview(null);
      setOnboarding(null);
      setLoading(false);
      return;
    }
    void loadTenant(selectedTenantId);
  }, [selectedTenantId]);

  async function invoke(payload: Record<string, unknown>) {
    return await invokeJson<AdminResponse>('commercial-agreements', payload, session);
  }

  async function loadTenant(tenantId: string) {
    const loadSequence = ++tenantLoadSequence.current;
    setLoading(true);
    setError(null);
    try {
      const [overviewResponse, onboardingResponse] = await Promise.all([
        invoke({ action: 'admin_overview', tenantId }),
        invoke({ action: 'admin_onboarding', tenantId }),
      ]);
      if (loadSequence !== tenantLoadSequence.current) return;

      const nextOverview = parseOverview(overviewResponse.overview);
      const nextOnboarding = parseOnboarding(onboardingResponse.onboarding);
      const activeBranchIds = nextOnboarding.branches.filter((branch) => branch.active).map((branch) => branch.id);
      const activeBranchSet = new Set(activeBranchIds);

      setOverview(nextOverview);
      setOnboarding(nextOnboarding);
      setAgreementForm((current) => ({
        ...current,
        commercialOrderId: nextOnboarding.orders.some((order) => order.id === current.commercialOrderId)
          ? current.commercialOrderId
          : nextOnboarding.orders[0]?.id ?? '',
        templateVersionId: nextOnboarding.templates.some((template) => template.id === current.templateVersionId)
          ? current.templateVersionId
          : nextOnboarding.templates[0]?.id ?? '',
      }));
      setPurchaseForm((current) => {
        const retainedBranchIds = current.branchIds.filter((branchId) => activeBranchSet.has(branchId));
        return { ...current, branchIds: retainedBranchIds.length ? retainedBranchIds : activeBranchIds };
      });
      if (nextOnboarding.plans[0] && !nextOnboarding.plans.some((plan) => plan.code === subscriptionForm.planCode)) {
        setSubscriptionForm((current) => ({ ...current, planCode: nextOnboarding.plans[0].code, currency: nextOnboarding.plans[0].currency || current.currency }));
      }
    } catch (cause) {
      if (loadSequence !== tenantLoadSequence.current) return;
      setOverview(null);
      setOnboarding(null);
      setError(messageFrom(cause, 'Unable to load governed commercial state for this Business.'));
    } finally {
      if (loadSequence === tenantLoadSequence.current) setLoading(false);
    }
  }

  async function runMutation(key: string, payload: Record<string, unknown>, success: string) {
    if (!selectedTenantId || saving) return;
    setSaving(key);
    setError(null);
    setMessage(null);
    try {
      await invoke(payload);
      await loadTenant(selectedTenantId);
      setMessage(success);
    } catch (cause) {
      setError(messageFrom(cause, 'Unable to complete the governed commercial action.'));
    } finally {
      setSaving(null);
    }
  }

  function publishSubscriptionPrice() {
    if (!canManage) return;
    const monthlyGrossAmount = positiveNumber(subscriptionForm.monthlyGross);
    const taxRatePercent = optionalPercent(subscriptionForm.taxRate);
    const effectiveFrom = isoFromLocal(subscriptionForm.effectiveFrom);
    if (monthlyGrossAmount === null) return setError('Enter a positive VAT-inclusive monthly subscription price.');
    if (taxRatePercent === undefined) return setError('Tax rate must be blank or between 0 and 100%.');
    if (!effectiveFrom || subscriptionForm.reason.trim().length < 6) return setError('Enter a valid effective time and a reason of at least 6 characters.');
    void runMutation('subscription-price', {
      action: 'admin_publish_subscription_price', tenantId: selectedTenantId,
      planCode: subscriptionForm.planCode, currency: subscriptionForm.currency,
      monthlyGrossAmount, taxRatePercent, effectiveFrom, reason: subscriptionForm.reason,
    }, 'Governed monthly and annual subscription prices published.');
  }

  function publishSetupPrice() {
    if (!canManage) return;
    const grossAmount = positiveNumber(setupPriceForm.gross);
    const taxRatePercent = optionalPercent(setupPriceForm.taxRate);
    const effectiveFrom = isoFromLocal(setupPriceForm.effectiveFrom);
    if (grossAmount === null) return setError('Enter a positive VAT-inclusive Branch setup price.');
    if (taxRatePercent === undefined) return setError('Tax rate must be blank or between 0 and 100%.');
    if (!effectiveFrom || setupPriceForm.reason.trim().length < 6) return setError('Enter a valid effective time and a reason of at least 6 characters.');
    void runMutation('setup-price', {
      action: 'admin_publish_setup_price', tenantId: selectedTenantId,
      currency: setupPriceForm.currency, grossAmount, taxRatePercent, effectiveFrom, reason: setupPriceForm.reason,
    }, 'Governed Branch setup price published.');
  }

  function createInitialPurchase() {
    if (!canManage) return;
    if (!onboarding?.eligibleForInitialInstallment) return setError('This Business is not eligible for the pre-C2 initial-installment acceptance path.');
    if (!purchaseForm.branchIds.length) return setError('Select at least one active Branch.');
    if (!purchaseForm.orderReference.trim() || purchaseForm.reason.trim().length < 6) return setError('Enter an order reference and a reason of at least 6 characters.');
    void runMutation('purchase', {
      action: 'admin_create_initial_purchase', tenantId: selectedTenantId,
      planCode: subscriptionForm.planCode || onboarding.planCode || 'business', currency: subscriptionForm.currency || 'NGN',
      branchIds: purchaseForm.branchIds, structureCode: purchaseForm.structureCode,
      orderReference: purchaseForm.orderReference, reason: purchaseForm.reason,
    }, 'Initial annual installment purchase created from governed prices.');
  }

  function publishTemplate() {
    if (!canManage) return;
    const effectiveFrom = isoFromLocal(templateForm.effectiveFrom);
    if (!templateForm.versionCode.trim() || !templateForm.title.trim() || !templateForm.contentBody.trim()) return setError('Agreement version, title and content are required.');
    if (!effectiveFrom || templateForm.reason.trim().length < 6) return setError('Enter a valid effective time and a reason of at least 6 characters.');
    void runMutation('template', {
      action: 'admin_publish_template', family: templateForm.family, versionCode: templateForm.versionCode,
      title: templateForm.title, contentBody: templateForm.contentBody, effectiveFrom, reason: templateForm.reason,
    }, 'Governed agreement template published.');
  }

  function issueAgreement() {
    if (!canManage || !selectedOrder) return;
    if (!agreementForm.templateVersionId || !agreementForm.reference.trim() || !agreementForm.renderedContent.trim()) return setError('Select an order and template, then enter agreement reference and rendered agreement content.');
    if (agreementForm.reason.trim().length < 6) return setError('Enter an issuance reason of at least 6 characters.');
    void runMutation('agreement', {
      action: 'admin_issue', tenantId: selectedTenantId,
      commercialOrderId: selectedOrder.id, installmentObligationId: selectedOrder.installmentObligationId,
      templateVersionId: agreementForm.templateVersionId, reference: agreementForm.reference,
      renderedContent: agreementForm.renderedContent, reason: agreementForm.reason,
    }, 'Merchant agreement issued from governed commercial facts.');
  }

  function toggleBranch(branchId: string) {
    setPurchaseForm((current) => ({ ...current, branchIds: current.branchIds.includes(branchId) ? current.branchIds.filter((id) => id !== branchId) : [...current.branchIds, branchId] }));
  }

  function openSetupForm(row: BranchSetupState) {
    if (!canManage || row.ready) return;
    setSetupForm({ key: setupKey(row), reason: '', readyAtLocal: nowLocal(), confirmed: false });
  }

  async function markSetupReady(row: BranchSetupState) {
    if (!canManage || row.ready || saving || setupForm?.key !== setupKey(row)) return;
    const reason = setupForm.reason.trim().replace(/\s+/g, ' ');
    const readyAt = isoFromLocal(setupForm.readyAtLocal);
    if (reason.length < 6 || !readyAt || !setupForm.confirmed) return setError('Confirm completed Branch setup and enter a valid time and reason.');
    const key = setupKey(row);
    const commandId = setupCommandIds.current.get(key) ?? crypto.randomUUID();
    setupCommandIds.current.set(key, commandId);
    setSaving('setup-ready');
    setError(null);
    try {
      await invoke({ action: 'admin_mark_setup_ready', tenantId: selectedTenantId, commercialOrderId: row.commercialOrderId, branchId: row.branchId, commandId, reason, readyAt, evidence: { source: 'sellertray_admin_web' } });
      setupCommandIds.current.delete(key);
      setSetupForm(null);
      await loadTenant(selectedTenantId);
      setMessage(`${row.branchName} setup readiness recorded.`);
    } catch (cause) {
      setError(messageFrom(cause, 'Unable to record Branch setup readiness. Retry keeps the same command identity.'));
    } finally {
      setSaving(null);
    }
  }

  return <div className="workspace-grid two">
    <section className="workspace-panel">
      <div className="workspace-panel-heading"><div><h2>Merchant commercial state</h2><p>Select a Business to review and prepare the controlled first-merchant C1B lifecycle.</p></div></div>
      <div className="workspace-form-stack">
        <label>Search businesses<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Business, email, phone, plan or status" /></label>
        <label>Business<select value={selectedTenantId} onChange={(event) => { setSelectedTenantId(event.target.value); setSetupForm(null); setMessage(null); setError(null); }}>
          <option value="">Select a SellerTray Business</option>
          {filteredTenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}{tenant.planCode ? ` · ${tenant.planCode}` : ''}</option>)}
        </select></label>
      </div>
      {selectedTenant ? <div className="workspace-detail-grid">
        <Detail label="Business" value={selectedTenant.name} />
        <Detail label="Plan" value={selectedTenant.planCode ?? 'Not assigned'} />
        <Detail label="Contact" value={selectedTenant.businessEmail ?? selectedTenant.businessPhone ?? selectedTenant.slug} />
        <Detail label="Acceptance path" value={onboarding?.eligibleForInitialInstallment ? 'Eligible for initial installment' : 'Not eligible'} />
      </div> : null}
      {actorRole === 'support' ? <div className="workspace-banner info">Platform Support is review-only. Commercial creation and setup-readiness changes require Platform Admin.</div> : null}
    </section>

    <section className="workspace-panel">
      <div className="workspace-panel-heading"><div><h2>Onboarding & C1B status</h2><p>One derived status combines the existing agreement, payment, Branch setup and entitlement authorities without replacing them.</p></div></div>
      {!selectedTenantId ? <Empty title="Select a Business" body="Choose a SellerTray Business to load governed commercial state." /> : loading ? <Empty title="Loading" body="Reading governed onboarding and C1/C1A/C1B records…" /> : overview && onboarding ? <>
        {onboarding.onboardingState ? <>
          <div className="workspace-detail-grid">
            <Detail label="Onboarding stage" value={label(onboarding.onboardingState.stage)} />
            <Detail label="Merchant next action" value={onboarding.onboardingState.nextActionLabel || 'No action'} />
            <Detail label="Operational access" value={onboarding.onboardingState.operationalAccessAllowed ? 'Allowed' : 'Blocked until activation'} />
            <Detail label="Branch setup" value={onboarding.onboardingState.setupRequiredCount > 0 ? `${onboarding.onboardingState.setupReadyCount} of ${onboarding.onboardingState.setupRequiredCount} ready` : `${onboarding.onboardingState.activeBranchCount} active Branches`} />
          </div>
          <div className={`workspace-banner ${onboarding.onboardingState.operationalAccessAllowed ? 'success' : 'info'}`} style={{ marginTop: 14 }}><strong>Merchant view:</strong> {onboarding.onboardingState.merchantMessage}</div>
          {onboarding.onboardingState.blockers.length ? <div className="workspace-banner warning" style={{ marginTop: 10 }}><strong>Activation blockers:</strong> {onboarding.onboardingState.blockers.map(label).join(', ')}</div> : null}
        </> : <div className="workspace-banner warning">Shared onboarding projection is unavailable for this Business.</div>}
        <div className="workspace-detail-grid" style={{ marginTop: 14 }}>
          <Detail label="Governed prices" value={String(onboarding.prices.length)} />
          <Detail label="Commercial orders" value={String(onboarding.orders.length)} />
          <Detail label="Agreements" value={String(onboarding.agreements.length)} />
          <Detail label="Installment purchases" value={String(overview.installmentBilling.length)} />
        </div>
      </> : <Empty title="No state loaded" body="Retry the selected Business if a temporary error occurred." />}
    </section>

    {error ? <div className="workspace-banner error">{error}</div> : null}
    {message ? <div className="workspace-banner success">{message}</div> : null}

    {onboarding ? <section className="workspace-panel" style={{ gridColumn: '1 / -1' }}>
      <div className="workspace-panel-heading"><div><h2>First-merchant acceptance</h2><p>Bounded pre-C2 bridge: create governed commercial facts without granting entitlement or retiring runtime compatibility.</p></div></div>
      <div className="workspace-banner warning"><strong>No C2 cutover here.</strong> Annual service is 12 months for exactly 10× monthly price. Installment due dates remain unset.</div>

      <div className="workspace-module-grid" style={{ marginTop: 16 }}>
        <article className="workspace-module-card">
          <h3>1. Subscription pricing</h3><p>Publish VAT-inclusive monthly pricing. The server derives the annual 10-for-12 price.</p>
          <div className="workspace-form-stack">
            <label>Plan<select value={subscriptionForm.planCode} onChange={(e) => setSubscriptionForm({ ...subscriptionForm, planCode: e.target.value })}>{onboarding.plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name}</option>)}</select></label>
            <div className="workspace-field-grid two"><label>Currency<input maxLength={3} value={subscriptionForm.currency} onChange={(e) => setSubscriptionForm({ ...subscriptionForm, currency: e.target.value.toUpperCase() })} /></label><label>Monthly VAT-inclusive price<input inputMode="decimal" value={subscriptionForm.monthlyGross} onChange={(e) => setSubscriptionForm({ ...subscriptionForm, monthlyGross: e.target.value })} /></label></div>
            <div className="workspace-field-grid two"><label>Underlying tax rate % (optional)<input inputMode="decimal" value={subscriptionForm.taxRate} onChange={(e) => setSubscriptionForm({ ...subscriptionForm, taxRate: e.target.value })} placeholder="Leave blank if not yet governed" /></label><label>Effective from<input type="datetime-local" value={subscriptionForm.effectiveFrom} onChange={(e) => setSubscriptionForm({ ...subscriptionForm, effectiveFrom: e.target.value })} /></label></div>
            <label>Change reason<input maxLength={1000} value={subscriptionForm.reason} onChange={(e) => setSubscriptionForm({ ...subscriptionForm, reason: e.target.value })} /></label>
            {positiveNumber(subscriptionForm.monthlyGross) !== null ? <small>Annual preview: {money((positiveNumber(subscriptionForm.monthlyGross) ?? 0) * 10, subscriptionForm.currency)} for 12 months.</small> : null}
            <button type="button" className="workspace-button primary" disabled={!canManage || saving !== null} onClick={publishSubscriptionPrice}>{saving === 'subscription-price' ? 'Publishing…' : 'Publish subscription prices'}</button>
          </div>
        </article>

        <article className="workspace-module-card">
          <h3>2. Branch setup pricing</h3><p>Publish the separate one-time setup price used for every selected Branch.</p>
          <div className="workspace-form-stack">
            <div className="workspace-field-grid two"><label>Currency<input maxLength={3} value={setupPriceForm.currency} onChange={(e) => setSetupPriceForm({ ...setupPriceForm, currency: e.target.value.toUpperCase() })} /></label><label>VAT-inclusive setup price<input inputMode="decimal" value={setupPriceForm.gross} onChange={(e) => setSetupPriceForm({ ...setupPriceForm, gross: e.target.value })} /></label></div>
            <div className="workspace-field-grid two"><label>Underlying tax rate % (optional)<input inputMode="decimal" value={setupPriceForm.taxRate} onChange={(e) => setSetupPriceForm({ ...setupPriceForm, taxRate: e.target.value })} /></label><label>Effective from<input type="datetime-local" value={setupPriceForm.effectiveFrom} onChange={(e) => setSetupPriceForm({ ...setupPriceForm, effectiveFrom: e.target.value })} /></label></div>
            <label>Change reason<input maxLength={1000} value={setupPriceForm.reason} onChange={(e) => setSetupPriceForm({ ...setupPriceForm, reason: e.target.value })} /></label>
            <button type="button" className="workspace-button primary" disabled={!canManage || saving !== null} onClick={publishSetupPrice}>{saving === 'setup-price' ? 'Publishing…' : 'Publish Branch setup price'}</button>
          </div>
        </article>

        <article className="workspace-module-card">
          <h3>3. Initial annual purchase</h3><p>Create one immutable annual order from effective governed pricing and selected active Branches.</p>
          <div className="workspace-form-stack">
            <div><strong>Branches</strong><div className="workspace-filter-row" style={{ marginTop: 8 }}>{onboarding.branches.filter((branch) => branch.active).map((branch) => <label key={branch.id} className="workspace-check-pill"><input type="checkbox" checked={purchaseForm.branchIds.includes(branch.id)} onChange={() => toggleBranch(branch.id)} />{branch.name}</label>)}</div></div>
            <label>Installment structure<select value={purchaseForm.structureCode} onChange={(e) => setPurchaseForm({ ...purchaseForm, structureCode: e.target.value })}><option value="two_installment_70_30">70% + 30%</option><option value="three_installment_60_20_20">60% + 20% + 20%</option></select></label>
            <label>Commercial order reference<input maxLength={128} value={purchaseForm.orderReference} onChange={(e) => setPurchaseForm({ ...purchaseForm, orderReference: e.target.value })} placeholder="e.g. ST-2026-0001" /></label>
            <label>Creation reason<input maxLength={1000} value={purchaseForm.reason} onChange={(e) => setPurchaseForm({ ...purchaseForm, reason: e.target.value })} /></label>
            <button type="button" className="workspace-button primary" disabled={!canManage || saving !== null || !onboarding.eligibleForInitialInstallment} onClick={createInitialPurchase}>{saving === 'purchase' ? 'Creating…' : 'Create governed purchase'}</button>
          </div>
        </article>

        <article className="workspace-module-card">
          <h3>4. Agreement template</h3><p>Publish immutable legal text. Canonical commercial amounts are built server-side at issuance.</p>
          <div className="workspace-form-stack">
            <label>Agreement family<select value={templateForm.family} onChange={(e) => setTemplateForm({ ...templateForm, family: e.target.value })}>{AGREEMENT_FAMILIES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
            <div className="workspace-field-grid two"><label>Version<input maxLength={64} value={templateForm.versionCode} onChange={(e) => setTemplateForm({ ...templateForm, versionCode: e.target.value })} /></label><label>Effective from<input type="datetime-local" value={templateForm.effectiveFrom} onChange={(e) => setTemplateForm({ ...templateForm, effectiveFrom: e.target.value })} /></label></div>
            <label>Title<input maxLength={200} value={templateForm.title} onChange={(e) => setTemplateForm({ ...templateForm, title: e.target.value })} /></label>
            <label>Template content<textarea rows={6} maxLength={200000} value={templateForm.contentBody} onChange={(e) => setTemplateForm({ ...templateForm, contentBody: e.target.value })} /></label>
            <label>Publication reason<input maxLength={1000} value={templateForm.reason} onChange={(e) => setTemplateForm({ ...templateForm, reason: e.target.value })} /></label>
            <button type="button" className="workspace-button primary" disabled={!canManage || saving !== null} onClick={publishTemplate}>{saving === 'template' ? 'Publishing…' : 'Publish agreement template'}</button>
          </div>
        </article>

        <article className="workspace-module-card" style={{ gridColumn: '1 / -1' }}>
          <h3>5. Issue merchant agreement</h3><p>Issue against the exact immutable order and installment obligation. Merchant acceptance remains separate.</p>
          <div className="workspace-form-stack">
            <div className="workspace-field-grid two"><label>Commercial order<select value={agreementForm.commercialOrderId} onChange={(e) => setAgreementForm({ ...agreementForm, commercialOrderId: e.target.value })}><option value="">Select order</option>{onboarding.orders.map((order) => <option key={order.id} value={order.id}>{order.reference} · {money(order.totalGrossAmount, order.currency)}</option>)}</select></label><label>Template<select value={agreementForm.templateVersionId} onChange={(e) => setAgreementForm({ ...agreementForm, templateVersionId: e.target.value })}><option value="">Select template</option>{onboarding.templates.map((template) => <option key={template.id} value={template.id}>{template.title} · {template.versionCode}</option>)}</select></label></div>
            <label>Agreement reference<input maxLength={128} value={agreementForm.reference} onChange={(e) => setAgreementForm({ ...agreementForm, reference: e.target.value })} /></label>
            <label>Rendered agreement content<textarea rows={8} maxLength={300000} value={agreementForm.renderedContent} onChange={(e) => setAgreementForm({ ...agreementForm, renderedContent: e.target.value })} /></label>
            <label>Issuance reason<input maxLength={1000} value={agreementForm.reason} onChange={(e) => setAgreementForm({ ...agreementForm, reason: e.target.value })} /></label>
            <button type="button" className="workspace-button primary" disabled={!canManage || saving !== null || !selectedOrder || !agreementForm.templateVersionId} onClick={issueAgreement}>{saving === 'agreement' ? 'Issuing…' : 'Issue merchant agreement'}</button>
          </div>
        </article>
      </div>

      <div className="workspace-table-wrap" style={{ marginTop: 18 }}><table className="workspace-table compact-table"><thead><tr><th>Published price</th><th>Cycle</th><th>Gross</th><th>Tax</th><th>Effective</th></tr></thead><tbody>{onboarding.prices.map((price) => <tr key={price.id}><td>{price.priceKind === 'branch_setup' ? 'Branch setup' : price.planCode ?? 'Subscription'}</td><td>{price.billingCycle ?? 'One-time'}</td><td>{money(price.grossAmount,price.currency)}</td><td>{price.taxRatePercent === null ? 'Not separately recorded' : `${price.taxRatePercent}%`}</td><td>{formatDate(price.effectiveFrom)}</td></tr>)}{!onboarding.prices.length ? <tr><td colSpan={5}>No governed pricing has been published.</td></tr> : null}</tbody></table></div>
    </section> : null}

    {overview ? <section className="workspace-panel" style={{ gridColumn: '1 / -1' }}>
      <div className="workspace-panel-heading"><div><h2>Branch setup readiness</h2><p>Readiness is immutable and tied to the exact Branch setup purchase line.</p></div></div>
      <div className="workspace-table-wrap"><table className="workspace-table compact-table"><thead><tr><th>Branch</th><th>Order</th><th>Setup line</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>{overview.branchSetup.map((row) => <tr key={setupKey(row)}><td><strong>{row.branchName}</strong><small>{row.branchCode}</small></td><td>{shortId(row.commercialOrderId)}</td><td>{row.description}</td><td>{money(row.grossAmount,row.currency)}</td><td><span className={`workspace-status ${row.ready ? 'success' : 'attention'}`}>{row.ready ? 'Ready' : 'Pending'}</span></td><td>{row.ready ? 'Immutable' : canManage ? <button type="button" className="workspace-button subtle compact" onClick={() => openSetupForm(row)}>Record ready</button> : 'Review only'}</td></tr>)}{!overview.branchSetup.length ? <tr><td colSpan={6}>No Branch setup purchase lines.</td></tr> : null}</tbody></table></div>
      {setupForm ? (() => { const row = overview.branchSetup.find((item) => setupKey(item) === setupForm.key); return row ? <div className="workspace-form-stack" style={{ marginTop: 16 }}><div className="workspace-banner warning"><strong>Immutable fact.</strong> Record readiness only after {row.branchName} setup is actually complete.</div><div className="workspace-field-grid two"><label>Completion time<input type="datetime-local" value={setupForm.readyAtLocal} onChange={(e) => setSetupForm({ ...setupForm, readyAtLocal: e.target.value })} /></label><label>Reason<input maxLength={1000} value={setupForm.reason} onChange={(e) => setSetupForm({ ...setupForm, reason: e.target.value })} /></label></div><label className="workspace-check-pill"><input type="checkbox" checked={setupForm.confirmed} onChange={(e) => setSetupForm({ ...setupForm, confirmed: e.target.checked })} />I confirm this Branch setup is complete.</label><div className="workspace-filter-row"><button type="button" className="workspace-button primary" disabled={saving !== null || !setupForm.confirmed} onClick={() => void markSetupReady(row)}>{saving === 'setup-ready' ? 'Recording…' : 'Record setup ready'}</button><button type="button" className="workspace-button subtle" disabled={saving !== null} onClick={() => setSetupForm(null)}>Cancel</button></div></div> : null; })() : null}
    </section> : null}

    {overview ? <section className="workspace-panel" style={{ gridColumn: '1 / -1' }}>
      <div className="workspace-panel-heading"><div><h2>Installment entitlement</h2><p>No due-date, grace or suspension semantics are inferred.</p></div></div>
      {overview.installmentBilling.length ? <div className="workspace-form-stack">{overview.installmentBilling.map((item) => <article key={item.installmentObligationId} className="workspace-module-card"><div className="workspace-panel-heading"><div><h3>{structureLabel(item.structureCode)}</h3><p>{money(item.obligatedAmount,item.currency)} · {item.paidInstallmentCount} of {item.installmentCount} installments confirmed</p></div><span className="workspace-status info">{label(item.entitlementState)}</span></div><div className="workspace-detail-grid"><Detail label="Agreement" value={item.agreementAccepted ? 'Accepted' : 'Awaiting acceptance'} /><Detail label="Branch setup" value={item.setupReady ? 'Ready' : `${item.setupReadyCount} of ${item.setupRequiredCount} ready`} /><Detail label="Activation" value={item.activationAt ? formatDate(item.activationAt) : 'Not activated'} /><Detail label="Entitlement end" value={item.fullTermUntil ? formatDate(item.fullTermUntil) : item.provisionalUntil ? formatDate(item.provisionalUntil) : 'Pending prerequisites'} /></div><div className="workspace-table-wrap"><table className="workspace-table compact-table"><thead><tr><th>Installment</th><th>Share</th><th>Amount</th><th>Due</th><th>Payment</th></tr></thead><tbody>{item.schedule.map((line) => <tr key={line.id}><td>{line.sequenceNo}</td><td>{line.percentage}%</td><td>{money(line.amountDue,item.currency)}</td><td>{line.dueAt ? formatDate(line.dueAt) : 'Not scheduled'}</td><td>{line.paymentStatus === 'paid' ? `Paid${line.paidAt ? ` ${formatDate(line.paidAt)}` : ''}` : 'Unpaid'}</td></tr>)}</tbody></table></div></article>)}</div> : <Empty title="No installment purchase" body="This Business has no governed C1B installment obligation." />}
    </section> : null}
  </div>;
}

function parseOverview(value: unknown): CommercialOverview {
  const root = record(value);
  return {
    canManage: root.canManage === true,
    installmentBilling: array(root.installmentBilling).map((value) => {
      const row = record(value);
      return {
        commercialOrderId: stringValue(row.commercialOrderId), installmentObligationId: stringValue(row.installmentObligationId), structureCode: stringValue(row.structureCode), currency: stringValue(row.currency,'NGN'), obligatedAmount: numberValue(row.obligatedAmount), agreementAccepted: row.agreementAccepted === true, setupRequiredCount: numberValue(row.setupRequiredCount), setupReadyCount: numberValue(row.setupReadyCount), setupReady: row.setupReady === true, paidInstallmentCount: numberValue(row.paidInstallmentCount), installmentCount: numberValue(row.installmentCount), entitlementState: stringValue(row.entitlementState,'pending'), activationAt: nullableString(row.activationAt), provisionalUntil: nullableString(row.provisionalUntil), fullTermUntil: nullableString(row.fullTermUntil),
        schedule: array(row.schedule).map((item) => { const line=record(item); return { id:stringValue(line.id), sequenceNo:numberValue(line.sequenceNo), percentage:numberValue(line.percentage), amountDue:numberValue(line.amountDue), dueAt:nullableString(line.dueAt), paymentStatus:line.paymentStatus==='paid'?'paid':'unpaid', paidAt:nullableString(line.paidAt) }; }),
      } as InstallmentState;
    }).filter((row) => row.installmentObligationId),
    branchSetup: array(root.branchSetup).map((value) => { const row=record(value); return { commercialOrderId:stringValue(row.commercialOrderId), installmentObligationId:nullableString(row.installmentObligationId), lineNo:numberValue(row.lineNo), branchId:stringValue(row.branchId), branchCode:stringValue(row.branchCode), branchName:stringValue(row.branchName,'Branch'), description:stringValue(row.description,'Branch setup'), currency:stringValue(row.currency,'NGN'), grossAmount:numberValue(row.grossAmount), ready:row.ready===true, readinessId:nullableString(row.readinessId), readyAt:nullableString(row.readyAt) } as BranchSetupState; }).filter((row) => row.commercialOrderId && row.branchId),
  };
}

function parseOnboarding(value: unknown): CommercialOnboarding {
  const root = record(value);
  const runtime = record(root.runtimeCompatibility);
  const state = record(root.onboardingState);
  return {
    canManage: root.canManage === true,
    eligibleForInitialInstallment: runtime.eligibleForInitialInstallment === true,
    planCode: nullableString(runtime.planCode),
    plans: array(root.plans).map((value) => { const row=record(value); return { code:stringValue(row.code), name:stringValue(row.name), currency:stringValue(row.currency,'NGN'), active:row.active===true }; }).filter((row) => row.code),
    branches: array(root.branches).map((value) => { const row=record(value); return { id:stringValue(row.id), code:stringValue(row.code), name:stringValue(row.name,'Branch'), active:row.active===true, isDefault:row.isDefault===true }; }).filter((row) => row.id),
    prices: array(root.prices).map((value) => { const row=record(value); return { id:stringValue(row.id), priceKind:row.priceKind==='branch_setup'?'branch_setup':'subscription', planCode:nullableString(row.planCode), billingCycle:row.billingCycle==='monthly'||row.billingCycle==='yearly'?row.billingCycle:null, currency:stringValue(row.currency,'NGN'), grossAmount:numberValue(row.grossAmount), taxRatePercent:nullableNumber(row.taxRatePercent), effectiveFrom:stringValue(row.effectiveFrom) } as OnboardingPrice; }).filter((row) => row.id),
    orders: array(root.orders).map((value) => { const row=record(value); return { id:stringValue(row.id), reference:stringValue(row.reference), currency:stringValue(row.currency,'NGN'), totalGrossAmount:numberValue(row.totalGrossAmount), orderedAt:stringValue(row.orderedAt), installmentObligationId:nullableString(row.installmentObligationId), structureCode:nullableString(row.structureCode) }; }).filter((row) => row.id),
    templates: array(root.templates).map((value) => { const row=record(value); return { id:stringValue(row.id), family:stringValue(row.family), versionCode:stringValue(row.versionCode), title:stringValue(row.title), effectiveFrom:stringValue(row.effectiveFrom), publishedAt:stringValue(row.publishedAt) }; }).filter((row) => row.id),
    agreements: array(root.agreements).map((value) => { const row=record(value); return { id:stringValue(row.id), commercialOrderId:stringValue(row.commercialOrderId), reference:stringValue(row.reference), accepted:row.accepted===true }; }).filter((row) => row.id),
    onboardingState: Object.keys(state).length ? {
      stage: stringValue(state.stage,'commercial_review'),
      merchantMessage: stringValue(state.merchantMessage,'SellerTray onboarding status is unavailable.'),
      nextActionLabel: stringValue(state.nextActionLabel,'Review'),
      operationalAccessAllowed: state.operationalAccessAllowed === true,
      activationComplete: state.activationComplete === true,
      activeBranchCount: numberValue(state.activeBranchCount),
      setupRequiredCount: numberValue(state.setupRequiredCount),
      setupReadyCount: numberValue(state.setupReadyCount),
      blockers: array(state.blockers).filter((value): value is string => typeof value === 'string' && value.length > 0),
    } : null,
  };
}

function Detail({ label: text, value }: { label: string; value: string }) { return <div><span>{text}</span><strong>{value}</strong></div>; }
function Empty({ title, body }: { title: string; body: string }) { return <div className="workspace-empty"><strong>{title}</strong><p>{body}</p></div>; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function stringValue(value: unknown, fallback=''): string { return typeof value === 'string' ? value : fallback; }
function nullableString(value: unknown): string | null { return typeof value === 'string' && value ? value : null; }
function numberValue(value: unknown): number { const result=typeof value==='number'?value:Number(value); return Number.isFinite(result)?result:0; }
function nullableNumber(value: unknown): number | null { if (value===null||value===undefined||value==='') return null; const result=Number(value); return Number.isFinite(result)?result:null; }
function positiveNumber(value: string): number | null { const result=Number(value); return Number.isFinite(result)&&result>0?Math.round(result*100)/100:null; }
function optionalPercent(value: string): number | null | undefined { if (!value.trim()) return null; const result=Number(value); return Number.isFinite(result)&&result>=0&&result<=100?result:undefined; }
function money(value: number, currency: string) { try { return new Intl.NumberFormat('en-NG',{style:'currency',currency:currency||'NGN',maximumFractionDigits:2}).format(value); } catch { return `${currency} ${value.toFixed(2)}`; } }
function formatDate(value: string) { const date=new Date(value); return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat('en-NG',{dateStyle:'medium',timeStyle:'short'}).format(date); }
function nowLocal() { const date=new Date(Date.now()-new Date().getTimezoneOffset()*60000); return date.toISOString().slice(0,16); }
function isoFromLocal(value: string): string | null { const date=new Date(value); return Number.isNaN(date.getTime())?null:date.toISOString(); }
function setupKey(row: BranchSetupState) { return `${row.commercialOrderId}:${row.branchId}`; }
function shortId(value: string) { return value.length>12?`${value.slice(0,8)}…`:value; }
function label(value: string) { return value.replace(/_/g,' ').replace(/\b\w/g,(letter)=>letter.toUpperCase()); }
function structureLabel(value: string) { return value==='two_installment_70_30'?'70% + 30%':value==='three_installment_60_20_20'?'60% + 20% + 20%':label(value); }
function messageFrom(cause: unknown, fallback: string) { return cause instanceof Error && cause.message ? cause.message : fallback; }
