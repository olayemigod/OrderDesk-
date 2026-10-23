import { useEffect, useState } from 'react';
import { errorMessage, supabase } from './supabase';

type OnboardingState = {
  stage: string;
  onboardingComplete: boolean;
  nextAction: { label: string; surface: string };
  activeBranchCount: number;
  commercialOrderReference: string | null;
  paidInstallmentCount: number;
  installmentCount: number;
  setupReadyCount: number;
  setupRequiredCount: number;
};

export default function OnboardingStatusPanel({ tenantId }: { tenantId: string }) {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    void supabase.functions.invoke('onboarding-state', { body: { tenantId } })
      .then(({ data, error: functionError }) => {
        if (!active) return;
        if (functionError) throw functionError;
        setState(parseState(record(data).state));
      })
      .catch((cause) => { if (active) { setState(null); setError(errorMessage(cause, 'Unable to load SellerTray setup status.')); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tenantId]);

  if (loading && !state) return <article className="panel"><p className="muted">Loading SellerTray activation status…</p></article>;
  if (error) return <article className="panel"><div className="error-banner compact">{error}</div></article>;
  if (!state) return null;

  return <article className="panel">
    <div className="panel-head">
      <div><p className="eyebrow">SellerTray activation</p><h3>{state.onboardingComplete ? 'SellerTray is active' : stageLabel(state.stage)}</h3><p className="muted">{state.onboardingComplete ? 'Initial SellerTray onboarding is complete.' : state.nextAction.label}</p></div>
      <span className="role-pill">{state.onboardingComplete ? 'Active' : 'Setup in progress'}</span>
    </div>
    <div className="settings-grid two">
      <Fact label="Active Branches" value={String(state.activeBranchCount)} />
      <Fact label="Purchase" value={state.commercialOrderReference ?? 'Not created'} />
      <Fact label="Confirmed payments" value={state.installmentCount ? `${state.paidInstallmentCount} of ${state.installmentCount}` : 'Not available yet'} />
      <Fact label="Branch setup" value={state.setupRequiredCount ? `${state.setupReadyCount} of ${state.setupRequiredCount} ready` : 'Not prepared yet'} />
    </div>
    {!state.onboardingComplete ? <div className="governance-note">This status is derived from the same governed commercial, payment, Branch setup and entitlement facts used by SellerTray Mobile and ProcessEdge Admin. Operational selling unlocks only after authoritative activation.</div> : null}
    {state.stage === 'business_setup' ? <div className="warning-banner">Open <strong>Branches</strong> from the Business menu and add the Branch or Branches that will use SellerTray.</div> : null}
    {(state.stage === 'agreement' || state.stage === 'payment') ? <div className="warning-banner">Continue in <strong>Billing & agreements</strong> below. SellerTray will refresh after governed acceptance or confirmed payment.</div> : null}
    {state.stage === 'setup' ? <div className="warning-banner">Commercial prerequisites are progressing. SellerTray Branch setup must be completed before activation. Setup-slot scheduling is added in the next governed onboarding slice.</div> : null}
    {state.stage === 'activation' ? <div className="success-banner">Required setup facts are complete. SellerTray is waiting for automatic activation reconciliation; no manual activation switch is required.</div> : null}
  </article>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div><span className="muted">{label}</span><strong style={{ display: 'block', marginTop: 4 }}>{value}</strong></div>; }
function stageLabel(stage: string): string { if (stage==='business_setup') return 'Complete Business setup'; if (stage==='commercial_order') return 'Choose your SellerTray purchase'; if (stage==='agreement') return 'Review your agreement'; if (stage==='payment') return 'Complete payment'; if (stage==='setup') return 'Complete SellerTray setup'; if (stage==='activation') return 'Activation checks in progress'; return 'SellerTray setup'; }
function parseState(value: unknown): OnboardingState { const row=record(value); const next=record(row.nextAction); return { stage:stringValue(row.stage,'commercial_order'), onboardingComplete:row.onboardingComplete===true, nextAction:{label:stringValue(next.label,'Review SellerTray setup'),surface:stringValue(next.surface)}, activeBranchCount:integer(row.activeBranchCount), commercialOrderReference:nullableString(row.commercialOrderReference), paidInstallmentCount:integer(row.paidInstallmentCount), installmentCount:integer(row.installmentCount), setupReadyCount:integer(row.setupReadyCount), setupRequiredCount:integer(row.setupRequiredCount) }; }
function record(value: unknown): Record<string, unknown> { return value && typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}; }
function stringValue(value: unknown,fallback=''): string { return typeof value==='string'&&value?value:fallback; }
function nullableString(value: unknown): string | null { return typeof value==='string'&&value?value:null; }
function integer(value: unknown): number { const parsed=typeof value==='number'?value:Number(value??0); return Number.isFinite(parsed)?Math.max(0,Math.trunc(parsed)):0; }
