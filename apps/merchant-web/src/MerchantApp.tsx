import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import AiInsights from './AiInsights';
import BusinessExpensesManagement from './BusinessExpensesManagement';
import CashShiftsManagement from './CashShiftsManagement';
import CommercialAgreementsManagement from './CommercialAgreementsManagement';
import CustomersManagement from './CustomersManagement';
import DashboardOverview from './DashboardOverview';
import InventoryManagement from './InventoryManagement';
import ManagementPage from './ManagementPage';
import OrdersManagement from './OrdersManagement';
import PaymentsManagement from './PaymentsManagement';
import PurchasingManagement from './PurchasingManagement';
import ReportCenter from './ReportCenter';
import ReturnsManagement from './ReturnsManagement';
import SalesManagement from './SalesManagement';
import SellerTrayBillingManagement from './SellerTrayBillingManagement';
import WhatsAppManagement from './WhatsAppManagement';
import { BUSINESS_PROFILE_UPDATED_EVENT, type BusinessProfileUpdatedDetail } from './businessProfileEvents';
import type { MerchantHandoffTarget } from './merchantHandoff';
import { SellerTrayBrand, SellerTrayMark, NavIcon, ShellIcon } from './merchantShell';
import { readMerchantPageFromLocation, rememberMerchantPage, resolveMerchantPage, syncMerchantPageUrl } from './merchantRouteState';
import { SellerTrayInput, SellerTraySelect } from './SellerTrayElements';
import { AVAILABLE_MERCHANT_PORTAL_NAVIGATION, MERCHANT_PORTAL_SECTIONS, type MerchantPortalPage, type MerchantPortalSection } from './portalNavigation';
import { errorMessage, supabase } from './supabase';

type MerchantRole = 'owner' | 'manager' | 'staff';
type ManagementRole = 'owner' | 'manager';
type Page = MerchantPortalPage;
type Business = { id: string; name: string; merchantCode: string; role: MerchantRole; currency: string; subscriptionStatus: string; whatsappConnectionStatus: string };
type BusinessIdentity = { name: string; logoUrl: string; currency: string };
type Branch = { id: string; code: string; name: string; isDefault: boolean };
type MerchantAppProps = { handoffTarget?: MerchantHandoffTarget | null };

const MANAGEMENT_ROLES: MerchantRole[] = ['owner', 'manager'];
const NAV = AVAILABLE_MERCHANT_PORTAL_NAVIGATION;
const COMMERCIAL_JOURNEY_PAGES: Page[] = ['agreements', 'sellertray_billing', 'setup_activation'];

