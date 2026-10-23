import { useEffect, useState } from 'react';
import { loadMerchantOnboardingState, type MerchantOnboardingState } from './onboarding';

export default function OnboardingStatusCard({ tenantId }: { tenantId: string }) {
  const [state, setState] = useState<MerchantOnboardingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void load(); }, [tenantId]);

  async function load() {
    setLoading(true); setError(null);
    try { setState(await loadMerchantOnboardingState(tenantId)); }
    catch (cause) { setState(null); setError(cause instanceof Error ? cause.message : 'Unable to load SellerTray setup status.'); }
    finally { setLoading(false); }
  }

  if (loading && !state) return <article className="panel"><p className="muted">Checking SellerTray setup & activation…</p></article>;
  if (error) return <article className="panel"><div className="error-banner">{error}<button type="button" onClick={() => void load()}>Retry</button></div></article>;
  if (!state || state.stage === 'active') return null;

  const steps = [
    ['Business profile', true],
    ['Branch details', state.activeBranchCount > 0],
    ['Commercial purchase', Boolean(state.commercialOrderId)],
    ['Agreement', state.agreementAccepted === true],
    ['Payment', state.firstPaymentConfirmed === true],
    ['Branch setup', state.setupReady === true],
    ['Activation', state.activationComplete],
  ] as const;

  return <article className="panel">
    <div className="panel-head">
      <div>
        <p className="eyebrow">Setup & activation</p>
        <h3>{title(state.stage)}</h3>
        <p className="muted">{state.merchantMessage}</p>
      </div>
      <span className="role-pill">{label(state.stage)}</span>
    </div>
    <div className="settings-grid two">
      {steps.map(([name, done]) => <div key={name}><span>{name}</span><strong>{done ? 'Complete' : currentStep(name, state) ? 'Action required' : 'Pending'}</strong></div>)}
    </div>
    <div className="governance-note">SellerTray derives this status from the same governed commercial order, agreement, payment, Branch setup and entitlement records used for activation. No separate onboarding status is maintained here.</div>
    <div className="settings-actions">
      <button type="button" className="secondary-button" disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh status'}</button>
    </div>
  </article>;
}

function currentStep(name: string, state: MerchantOnboardingState): boolean {
  return (state.stage === 'business_setup' && name === 'Branch details')
    || ((state.stage === 'commercial_purchase' || state.stage === 'commercial_review') && name === 'Commercial purchase')
    || (state.stage === 'agreement' && name === 'Agreement')
    || (state.stage === 'payment' && name === 'Payment')
    || (state.stage === 'setup' && name === 'Branch setup')
    || (state.stage === 'activation' && name === 'Activation');
}
function title(stage: MerchantOnboardingState['stage']): string {
  if (stage === 'business_setup') return 'Add the Branches to activate';
  if (stage === 'commercial_purchase') return 'Prepare your SellerTray purchase';
  if (stage === 'commercial_review') return 'Commercial setup needs review';
  if (stage === 'agreement') return 'Review the current agreement';
  if (stage === 'payment') return 'Complete the required payment';
  if (stage === 'setup') return 'Complete Branch setup';
  if (stage === 'activation') return 'Activation is being finalised';
  return 'SellerTray is active';
}
function label(value: string): string { return value.replaceAll('_',' ').replace(/\b\w/g,(letter)=>letter.toUpperCase()); }
