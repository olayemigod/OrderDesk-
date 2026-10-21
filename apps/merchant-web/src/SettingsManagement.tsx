import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { errorMessage, supabase } from './supabase';
import { PosPolicySettings } from './PosPolicySettings';
import { SellerTrayInput, SellerTraySelect, SellerTrayTextarea } from './SellerTrayElements';

type PaymentGate = 'none' | 'before_processing' | 'before_ready' | 'before_fulfillment';
type WhatsAppPushMode = 'actionable_only' | 'all_messages' | 'orders_payments_only';
type PaymentMethodType = 'bank_transfer' | 'card_terminal' | 'paystack' | 'flutterwave' | 'cash_on_delivery' | 'pay_on_pickup';
type PaymentMode = 'test' | 'live';
type SettingsTab = 'business' | 'selling' | 'pos' | 'payments';

type BusinessProfile = { name: string; businessEmail: string; businessPhone: string; businessType: string; logoUrl: string; currency: string; timezone: string };
type OperationalPolicy = {
  paymentGate: PaymentGate;
  allowCodDispatchUnpaid: boolean;
  requireCodPaymentBeforeCompletion: boolean;
  allowPickupReadyUnpaid: boolean;
  requirePickupPaymentBeforeCompletion: boolean;
  requireDeliveryProvider: boolean;
  requireDeliveryReference: boolean;
  requireCustomerDeliveryConfirmation: boolean;
  whatsappPushMode: WhatsAppPushMode;
};
type PaymentMethod = {
  id: string;
  methodType: PaymentMethodType;
  displayName: string;
  isEnabled: boolean;
  isDefault: boolean;
  sortOrder: number;
  mode: PaymentMode;
  configurationStatus: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankCode: string;
  instructions: string;
};
type PaymentDraft = Omit<PaymentMethod, 'id' | 'configurationStatus'>;

const DEFAULT_POLICY: OperationalPolicy = {
  paymentGate: 'before_fulfillment',
  allowCodDispatchUnpaid: true,
  requireCodPaymentBeforeCompletion: true,
  allowPickupReadyUnpaid: true,
  requirePickupPaymentBeforeCompletion: true,
  requireDeliveryProvider: false,
  requireDeliveryReference: false,
  requireCustomerDeliveryConfirmation: false,
  whatsappPushMode: 'actionable_only',
};
const EMPTY_PAYMENT: PaymentDraft = {
  methodType: 'bank_transfer', displayName: 'Bank Transfer', isEnabled: true, isDefault: false,
  sortOrder: 100, mode: 'live', bankName: '', bankAccountName: '', bankAccountNumber: '', bankCode: '', instructions: '',
};
const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'business', label: 'Business Profile' },
  { id: 'selling', label: 'Selling & Fulfilment' },
  { id: 'pos', label: 'POS Policy' },
  { id: 'payments', label: 'Payments' },
];