export default function MerchantApp({ handoffTarget = null }: MerchantAppProps) {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState(handoffTarget?.businessId ?? '');
  const [businessIdentity, setBusinessIdentity] = useState<BusinessIdentity | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [page, setPage] = useState<Page>(() => handoffTarget?.page ?? readMerchantPageFromLocation() ?? 'overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState(() => localStorage.getItem('sellertray.merchant.theme') === 'dark');
  const [navOpen, setNavOpen] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<MerchantPortalSection>>(() => new Set());
  const workspaceRequestRef = useRef(0);
  const pendingHandoffRef = useRef<MerchantHandoffTarget | null>(handoffTarget);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => { if (mounted) { setSession(data.session); setBooting(false); } });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) { workspaceRequestRef.current += 1; setBusinesses([]); setBusinessId(''); setBusinessIdentity(null); setBranches([]); setBranchId(''); }
    });
    return () => { mounted = false; data.subscription.unsubscribe(); };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('sellertray.merchant.theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => { if (session) void loadBusinesses(); }, [session?.access_token]);
  useEffect(() => {
    if (!businessId) return;
    setBusinessIdentity(null);
    setBranches([]);
    setBranchId('');
    const pendingHandoff = pendingHandoffRef.current;
    const restoredPage = pendingHandoff?.businessId === businessId ? pendingHandoff.page : resolveMerchantPage(businessId);
    if (pendingHandoff?.businessId === businessId) pendingHandoffRef.current = null;
    setPage(restoredPage);
    syncMerchantPageUrl(businessId, restoredPage, 'replace');
    void loadWorkspace(businessId);
  }, [businessId]);
  useEffect(() => {
    const handlePopState = () => {
      if (!businessId) return;
      const restoredPage = resolveMerchantPage(businessId);
      setPage(restoredPage);
      rememberMerchantPage(businessId, restoredPage);
      if (!readMerchantPageFromLocation()) syncMerchantPageUrl(businessId, restoredPage, 'replace');
      setNavOpen(false);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [businessId]);
  useEffect(() => {
    const handleBusinessProfileUpdated = (event: Event) => {
      const detail = (event as CustomEvent<BusinessProfileUpdatedDetail>).detail;
      if (!detail || detail.tenantId !== businessId) return;
      applyBusinessIdentity(detail.tenantId, detail);
    };
    window.addEventListener(BUSINESS_PROFILE_UPDATED_EVENT, handleBusinessProfileUpdated);
    return () => window.removeEventListener(BUSINESS_PROFILE_UPDATED_EVENT, handleBusinessProfileUpdated);
  }, [businessId]);
  useEffect(() => {
    if (!navOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [navOpen]);

  const managementBusinesses = useMemo(() => businesses.filter((row) => MANAGEMENT_ROLES.includes(row.role)), [businesses]);
  const business = managementBusinesses.find((row) => row.id === businessId) ?? null;
  const branch = branches.find((row) => row.id === branchId) ?? null;

  async function loadBusinesses() {
    setLoading(true); setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('sellertray_list_businesses_for_current_user');
      if (rpcError) throw rpcError;
      const next = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id ?? ''), name: String(row.name ?? 'SellerTray business'), merchantCode: String(row.merchant_code ?? ''), role: merchantRole(row.role), currency: String(row.currency ?? 'NGN'), subscriptionStatus: String(row.subscription_status ?? 'unknown'), whatsappConnectionStatus: String(row.whatsapp_connection_status ?? 'not_connected') } satisfies Business));
      setBusinesses(next);
      const manageable = next.filter((row) => MANAGEMENT_ROLES.includes(row.role));
      const requestedBusinessId = pendingHandoffRef.current?.businessId ?? handoffTarget?.businessId ?? '';
      if (requestedBusinessId && !manageable.some((row) => row.id === requestedBusinessId)) {
        setBusinessId('');
        setError('This SellerTray continuation is no longer authorised for the selected Business. Return to SellerTray mobile and try again.');
        return;
      }
      setBusinessId((current) => manageable.some((row) => row.id === current) ? current : requestedBusinessId || manageable[0]?.id || '');
    } catch (cause) { setError(errorMessage(cause, 'Unable to load your SellerTray businesses.')); } finally { setLoading(false); }
  }

  async function loadWorkspace(tenantId: string) {
    const requestId = ++workspaceRequestRef.current;
    setLoading(true); setError(null);
    try {
      const [branchResult, profileResult] = await Promise.all([
        supabase.rpc('get_sellertray_accessible_branches', { p_tenant_id: tenantId }),
        supabase.rpc('get_sellertray_business_profile', { p_tenant_id: tenantId }),
      ]);
      if (requestId !== workspaceRequestRef.current) return;
      if (branchResult.error) throw branchResult.error;
      if (profileResult.error) throw profileResult.error;
      const nextBranches = ((branchResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id ?? ''), code: String(row.code ?? ''), name: String(row.name ?? 'Branch'), isDefault: row.is_default === true } satisfies Branch));
      const chosen = nextBranches.find((row) => row.id === branchId)?.id ?? nextBranches.find((row) => row.isDefault)?.id ?? nextBranches[0]?.id ?? '';
      const profileRow = Array.isArray(profileResult.data) ? profileResult.data[0] : profileResult.data;
      applyBusinessIdentity(tenantId, parseBusinessIdentity(profileRow));
      setBranches(nextBranches); setBranchId(chosen);
    } catch (cause) {
      if (requestId === workspaceRequestRef.current) setError(errorMessage(cause, 'Unable to load SellerTray management data.'));
    } finally {
      if (requestId === workspaceRequestRef.current) setLoading(false);
    }
  }

  function applyBusinessIdentity(tenantId: string, identity: BusinessIdentity) {
    setBusinessIdentity(identity);
    setBusinesses((current) => current.map((row) => row.id === tenantId ? { ...row, name: identity.name || row.name, currency: identity.currency || row.currency } : row));
  }
  async function refresh() { if (businessId) await loadWorkspace(businessId); }
  async function signOut() { await supabase.auth.signOut(); }
  function navigate(next: Page) { setPage(next); if (businessId) syncMerchantPageUrl(businessId, next, 'push'); setNavOpen(false); }
  function openBranchPage(next: Page, nextBranchId: string) { setBranchId(nextBranchId); navigate(next); }
  function toggleSection(section: MerchantPortalSection) {
    setCollapsedSections((current) => { const next = new Set(current); if (next.has(section)) next.delete(section); else next.add(section); return next; });
  }

  if (booting) return <Status title="Opening SellerTray" body="Checking your merchant session." />;
  if (!session) return <Login />;
  if (loading && businesses.length === 0) return <Status title="Opening your business" body="Loading SellerTray management." />;
  if (businesses.length > 0 && managementBusinesses.length === 0) return <Status title="Use SellerTray mobile for daily operations" body="Merchant Web management is available to business Owners and Managers. Staff access remains available in the SellerTray mobile app for permitted Branch operations." action={<button className="secondary-button" onClick={() => void signOut()}>Sign out</button>} />;
  if (!business) return <Status title="No management workspace" body={error || 'No Owner or Manager business is available for this account.'} action={<button className="secondary-button" onClick={() => void signOut()}>Sign out</button>} />;

  const managementRole = business.role as ManagementRole;
  const currentNav = NAV.find((item) => item.id === page);
  const managementPage = page === 'products' || page === 'categories' || page === 'units' || page === 'suppliers' || page === 'branches' || page === 'team' || page === 'devices' || page === 'feedback' || page === 'setup_activation' || page === 'settings';
  const displayBusinessName = businessIdentity?.name || business.name;

  return <div className={navOpen ? 'app-shell nav-open' : 'app-shell'}>
    <button className="nav-backdrop" aria-label="Close navigation" onClick={() => setNavOpen(false)} />
    <aside className="sidebar" id="merchant-navigation">
      <div className="sidebar-brand-row"><SellerTrayBrand /><button className="sidebar-close" type="button" aria-label="Close navigation" onClick={() => setNavOpen(false)}><ShellIcon name="close" /></button></div>
      <nav className="side-nav" aria-label="SellerTray management">
        {MERCHANT_PORTAL_SECTIONS.map((section) => {
          const items = NAV.filter((item) => item.section === section);
          if (!items.length) return null;
          if (section === 'Dashboard') {
            const item = items[0];
            return <div key={section} className="nav-dashboard-link"><button aria-current={page === item.id ? 'page' : undefined} className={page === item.id ? 'nav-button active' : 'nav-button'} onClick={() => navigate(item.id)}><span className="nav-button-icon"><NavIcon name={item.id} /></span><span className="nav-button-label">{item.label}</span></button></div>;
          }
          const collapsed = collapsedSections.has(section);
          return <div key={section} className="nav-group"><button className="nav-section-button" aria-expanded={!collapsed} onClick={() => toggleSection(section)}><span>{section}</span><span className={collapsed ? 'nav-chevron collapsed' : 'nav-chevron'}><ShellIcon name="chevron" /></span></button><div className={collapsed ? 'nav-group-items collapsed' : 'nav-group-items'}>{items.map((item) => <button key={item.id} aria-current={page === item.id ? 'page' : undefined} className={page === item.id ? 'nav-button active' : 'nav-button'} onClick={() => navigate(item.id)}><span className="nav-button-icon"><NavIcon name={item.id} /></span><span className="nav-button-label">{item.label}</span></button>)}</div></div>;
        })}
      </nav>
      <div className="sidebar-foot"><div className="account-summary"><BusinessAvatar logoUrl={businessIdentity?.logoUrl ?? ''} fallback={accountInitial(session.user.email)} businessName={displayBusinessName} /><div><strong>{displayBusinessName}</strong><span>{title(business.role)} · {session.user.email ?? 'SellerTray account'}</span></div></div><button className="text-button" onClick={() => void signOut()}>Sign out</button></div>
    </aside>

    <main className="workspace">
      <header className="topbar">
        <div className="topbar-heading"><button className="mobile-menu-button" type="button" aria-label="Open navigation" aria-controls="merchant-navigation" aria-expanded={navOpen} onClick={() => setNavOpen(true)}><ShellIcon name="menu" /></button><div><p className="eyebrow">{displayBusinessName}</p><h1>{currentNav?.label ?? 'Dashboard'}</h1><p className="topbar-context"><span className="context-dot" />{branch?.name ?? 'No active Branch'} <span aria-hidden="true">·</span> {title(business.role)}</p></div></div>
        <div className="topbar-actions"><Select label="Business" value={businessId} onChange={setBusinessId}>{managementBusinesses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</Select><Select label="Branch" value={branchId} onChange={setBranchId} disabled={!branches.length}>{branches.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</Select><button className="icon-button compact-icon-button" aria-label={dark ? 'Use light theme' : 'Use dark theme'} title={dark ? 'Use light theme' : 'Use dark theme'} onClick={() => setDark((value) => !value)}><ShellIcon name={dark ? 'sun' : 'moon'} /></button><button className="secondary-button refresh-button" disabled={loading} onClick={() => void refresh()}><ShellIcon name="refresh" />{loading ? 'Refreshing' : 'Refresh'}</button></div>
      </header>

      {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
      <section className="context-bar" aria-label="Current business context"><Context label="Business code" value={business.merchantCode || '—'} /><Context label="Subscription" value={statusText(business.subscriptionStatus)} /><Context label="Active Branch" value={branch?.name ?? 'No active Branch'} /></section>
      {COMMERCIAL_JOURNEY_PAGES.includes(page) ? <CommercialJourneyNavigation activePage={page} onNavigate={navigate} /> : null}
      {page === 'overview' && <DashboardOverview tenantId={business.id} currency={business.currency} go={navigate} openBranch={openBranchPage} />}
      {page === 'sales' && branch && <SalesManagement tenantId={business.id} branchId={branch.id} />}
      {page === 'sales' && !branch && <PageTable eyebrow="Sales" title="Choose a Branch" note="Select a Branch to review completed sales."><Empty title="No active Branch" body="Sales are reviewed within a Branch so transaction and stock context remain clear." /></PageTable>}
      {page === 'orders' && branch && <OrdersManagement tenantId={business.id} branchId={branch.id} currency={business.currency} />}
      {page === 'orders' && !branch && <PageTable eyebrow="Orders" title="Choose a Branch" note="Select a Branch to review open orders and POS drafts."><Empty title="No active Branch" body="Orders are reviewed within a Branch so fulfilment and transaction context remain clear." /></PageTable>}
      {page === 'customers' && <CustomersManagement tenantId={business.id} currency={business.currency} />}
      {page === 'returns' && branch && <ReturnsManagement tenantId={business.id} branchId={branch.id} />}
      {page === 'returns' && !branch && <PageTable eyebrow="Returns" title="Choose a Branch" note="Select a Branch to review completed returns."><Empty title="No active Branch" body="Returns are reviewed within a Branch so refund, UOM and restored-stock context remain clear." /></PageTable>}
      {page === 'inventory' && <InventoryManagement tenantId={business.id} branch={branch} branches={branches} />}
      {page === 'payments' && <PaymentsManagement tenantId={business.id} />}
      {page === 'sellertray_billing' && <SellerTrayBillingManagement tenantId={business.id} />}
      {page === 'cash' && <CashShiftsManagement tenantId={business.id} currency={business.currency} branches={branches} initialBranchId={branchId} />}
      {page === 'expenses' && <BusinessExpensesManagement tenantId={business.id} currency={business.currency} branches={branches} initialBranchId={branchId} />}
      {page === 'whatsapp' && <WhatsAppManagement tenantId={business.id} role={managementRole} branches={branches} connectionStatusHint={business.whatsappConnectionStatus} />}
      {page === 'reports' && <ReportCenter tenantId={business.id} currency={business.currency} branches={branches} go={navigate} openBranch={openBranchPage} />}
      {page === 'ai' && <AiInsights tenantId={business.id} />}
      {page === 'purchasing' && <PurchasingManagement tenantId={business.id} currency={business.currency} />}
      {page === 'agreements' && <CommercialAgreementsManagement tenantId={business.id} />}
      {managementPage && <ManagementPage page={page} tenantId={business.id} currency={business.currency} onBranchesChanged={refresh} onNavigate={navigate} />}
    </main>
  </div>;
}

function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setMessage(''); try { const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password }); if (error) throw error; } catch (cause) { setMessage(errorMessage(cause, 'Unable to sign in.')); } finally { setBusy(false); } }
  return <div className="login-shell"><section className="login-brand"><SellerTrayMark large /><p className="eyebrow">SellerTray</p><h1>Manage the business. Keep selling on mobile.</h1><p>Review sales, products, stock, purchasing, money, channels and Branch performance from one governed merchant workspace.</p></section><form className="login-card" onSubmit={submit}><div><p className="eyebrow">Merchant Web</p><h2>Sign in</h2><p className="muted">Use the same SellerTray account you use for your business.</p></div><label>Email<SellerTrayInput type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<SellerTrayInput type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>{message ? <div className="error-banner compact">{message}</div> : null}<button className="primary-button" disabled={busy}>{busy ? 'Signing in' : 'Continue'}</button></form></div>;
}
function BusinessAvatar({ logoUrl, fallback, businessName }: { logoUrl: string; fallback: string; businessName: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [logoUrl]);
  if (!logoUrl || failed) return <span className="account-avatar">{fallback}</span>;
  return <span className="account-avatar"><img src={logoUrl} alt={`${businessName} logo`} onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 'inherit' }} /></span>;
}
function CommercialJourneyNavigation({ activePage, onNavigate }: { activePage: Page; onNavigate: (page: Page) => void }) {
  const steps: Array<{ page: Page; label: string }> = [
    { page: 'agreements', label: '1. Agreements' },
    { page: 'sellertray_billing', label: '2. Billing' },
    { page: 'setup_activation', label: '3. Setup & Activation' },
  ];
  return <section className="commercial-journey" aria-label="SellerTray activation journey">
    <div className="commercial-journey-copy"><p className="eyebrow">SellerTray setup</p><strong>Complete the requirements for activation</strong><span>Agreement acceptance, payment and Branch setup remain separate governed steps. Complete each required step before SellerTray can activate.</span></div>
    <div className="commercial-journey-actions">{steps.map((step) => <button key={step.page} type="button" className={activePage === step.page ? 'secondary-button active' : 'secondary-button'} aria-current={activePage === step.page ? 'step' : undefined} onClick={() => onNavigate(step.page)}>{step.label}</button>)}</div>
  </section>;
}
function Select({ label, value, onChange, disabled, children }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; children: ReactNode }) { return <label className="select-field"><span>{label}</span><SellerTraySelect value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>{children}</SellerTraySelect></label>; }
function Context({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function Heading({ eyebrow, title: heading, note }: { eyebrow: string; title: string; note?: string }) { return <div className="section-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{heading}</h2></div>{note ? <p className="muted">{note}</p> : null}</div>; }
function PageTable({ eyebrow, title: heading, note, children }: { eyebrow: string; title: string; note: string; children: ReactNode }) { return <div className="page-stack"><Heading eyebrow={eyebrow} title={heading} note={note} /><article className="panel">{children}</article></div>; }
function Empty({ title: heading, body }: { title: string; body: string }) { return <div className="empty-state"><strong>{heading}</strong><p>{body}</p></div>; }
function Status({ title: heading, body, action }: { title: string; body: string; action?: ReactNode }) { return <div className="status-page"><div className="status-card"><SellerTrayMark large /><p className="eyebrow">SellerTray</p><h1>{heading}</h1><p>{body}</p>{action}</div></div>; }
function merchantRole(value: unknown): MerchantRole { return value === 'owner' || value === 'manager' || value === 'staff' ? value : 'staff'; }
function accountInitial(value: string | undefined): string { return value?.trim().charAt(0).toUpperCase() || 'S'; }
function parseBusinessIdentity(value: unknown): BusinessIdentity {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return { name: String(row.name ?? ''), logoUrl: optionalText(row.logoUrl ?? row.logo_url), currency: String(row.currency ?? 'NGN') };
}
function optionalText(value: unknown): string { return typeof value === 'string' ? value : ''; }
function title(value: string): string { return value ? value[0].toUpperCase() + value.slice(1) : value; }
function statusText(value: string): string { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
