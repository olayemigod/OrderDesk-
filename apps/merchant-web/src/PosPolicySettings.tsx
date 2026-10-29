import { useEffect, useState, type FormEvent } from 'react';

import { SellerTrayInput, SellerTraySelect } from './SellerTrayElements';
import { errorMessage, supabase } from './supabase';
import { TaxSettings } from './TaxSettings';

type PosPolicy = {
  allowPriceOverride: boolean;
  allowSplitPayments: boolean;
  allowPartialPayments: boolean;
  allowPayLater: boolean;
  manualConfirmationMode: 'branch_operator' | 'payment_manager';
};

const DEFAULT_POLICY: PosPolicy = {
  allowPriceOverride: true,
  allowSplitPayments: true,
  allowPartialPayments: false,
  allowPayLater: false,
  manualConfirmationMode: 'branch_operator',
};

export function PosPolicySettings({ tenantId }: { tenantId: string }) {
  const [policy, setPolicy] = useState<PosPolicy>(DEFAULT_POLICY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc('sellertray_get_pos_policy', { p_tenant_id: tenantId });
        if (rpcError) throw rpcError;
        if (active) setPolicy(parsePolicy(data));
      } catch (cause: unknown) {
        if (active) setError(errorMessage(cause, 'Unable to load POS settings.'));
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => { active = false; };
  }, [tenantId]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('sellertray_save_pos_policy', {
        p_tenant_id: tenantId,
        p_allow_price_override: policy.allowPriceOverride,
        p_allow_split_payments: policy.allowSplitPayments,
        p_allow_partial_payments: policy.allowPartialPayments,
        p_allow_pay_later: policy.allowPayLater,
        p_manual_confirmation_mode: policy.manualConfirmationMode,
      });
      if (rpcError) throw rpcError;
      setPolicy(parsePolicy(data));
      setMessage('POS payment and price rules saved.');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to save POS settings.'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <article className="panel"><p className="muted">Loading POS settings…</p></article>;
  }

  return (
    <>
      <form className="panel settings-form" onSubmit={save}>
        <div className="panel-head">
          <div>
            <p className="eyebrow">Point of sale</p>
            <h3>Price & payment controls</h3>
            <p className="muted">These rules apply to SellerTray counter sales. Mobile performs the sale; Merchant Web controls what staff may do.</p>
          </div>
        </div>

        {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
        {message ? <div className="success-banner">{message}<button type="button" onClick={() => setMessage(null)}>Dismiss</button></div> : null}

        <div className="settings-check-grid">
          <Toggle label="Allow authorised staff to change draft selling prices" checked={policy.allowPriceOverride} onChange={(value) => setPolicy((current) => ({ ...current, allowPriceOverride: value }))} />
          <Toggle label="Allow more than one payment method on a sale" checked={policy.allowSplitPayments} onChange={(value) => setPolicy((current) => ({ ...current, allowSplitPayments: value }))} />
          <Toggle label="Allow a sale to complete after a partial payment" checked={policy.allowPartialPayments} onChange={(value) => setPolicy((current) => ({ ...current, allowPartialPayments: value }))} />
          <Toggle label="Allow a sale to complete with no payment yet" checked={policy.allowPayLater} onChange={(value) => setPolicy((current) => ({ ...current, allowPayLater: value }))} />
        </div>

        <div className="settings-grid two">
          <label className="settings-field">
            <span>Who can confirm bank transfer or terminal payments?</span>
            <SellerTraySelect
              value={policy.manualConfirmationMode}
              onChange={(event) => setPolicy((current) => ({
                ...current,
                manualConfirmationMode: event.target.value === 'payment_manager' ? 'payment_manager' : 'branch_operator',
              }))}
            >
              <option value="branch_operator">Branch operators handling the sale</option>
              <option value="payment_manager">Payment managers only</option>
            </SellerTraySelect>
          </label>
        </div>

        <p className="muted">Cash is different: it is confirmed by the cashier receiving physical money and affects that Branch cash drawer. Bank transfer and terminal confirmation authority follows the rule above.</p>
        <p className="muted">A sale is marked Paid only after confirmed payments cover the invoice. Partial or Pay later sales keep the remaining balance outstanding.</p>

        <div className="settings-actions">
          <button className="primary-button" disabled={saving}>{saving ? 'Saving' : 'Save POS controls'}</button>
        </div>
      </form>
      <TaxSettings tenantId={tenantId} />
    </>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="settings-toggle"><SellerTrayInput type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
}

function parsePolicy(value: unknown): PosPolicy {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    allowPriceOverride: row.allowPriceOverride !== false,
    allowSplitPayments: row.allowSplitPayments !== false,
    allowPartialPayments: row.allowPartialPayments === true,
    allowPayLater: row.allowPayLater === true,
    manualConfirmationMode: row.manualConfirmationMode === 'payment_manager' ? 'payment_manager' : 'branch_operator',
  };
}