export default function SettingsManagement({ tenantId }: { tenantId: string }) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('business');
  const [profile, setProfile] = useState<BusinessProfile>({ name: '', businessEmail: '', businessPhone: '', businessType: '', logoUrl: '', currency: 'NGN', timezone: 'Africa/Lagos' });
  const [policy, setPolicy] = useState<OperationalPolicy>(DEFAULT_POLICY);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [selectedMethodId, setSelectedMethodId] = useState<string | null>(null);
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft>(EMPTY_PAYMENT);
  const [secretKey, setSecretKey] = useState('');
  const [secretHash, setSecretHash] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedMethod = useMemo(() => methods.find((row) => row.id === selectedMethodId) ?? null, [methods, selectedMethodId]);
  const gatewaySelected = paymentDraft.methodType === 'paystack' || paymentDraft.methodType === 'flutterwave';
  const terminalSelected = paymentDraft.methodType === 'card_terminal';

  useEffect(() => { setActiveTab('business'); void loadAll(); }, [tenantId]);
  useEffect(() => {
    if (!selectedMethod) return;
    setPaymentDraft({
      methodType: selectedMethod.methodType,
      displayName: selectedMethod.displayName,
      isEnabled: selectedMethod.isEnabled,
      isDefault: selectedMethod.methodType === 'card_terminal' ? false : selectedMethod.isDefault,
      sortOrder: selectedMethod.sortOrder,
      mode: selectedMethod.mode,
      bankName: selectedMethod.bankName,
      bankAccountName: selectedMethod.bankAccountName,
      bankAccountNumber: selectedMethod.bankAccountNumber,
      bankCode: selectedMethod.bankCode,
      instructions: selectedMethod.instructions,
    });
    setSecretKey('');
    setSecretHash('');
  }, [selectedMethod]);

  async function loadAll(preferredMethodId?: string | null) {
    setLoading(true); setError(null);
    try {
      const [profileResult, policyResult, methodsResult] = await Promise.all([
        supabase.rpc('get_sellertray_business_profile', { p_tenant_id: tenantId }),
        supabase.rpc('sellertray_get_operational_policy', { p_tenant_id: tenantId }),
        supabase.from('merchant_payment_methods').select('id,method_type,display_name,is_enabled,is_default,sort_order,mode,configuration_status,bank_name,bank_account_name,bank_account_number,bank_code,instructions').eq('tenant_id', tenantId).order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      ]);
      if (profileResult.error) throw profileResult.error;
      if (policyResult.error) throw policyResult.error;
      if (methodsResult.error) throw methodsResult.error;
      const profileRow = Array.isArray(profileResult.data) ? profileResult.data[0] : profileResult.data;
      setProfile(parseBusinessProfile(profileRow));
      setPolicy(parsePolicy(policyResult.data));
      const nextMethods = ((methodsResult.data ?? []) as Array<Record<string, unknown>>).map(parsePaymentMethod).filter((row) => row.id);
      setMethods(nextMethods);
      const wanted = preferredMethodId ?? selectedMethodId;
      const nextId = wanted && nextMethods.some((row) => row.id === wanted) ? wanted : nextMethods.find((row) => row.isDefault)?.id ?? nextMethods[0]?.id ?? null;
      setSelectedMethodId(nextId);
      if (!nextId) setPaymentDraft(EMPTY_PAYMENT);
    } catch (cause) { setError(errorMessage(cause, 'Unable to load business settings.')); }
    finally { setLoading(false); }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault(); setBusy('profile'); clearNotice();
    try {
      const name = profile.name.trim(); const currency = profile.currency.trim().toUpperCase(); const timezone = profile.timezone.trim();
      if (!name) throw new Error('Business name is required.');
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency must be a 3-letter code.');
      if (!timezone) throw new Error('Timezone is required.');
      const { data, error: rpcError } = await supabase.rpc('save_sellertray_business_profile', {
        p_tenant_id: tenantId,
        p_name: name,
        p_business_email: clean(profile.businessEmail),
        p_business_phone: clean(profile.businessPhone),
        p_business_type: clean(profile.businessType),
        p_logo_url: clean(profile.logoUrl),
        p_currency: currency,
        p_timezone: timezone,
      });
      if (rpcError) throw rpcError;
      setProfile(parseBusinessProfile(data));
      setMessage('Business profile saved.');
    } catch (cause) { setError(errorMessage(cause, 'Unable to save the business profile.')); }
    finally { setBusy(null); }
  }

  async function savePolicy(event: FormEvent) {
    event.preventDefault(); setBusy('policy'); clearNotice();
    try {
      const { data, error: rpcError } = await supabase.rpc('sellertray_save_operational_policy', {
        p_tenant_id: tenantId, p_payment_gate: policy.paymentGate,
        p_allow_cod_dispatch_unpaid: policy.allowCodDispatchUnpaid,
        p_require_cod_payment_before_completion: policy.requireCodPaymentBeforeCompletion,
        p_allow_pickup_ready_unpaid: policy.allowPickupReadyUnpaid,
        p_require_pickup_payment_before_completion: policy.requirePickupPaymentBeforeCompletion,
        p_require_delivery_provider: policy.requireDeliveryProvider,
        p_require_delivery_reference: policy.requireDeliveryReference,
        p_require_customer_delivery_confirmation: policy.requireCustomerDeliveryConfirmation,
        p_whatsapp_push_mode: policy.whatsappPushMode,
      });
      if (rpcError) throw rpcError;
      setPolicy(parsePolicy(data)); setMessage('Selling and fulfilment rules saved.');
    } catch (cause) { setError(errorMessage(cause, 'Unable to save selling and fulfilment rules.')); }
    finally { setBusy(null); }
  }

  function newPaymentMethod(type: PaymentMethodType = 'bank_transfer') {
    setSelectedMethodId(null);
    setPaymentDraft({ ...EMPTY_PAYMENT, methodType: type, displayName: paymentLabel(type), isDefault: false });
    setSecretKey(''); setSecretHash(''); clearNotice();
  }

  async function savePaymentMethod(event: FormEvent) {
    event.preventDefault(); setBusy('payment'); clearNotice();
    try {
      const displayName = paymentDraft.displayName.trim();
      if (!displayName) throw new Error('Payment method name is required.');
      const { data, error: functionError } = await supabase.functions.invoke('payment-settings', { body: {
        action: 'save_method', tenantId, methodId: selectedMethodId, methodType: paymentDraft.methodType, displayName,
        isEnabled: paymentDraft.isEnabled, isDefault: terminalSelected ? false : paymentDraft.isDefault,
        sortOrder: paymentDraft.sortOrder, mode: paymentDraft.mode,
        bankName: clean(paymentDraft.bankName), bankAccountName: clean(paymentDraft.bankAccountName), bankAccountNumber: clean(paymentDraft.bankAccountNumber), bankCode: clean(paymentDraft.bankCode), instructions: clean(paymentDraft.instructions),
      }});
      if (functionError) throw functionError;
      const methodId = typeof object(object(data).method).id === 'string' ? String(object(object(data).method).id) : selectedMethodId;
      if (!methodId) throw new Error('SellerTray did not return the saved payment method.');
      setMessage(terminalSelected ? 'Card terminal saved. Assign it to Branches below.' : 'Payment method saved.');
      await loadAll(methodId);
    } catch (cause) { setError(errorMessage(cause, 'Unable to save this payment method.')); }
    finally { setBusy(null); }
  }

  async function connectGateway() {
    if (!selectedMethod || (selectedMethod.methodType !== 'paystack' && selectedMethod.methodType !== 'flutterwave')) return;
    setBusy('gateway'); clearNotice();
    try {
      if (!secretKey.trim()) throw new Error('Enter the gateway secret key.');
      if (selectedMethod.methodType === 'flutterwave' && !secretHash.trim()) throw new Error('Enter the Flutterwave webhook secret hash.');
      const { error: functionError } = await supabase.functions.invoke('payment-settings', { body: {
        action: 'connect_gateway', tenantId, methodId: selectedMethod.id, provider: selectedMethod.methodType,
        secretKey: secretKey.trim(), secretHash: selectedMethod.methodType === 'flutterwave' ? secretHash.trim() : null,
      }});
      if (functionError) throw functionError;
      setSecretKey(''); setSecretHash(''); setMessage(`${paymentLabel(selectedMethod.methodType)} credentials connected securely.`); await loadAll(selectedMethod.id);
    } catch (cause) { setError(errorMessage(cause, 'Unable to connect gateway credentials.')); }
    finally { setBusy(null); }
  }

  async function disconnectGateway() {
    if (!selectedMethod || (selectedMethod.methodType !== 'paystack' && selectedMethod.methodType !== 'flutterwave')) return;
    setBusy('gateway'); clearNotice();
    try {
      const { error: functionError } = await supabase.functions.invoke('payment-settings', { body: { action: 'disconnect_gateway', tenantId, methodId: selectedMethod.id } });
      if (functionError) throw functionError;
      setMessage(`${paymentLabel(selectedMethod.methodType)} credentials disconnected.`); await loadAll(selectedMethod.id);
    } catch (cause) { setError(errorMessage(cause, 'Unable to disconnect gateway credentials.')); }
    finally { setBusy(null); }
  }

  function clearNotice() { setError(null); setMessage(null); }

  if (loading) return <article className="panel"><p className="muted">Loading business settings…</p></article>;

  return <div className="page-stack settings-page">
    <div className="section-heading"><div><p className="eyebrow">Merchant management</p><h2>Settings</h2></div><p className="muted">Business identity, selling rules and payment configuration use the same governed SellerTray controls as mobile and WhatsApp.</p></div>
    {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button type="button" onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    <div className="settings-tabs" role="tablist" aria-label="SellerTray settings">
      {SETTINGS_TABS.map((item) => <button
        key={item.id}
        id={`settings-tab-${item.id}`}
        type="button"
        role="tab"
        aria-selected={activeTab === item.id}
        aria-controls={`settings-panel-${item.id}`}
        className={activeTab === item.id ? 'settings-tab active' : 'settings-tab'}
        onClick={() => setActiveTab(item.id)}
      >{item.label}</button>)}
    </div>

    <div id="settings-panel-business" role="tabpanel" aria-labelledby="settings-tab-business" hidden={activeTab !== 'business'}>
      <form className="panel settings-form" onSubmit={saveProfile}>
        <div className="panel-head"><div><p className="eyebrow">Business profile</p><h3>Business details</h3><p className="muted">These details are shared business identity. Currency and timezone affect SellerTray management and reporting context.</p></div></div>
        <div className="settings-grid two">
          <Field label="Business name"><SellerTrayInput required maxLength={160} value={profile.name} onChange={(event) => setProfile((current) => ({ ...current, name: event.target.value }))} /></Field>
          <Field label="Business type"><SellerTrayInput maxLength={120} value={profile.businessType} onChange={(event) => setProfile((current) => ({ ...current, businessType: event.target.value }))} placeholder="Retail, fashion, services…" /></Field>
          <Field label="Business email"><SellerTrayInput type="email" maxLength={320} value={profile.businessEmail} onChange={(event) => setProfile((current) => ({ ...current, businessEmail: event.target.value }))} /></Field>
          <Field label="Business phone"><SellerTrayInput maxLength={60} value={profile.businessPhone} onChange={(event) => setProfile((current) => ({ ...current, businessPhone: event.target.value }))} /></Field>
          <Field label="Currency"><SellerTrayInput maxLength={3} value={profile.currency} onChange={(event) => setProfile((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} /></Field>
          <Field label="Timezone"><SellerTrayInput value={profile.timezone} onChange={(event) => setProfile((current) => ({ ...current, timezone: event.target.value }))} placeholder="Africa/Lagos" /></Field>
        </div>
        <Field label="Logo URL"><SellerTrayInput type="url" value={profile.logoUrl} onChange={(event) => setProfile((current) => ({ ...current, logoUrl: event.target.value }))} placeholder="https://…" /></Field>
        <div className="settings-actions"><button className="primary-button" disabled={busy !== null}>{busy === 'profile' ? 'Saving' : 'Save business profile'}</button></div>
      </form>
    </div>

    <div id="settings-panel-selling" role="tabpanel" aria-labelledby="settings-tab-selling" hidden={activeTab !== 'selling'}>
      <form className="panel settings-form" onSubmit={savePolicy}>
        <div className="panel-head"><div><p className="eyebrow">Selling & fulfilment</p><h3>Order controls</h3></div></div>
        <div className="settings-grid two">
          <Field label="Payment required"><SellerTraySelect value={policy.paymentGate} onChange={(event) => setPolicy((current) => ({ ...current, paymentGate: event.target.value as PaymentGate }))}><option value="none">No payment gate</option><option value="before_processing">Before processing</option><option value="before_ready">Before ready</option><option value="before_fulfillment">Before fulfilment</option></SellerTraySelect></Field>
          <Field label="WhatsApp notifications"><SellerTraySelect value={policy.whatsappPushMode} onChange={(event) => setPolicy((current) => ({ ...current, whatsappPushMode: event.target.value as WhatsAppPushMode }))}><option value="actionable_only">Actionable messages only</option><option value="orders_payments_only">Orders & payments only</option><option value="all_messages">All messages</option></SellerTraySelect></Field>
        </div>
        <div className="settings-check-grid">
          <Toggle label="Allow cash-on-delivery dispatch before payment" checked={policy.allowCodDispatchUnpaid} onChange={(value) => setPolicy((current) => ({ ...current, allowCodDispatchUnpaid: value }))} />
          <Toggle label="Require COD payment before completion" checked={policy.requireCodPaymentBeforeCompletion} onChange={(value) => setPolicy((current) => ({ ...current, requireCodPaymentBeforeCompletion: value }))} />
          <Toggle label="Allow pickup order to become ready before payment" checked={policy.allowPickupReadyUnpaid} onChange={(value) => setPolicy((current) => ({ ...current, allowPickupReadyUnpaid: value }))} />
          <Toggle label="Require pickup payment before completion" checked={policy.requirePickupPaymentBeforeCompletion} onChange={(value) => setPolicy((current) => ({ ...current, requirePickupPaymentBeforeCompletion: value }))} />
          <Toggle label="Require delivery partner or rider" checked={policy.requireDeliveryProvider} onChange={(value) => setPolicy((current) => ({ ...current, requireDeliveryProvider: value }))} />
          <Toggle label="Require delivery reference or rider phone" checked={policy.requireDeliveryReference} onChange={(value) => setPolicy((current) => ({ ...current, requireDeliveryReference: value }))} />
          <Toggle label="Require customer delivery confirmation" checked={policy.requireCustomerDeliveryConfirmation} onChange={(value) => setPolicy((current) => ({ ...current, requireCustomerDeliveryConfirmation: value }))} />
        </div>
        <div className="settings-actions"><button className="primary-button" disabled={busy !== null}>{busy === 'policy' ? 'Saving' : 'Save order controls'}</button></div>
      </form>
    </div>

    <div id="settings-panel-pos" role="tabpanel" aria-labelledby="settings-tab-pos" hidden={activeTab !== 'pos'}>
      <PosPolicySettings tenantId={tenantId} />
    </div>

    <div id="settings-panel-payments" role="tabpanel" aria-labelledby="settings-tab-payments" hidden={activeTab !== 'payments'}>
      <div className="settings-payment-layout">
        <article className="panel settings-method-list">
          <div className="panel-head"><div><p className="eyebrow">Payments</p><h3>Payment methods</h3></div><button type="button" className="secondary-button" onClick={() => newPaymentMethod()}>New method</button></div>
          {methods.length ? <div className="device-list">{methods.map((row) => <button type="button" key={row.id} className={selectedMethodId === row.id ? 'device-row selected' : 'device-row'} onClick={() => setSelectedMethodId(row.id)}><span><strong>{row.displayName}</strong><small>{paymentLabel(row.methodType)} · {row.mode === 'test' ? 'Test' : 'Live'}</small></span><span className="device-row-badges">{row.isDefault ? <em>Default</em> : null}<em className={row.isEnabled ? 'good' : 'muted'}>{row.isEnabled ? 'Enabled' : 'Disabled'}</em></span></button>)}</div> : <div className="empty-state"><strong>No payment methods</strong><p>Add how customers or counter staff can receive payments.</p></div>}
        </article>

        <form className="panel settings-form" onSubmit={savePaymentMethod}>
          <div className="panel-head"><div><p className="eyebrow">Payment method</p><h3>{selectedMethod?.displayName ?? 'New method'}</h3></div>{selectedMethod ? <span className={`status-pill ${selectedMethod.configurationStatus === 'ready' || selectedMethod.configurationStatus === 'configured' ? 'good' : 'neutral'}`}>{label(selectedMethod.configurationStatus)}</span> : null}</div>
          <div className="settings-grid two">
            <Field label="Method"><SellerTraySelect value={paymentDraft.methodType} disabled={Boolean(selectedMethod)} onChange={(event) => { const methodType = event.target.value as PaymentMethodType; setPaymentDraft((current) => ({ ...current, methodType, displayName: paymentLabel(methodType), isDefault: methodType === 'card_terminal' ? false : current.isDefault })); }}><option value="bank_transfer">Bank Transfer</option><option value="card_terminal">Card Terminal</option><option value="paystack">Paystack</option><option value="flutterwave">Flutterwave</option><option value="cash_on_delivery">Cash on Delivery</option><option value="pay_on_pickup">Pay on Pickup</option></SellerTraySelect></Field>
            <Field label="Display name"><SellerTrayInput required value={paymentDraft.displayName} onChange={(event) => setPaymentDraft((current) => ({ ...current, displayName: event.target.value }))} /></Field>
            {gatewaySelected ? <Field label="Mode"><SellerTraySelect value={paymentDraft.mode} onChange={(event) => setPaymentDraft((current) => ({ ...current, mode: event.target.value === 'test' ? 'test' : 'live' }))}><option value="live">Live</option><option value="test">Test</option></SellerTraySelect></Field> : null}
            <Field label="Sort order"><SellerTrayInput type="number" min={0} max={1000} value={paymentDraft.sortOrder} onChange={(event) => setPaymentDraft((current) => ({ ...current, sortOrder: Number(event.target.value) || 0 }))} /></Field>
          </div>
          {paymentDraft.methodType === 'bank_transfer' ? <div className="settings-grid two"><Field label="Bank name"><SellerTrayInput value={paymentDraft.bankName} onChange={(event) => setPaymentDraft((current) => ({ ...current, bankName: event.target.value }))} /></Field><Field label="Account name"><SellerTrayInput value={paymentDraft.bankAccountName} onChange={(event) => setPaymentDraft((current) => ({ ...current, bankAccountName: event.target.value }))} /></Field><Field label="Account number"><SellerTrayInput value={paymentDraft.bankAccountNumber} onChange={(event) => setPaymentDraft((current) => ({ ...current, bankAccountNumber: event.target.value }))} /></Field><Field label="Bank code"><SellerTrayInput value={paymentDraft.bankCode} onChange={(event) => setPaymentDraft((current) => ({ ...current, bankCode: event.target.value }))} /></Field></div> : null}
          <Field label={terminalSelected ? 'Staff instructions' : 'Customer instructions'}><SellerTrayTextarea rows={3} maxLength={500} value={paymentDraft.instructions} onChange={(event) => setPaymentDraft((current) => ({ ...current, instructions: event.target.value }))} placeholder={terminalSelected ? 'Confirm terminal approval before completing the sale.' : 'Optional instructions shown during payment.'} /></Field>
          <div className="settings-check-grid compact"><Toggle label="Enabled" checked={paymentDraft.isEnabled} onChange={(value) => setPaymentDraft((current) => ({ ...current, isEnabled: value }))} />{!terminalSelected ? <Toggle label="Default customer payment method" checked={paymentDraft.isDefault} onChange={(value) => setPaymentDraft((current) => ({ ...current, isDefault: value, isEnabled: value ? true : current.isEnabled }))} /> : null}</div>
          {terminalSelected ? <p className="muted">Card terminals are in-person methods. They are never sent to WhatsApp customers and do not become the default customer payment method. Assign the terminal to Branches below.</p> : null}
          <div className="settings-actions"><button className="primary-button" disabled={busy !== null}>{busy === 'payment' ? 'Saving' : 'Save payment method'}</button></div>

          {selectedMethod && (selectedMethod.methodType === 'paystack' || selectedMethod.methodType === 'flutterwave') ? <div className="gateway-box">
            <div><p className="eyebrow">Gateway security</p><h4>{paymentLabel(selectedMethod.methodType)} credentials</h4><p className="muted">Secret values are encrypted by SellerTray and are never displayed again after submission.</p></div>
            <Field label="Secret key"><SellerTrayInput type="password" autoComplete="new-password" value={secretKey} onChange={(event) => setSecretKey(event.target.value)} placeholder={selectedMethod.mode === 'test' ? 'Test secret key' : 'Live secret key'} /></Field>
            {selectedMethod.methodType === 'flutterwave' ? <Field label="Webhook secret hash"><SellerTrayInput type="password" autoComplete="new-password" value={secretHash} onChange={(event) => setSecretHash(event.target.value)} /></Field> : null}
            <div className="settings-actions split"><button type="button" className="primary-button" disabled={busy !== null || !secretKey.trim()} onClick={() => void connectGateway()}>{busy === 'gateway' ? 'Updating' : 'Connect credentials'}</button><button type="button" className="secondary-button" disabled={busy !== null} onClick={() => void disconnectGateway()}>Disconnect credentials</button></div>
          </div> : null}
        </form>
      </div>
    </div>
  </div>;
}

function Field({ label: title, children }: { label: string; children: ReactNode }) { return <label className="settings-field"><span>{title}</span>{children}</label>; }
function Toggle({ label: title, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="settings-toggle"><SellerTrayInput type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{title}</span></label>; }
function parseBusinessProfile(value: unknown): BusinessProfile {
  const row = object(value);
  return {
    name: String(row.name ?? ''),
    businessEmail: optionalText(row.businessEmail ?? row.business_email),
    businessPhone: optionalText(row.businessPhone ?? row.business_phone),
    businessType: optionalText(row.businessType ?? row.business_type),
    logoUrl: optionalText(row.logoUrl ?? row.logo_url),
    currency: String(row.currency ?? 'NGN'),
    timezone: String(row.timezone ?? 'Africa/Lagos'),
  };
}
function parsePolicy(value: unknown): OperationalPolicy {
  const row = object(value); const paymentGate = row.paymentGate; const whatsappPushMode = row.whatsappPushMode;
  return {
    paymentGate: paymentGate === 'none' || paymentGate === 'before_processing' || paymentGate === 'before_ready' || paymentGate === 'before_fulfillment' ? paymentGate : DEFAULT_POLICY.paymentGate,
    allowCodDispatchUnpaid: booleanValue(row.allowCodDispatchUnpaid, true), requireCodPaymentBeforeCompletion: booleanValue(row.requireCodPaymentBeforeCompletion, true),
    allowPickupReadyUnpaid: booleanValue(row.allowPickupReadyUnpaid, true), requirePickupPaymentBeforeCompletion: booleanValue(row.requirePickupPaymentBeforeCompletion, true),
    requireDeliveryProvider: booleanValue(row.requireDeliveryProvider, false), requireDeliveryReference: booleanValue(row.requireDeliveryReference, false),
    requireCustomerDeliveryConfirmation: booleanValue(row.requireCustomerDeliveryConfirmation, false),
    whatsappPushMode: whatsappPushMode === 'all_messages' || whatsappPushMode === 'orders_payments_only' || whatsappPushMode === 'actionable_only' ? whatsappPushMode : DEFAULT_POLICY.whatsappPushMode,
  };
}
function parsePaymentMethod(row: Record<string, unknown>): PaymentMethod {
  const raw = String(row.method_type ?? 'bank_transfer');
  const methodType: PaymentMethodType = isPaymentMethodType(raw) ? raw : 'bank_transfer';
  return { id: String(row.id ?? ''), methodType, displayName: String(row.display_name ?? paymentLabel(methodType)), isEnabled: row.is_enabled === true, isDefault: row.is_default === true, sortOrder: numberValue(row.sort_order), mode: row.mode === 'test' ? 'test' : 'live', configurationStatus: String(row.configuration_status ?? 'configured'), bankName: optionalText(row.bank_name), bankAccountName: optionalText(row.bank_account_name), bankAccountNumber: optionalText(row.bank_account_number), bankCode: optionalText(row.bank_code), instructions: optionalText(row.instructions) };
}
function isPaymentMethodType(value: string): value is PaymentMethodType { return ['bank_transfer','card_terminal','paystack','flutterwave','cash_on_delivery','pay_on_pickup'].includes(value); }
function paymentLabel(type: PaymentMethodType): string { if (type === 'bank_transfer') return 'Bank Transfer'; if (type === 'card_terminal') return 'Card Terminal'; if (type === 'cash_on_delivery') return 'Cash on Delivery'; if (type === 'pay_on_pickup') return 'Pay on Pickup'; return type === 'paystack' ? 'Paystack' : 'Flutterwave'; }
function clean(value: string): string | null { const next = value.trim(); return next || null; }
function optionalText(value: unknown): string { return typeof value === 'string' ? value : ''; }
function booleanValue(value: unknown, fallback: boolean): boolean { return typeof value === 'boolean' ? value : fallback; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function numberValue(value: unknown): number { const parsed = typeof value === 'number' ? value : Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function label(value: string): string { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
