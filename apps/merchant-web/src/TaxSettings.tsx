import { useEffect, useState, type FormEvent } from 'react';

import { SellerTrayInput } from './SellerTrayElements';
import { errorMessage, supabase } from './supabase';

type TaxSettingsState = {
  configurationId: string | null;
  revision: number;
  isActive: boolean;
  ratePercent: number;
  displayTaxBreakdown: boolean;
};

const DEFAULT_TAX: TaxSettingsState = {
  configurationId: null,
  revision: 0,
  isActive: false,
  ratePercent: 0,
  displayTaxBreakdown: true,
};

export function TaxSettings({ tenantId }: { tenantId: string }) {
  const [settings, setSettings] = useState<TaxSettingsState>(DEFAULT_TAX);
  const [rateDraft, setRateDraft] = useState('0');
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
        const { data, error: rpcError } = await supabase.rpc('get_sellertray_tax_settings', {
          p_tenant_id: tenantId,
        });
        if (rpcError) throw rpcError;
        const next = parseTaxSettings(data);
        if (!active) return;
        setSettings(next);
        setRateDraft(formatRate(next.ratePercent));
      } catch (cause) {
        if (active) setError(errorMessage(cause, 'Unable to load tax settings.'));
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
      const ratePercent = Number(rateDraft);
      if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
        throw new Error('Tax rate must be between 0 and 100 percent.');
      }
      if (settings.isActive && ratePercent <= 0) {
        throw new Error('Active tax requires a rate greater than zero.');
      }

      const { data, error: rpcError } = await supabase.rpc('save_sellertray_tax_settings', {
        p_tenant_id: tenantId,
        p_is_active: settings.isActive,
        p_rate_percent: ratePercent,
        p_display_tax_breakdown: settings.displayTaxBreakdown,
      });
      if (rpcError) throw rpcError;
      const next = parseTaxSettings(data);
      setSettings(next);
      setRateDraft(formatRate(next.ratePercent));
      setMessage(`Tax settings saved as revision ${next.revision}. Existing posted sales are unchanged.`);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to save tax settings.'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <article className="panel"><p className="muted">Loading tax settings…</p></article>;

  return (
    <form className="panel settings-form" onSubmit={save}>
      <div className="panel-head">
        <div>
          <p className="eyebrow">Tax</p>
          <h3>Sales tax</h3>
          <p className="muted">SellerTray calculates active sales tax server-side when a transaction is posted. Changing this setting never rewrites completed sales.</p>
        </div>
        <span className={`status-pill ${settings.isActive ? 'good' : 'neutral'}`}>{settings.isActive ? 'Active' : 'Not applied'}</span>
      </div>

      {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
      {message ? <div className="success-banner">{message}<button type="button" onClick={() => setMessage(null)}>Dismiss</button></div> : null}

      <div className="settings-check-grid">
        <Toggle
          label="Apply sales tax to posted sales and orders"
          checked={settings.isActive}
          onChange={(value) => setSettings((current) => ({ ...current, isActive: value }))}
        />
        <Toggle
          label="Show tax breakdown on receipt and invoice"
          checked={settings.displayTaxBreakdown}
          onChange={(value) => setSettings((current) => ({ ...current, displayTaxBreakdown: value }))}
        />
      </div>

      <div className="settings-grid two">
        <label className="settings-field">
          <span>Tax rate (%)</span>
          <SellerTrayInput
            type="number"
            min={0}
            max={100}
            step="0.000001"
            inputMode="decimal"
            value={rateDraft}
            onChange={(event) => setRateDraft(event.target.value)}
          />
        </label>
        <div className="settings-field">
          <span>Configuration revision</span>
          <strong>{settings.revision || 'Not configured'}</strong>
        </div>
      </div>

      <p className="muted">The rate is Business-wide for the current SellerTray MVP tax model. Mobile POS, Merchant Web, WhatsApp and other channels use the same server posting authority.</p>
      <p className="muted">The receipt/invoice visibility switch controls presentation only. It never removes applicable tax from the amount due.</p>

      <div className="settings-actions">
        <button className="primary-button" disabled={saving}>{saving ? 'Saving' : 'Save tax settings'}</button>
      </div>
    </form>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="settings-toggle"><SellerTrayInput type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
}

function parseTaxSettings(value: unknown): TaxSettingsState {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const revision = numberValue(row.revision);
  const ratePercent = numberValue(row.ratePercent ?? row.rate_percent);
  return {
    configurationId: typeof row.configurationId === 'string' ? row.configurationId : null,
    revision: revision >= 0 ? revision : 0,
    isActive: row.isActive === true || row.is_active === true,
    ratePercent: ratePercent >= 0 ? ratePercent : 0,
    displayTaxBreakdown: row.displayTaxBreakdown !== false && row.display_tax_breakdown !== false,
  };
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatRate(value: number): string {
  return Number(value.toFixed(6)).toString();
}
