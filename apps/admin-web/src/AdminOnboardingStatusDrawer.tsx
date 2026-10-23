import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { loadMerchantPortfolio, type MerchantRow } from './merchant-read-model';
import { invokeJson, isRecord, supabase } from './supabase';
import './admin-onboarding-status.css';

type OnboardingState = {
  stage: string;
  onboardingComplete: boolean;
  nextAction: { label: string };
  activeBranchCount: number;
  commercialOrderReference: string | null;
  agreementAccepted: boolean;
  paidInstallmentCount: number;
  installmentCount: number;
  setupReadyCount: number;
  setupRequiredCount: number;
  activationAt: string | null;
};

export default function AdminOnboardingStatusDrawer() {
  const [session, setSession] = useState<Session | null>(null);
  const [aal2, setAal2] = useState(false);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [merchants, setMerchants] = useState<MerchantRow[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [state, setState] = useState<OnboardingState | null>(null);
  const [loadingMerchants, setLoadingMerchants] = useState(false);
  const [loadingState, setLoadingState] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session) {
        const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (active) setAal2(assurance.currentLevel === 'aal2');
      }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next);
      if (!next) {
        setAal2(false); setOpen(false); setMerchants([]); setTenantId(''); setState(null);
      } else {
        void supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data: assurance }) => { if (active) setAal2(assurance.currentLevel === 'aal2'); });
      }
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!open || !session || !aal2) return;
    let active = true;
    setLoadingMerchants(true); setError(null);
    void loadMerchantPortfolio(session, { search: query, cursor: null, limit: 20 })
      .then((page) => {
        if (!active) return;
        setMerchants(page.items);
        setTenantId((current) => page.items.some((row) => row.id===current) ? current : page.items[0]?.id ?? '');
      })
      .catch((cause) => { if (active) setError(messageFrom(cause,'Unable to load SellerTray Businesses.')); })
      .finally(() => { if (active) setLoadingMerchants(false); });
    return () => { active = false; };
  }, [open, session, aal2, query]);

  useEffect(() => {
    if (!tenantId || !session || !open || !aal2) { setState(null); return; }
    let active = true;
    setLoadingState(true); setError(null);
    void invokeJson<{ state?: unknown }>('onboarding-state', { tenantId }, session)
      .then((response) => { if (active) setState(parseState(response.state)); })
      .catch((cause) => { if (active) { setState(null); setError(messageFrom(cause,'Unable to load onboarding status.')); } })
      .finally(() => { if (active) setLoadingState(false); });
    return () => { active = false; };
  }, [tenantId, session, open, aal2]);

  if (!session || !aal2) return null;

  return <div className="oa-admin-drawer">
    <button className="oa-admin-toggle" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>{open ? 'Close activation status' : 'Merchant activation status'}</button>
    {open ? <aside className="oa-admin-panel" aria-label="Merchant activation status">
      <div className="oa-admin-heading"><div><span>ONBOARDING & ACTIVATION</span><strong>Merchant status</strong></div><button type="button" onClick={() => setOpen(false)} aria-label="Close">×</button></div>
      <p className="oa-admin-copy">Read-only state from the same governed commercial, payment, Branch setup and entitlement facts used by Merchant Web and Mobile.</p>
      <label className="oa-admin-field">Search Business<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Business, email or phone" /></label>
      <label className="oa-admin-field">Business<select value={tenantId} onChange={(event) => setTenantId(event.target.value)} disabled={loadingMerchants}><option value="">Select Business</option>{merchants.map((merchant) => <option key={merchant.id} value={merchant.id}>{merchant.name}</option>)}</select></label>
      {loadingMerchants ? <p className="oa-admin-copy">Loading matching Businesses…</p> : null}
      {loadingState ? <p className="oa-admin-copy">Refreshing governed status…</p> : null}
      {error ? <div className="oa-admin-error">{error}</div> : null}
      {state ? <div className="oa-admin-state">
        <div className="oa-admin-state-head"><strong>{state.onboardingComplete ? 'Active' : stageLabel(state.stage)}</strong><span>{state.onboardingComplete ? 'Ready' : 'In progress'}</span></div>
        <p className="oa-admin-copy">{state.nextAction.label}</p>
        <div className="oa-admin-grid"><Fact label="Branches" value={String(state.activeBranchCount)} /><Fact label="Purchase" value={state.commercialOrderReference ?? 'Not created'} /><Fact label="Agreement" value={state.agreementAccepted ? 'Accepted' : 'Pending'} /><Fact label="Payments" value={state.installmentCount ? `${state.paidInstallmentCount}/${state.installmentCount}` : 'Not prepared'} /><Fact label="Setup" value={state.setupRequiredCount ? `${state.setupReadyCount}/${state.setupRequiredCount} ready` : 'Not prepared'} /><Fact label="Activation" value={state.activationAt ? formatDate(state.activationAt) : 'Pending'} /></div>
        <div className="oa-admin-note">Review-only. This surface cannot activate a merchant; activation remains automatic after governed prerequisites reconcile.</div>
      </div> : null}
    </aside> : null}
  </div>;
}

function Fact({ label,value }: { label:string; value:string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function stageLabel(value:string) { return value.replace(/_/g,' ').replace(/\b\w/g,(letter)=>letter.toUpperCase()); }
function formatDate(value:string) { const date=new Date(value); return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat('en-NG',{dateStyle:'medium',timeStyle:'short'}).format(date); }
function parseState(value:unknown):OnboardingState { const row=record(value); const next=record(row.nextAction); return { stage:stringValue(row.stage,'commercial_order'), onboardingComplete:row.onboardingComplete===true, nextAction:{label:stringValue(next.label,'Review SellerTray setup')}, activeBranchCount:integer(row.activeBranchCount), commercialOrderReference:nullableString(row.commercialOrderReference), agreementAccepted:row.agreementAccepted===true, paidInstallmentCount:integer(row.paidInstallmentCount), installmentCount:integer(row.installmentCount), setupReadyCount:integer(row.setupReadyCount), setupRequiredCount:integer(row.setupRequiredCount), activationAt:nullableString(row.activationAt) }; }
function record(value:unknown):Record<string,unknown> { return isRecord(value)?value:{}; }
function stringValue(value:unknown,fallback=''):string { return typeof value==='string'&&value?value:fallback; }
function nullableString(value:unknown):string|null { return typeof value==='string'&&value?value:null; }
function integer(value:unknown):number { const parsed=typeof value==='number'?value:Number(value??0); return Number.isFinite(parsed)?Math.max(0,Math.trunc(parsed)):0; }
function messageFrom(cause:unknown,fallback:string) { return cause instanceof Error&&cause.message?cause.message:fallback; }
