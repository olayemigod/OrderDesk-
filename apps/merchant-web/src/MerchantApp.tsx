import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import AiInsights from './AiInsights';
import CustomersManagement from './CustomersManagement';
import DashboardOverview from './DashboardOverview';
import InventoryManagement from './InventoryManagement';
import ManagementPage from './ManagementPage';
import OrdersManagement from './OrdersManagement';
import PaymentsManagement from './PaymentsManagement';
import PurchasingManagement from './PurchasingManagement';
import ReportCenter from './ReportCenter';
import SalesManagement from './SalesManagement';
import WhatsAppManagement from './WhatsAppManagement';
import { AVAILABLE_MERCHANT_PORTAL_NAVIGATION, MERCHANT_PORTAL_SECTIONS, type MerchantPortalPage } from './portalNavigation';
import { errorMessage, numberValue, supabase } from './supabase';

type MerchantRole = 'owner' | 'manager' | 'staff';
type ManagementRole = 'owner' | 'manager';
type Page = MerchantPortalPage;
type Business = { id: string; name: string; merchantCode: string; role: MerchantRole; currency: string; subscriptionStatus: string; whatsappConnectionStatus: string };
type Branch = { id: string; code: string; name: string; isDefault: boolean };
type StockRow = { catalog_item_id: string; item_name: string; sku: string | null; category: string | null; stock_uom: string; quantity_on_hand: number | string; last_movement_at: string | null };
type ShiftRow = { shift_id: string; register_name: string; status: string; currency: string; opening_cash: number | string; expected_cash: number | string | null; declared_cash: number | string | null; variance: number | string | null; opened_at: string };
type Workspace = { stock: StockRow[]; shifts: ShiftRow[] };

const MANAGEMENT_ROLES: MerchantRole[] = ['owner', 'manager'];
const NAV = AVAILABLE_MERCHANT_PORTAL_NAVIGATION;

export default function MerchantApp() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [page, setPage] = useState<Page>('overview');
  const [workspace, setWorkspace] = useState<Workspace>({ stock: [], shifts: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState(() => localStorage.getItem('sellertray.merchant.theme') === 'dark');

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => { if (mounted) { setSession(data.session); setBooting(false); } });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); if (!next) { setBusinesses([]); setBusinessId(''); setBranches([]); setBranchId(''); } });
    return () => { mounted = false; data.subscription.unsubscribe(); };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('sellertray.merchant.theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => { if (session) void loadBusinesses(); }, [session?.access_token]);
  useEffect(() => { if (businessId) void loadWorkspace(businessId); }, [businessId]);
  useEffect(() => { if (businessId && branchId) void loadBranchData(businessId, branchId); }, [branchId]);

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
      setBusinessId((current) => manageable.some((row) => row.id === current) ? current : manageable[0]?.id ?? '');
    } catch (cause) { setError(errorMessage(cause, 'Unable to load your SellerTray businesses.')); } finally { setLoading(false); }
  }

  async function loadWorkspace(tenantId: string) {
    setLoading(true); setError(null);
    try {
      const branchResult = await supabase.rpc('get_sellertray_accessible_branches', { p_tenant_id: tenantId });
      if (branchResult.error) throw branchResult.error;
      const nextBranches = ((branchResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id ?? ''), code: String(row.code ?? ''), name: String(row.name ?? 'Branch'), isDefault: row.is_default === true } satisfies Branch));
      const chosen = nextBranches.find((row) => row.id === branchId)?.id ?? nextBranches.find((row) => row.isDefault)?.id ?? nextBranches[0]?.id ?? '';
      setBranches(nextBranches); setBranchId(chosen); setWorkspace({ stock: [], shifts: [] });
      if (chosen) await loadBranchData(tenantId, chosen);
    } catch (cause) { setError(errorMessage(cause, 'Unable to load SellerTray management data.')); } finally { setLoading(false); }
  }

  async function loadBranchData(tenantId: string, selectedBranchId: string) {
    try {
      const [stockResult, shiftResult] = await Promise.all([
        supabase.rpc('get_sellertray_branch_stock', { p_tenant_id: tenantId, p_branch_id: selectedBranchId }),
        supabase.rpc('get_sellertray_cash_shift_history', { p_tenant_id: tenantId, p_branch_id: selectedBranchId, p_limit: 50 }),
      ]);
      if (stockResult.error) throw stockResult.error; if (shiftResult.error) throw shiftResult.error;
      setWorkspace({ stock: (stockResult.data ?? []) as StockRow[], shifts: (shiftResult.data ?? []) as ShiftRow[] });
    } catch (cause) { setError(errorMessage(cause, 'Unable to load this Branch.')); }
  }

  async function refresh() { if (businessId) await loadWorkspace(businessId); }
  async function signOut() { await supabase.auth.signOut(); }

  if (booting) return <Status title="Opening SellerTray" body="Checking your merchant session." />;
  if (!session) return <Login />;
  if (loading && businesses.length === 0) return <Status title="Opening your business" body="Loading SellerTray management." />;
  if (businesses.length > 0 && managementBusinesses.length === 0) return <Status title="Use SellerTray mobile for daily operations" body="Merchant Web management is available to business Owners and Managers. Staff access remains available in the SellerTray mobile app for permitted Branch operations." action={<button className="secondary-button" onClick={() => void signOut()}>Sign out</button>} />;
  if (!business) return <Status title="No management workspace" body={error || 'No Owner or Manager business is available for this account.'} action={<button className="secondary-button" onClick={() => void signOut()}>Sign out</button>} />;

  const managementRole = business.role as ManagementRole;
  const currentNav = NAV.find((item) => item.id === page);
  const managementPage = page === 'products' || page === 'suppliers' || page === 'branches' || page === 'team' || page === 'devices' || page === 'feedback' || page === 'settings';

  return <div className="app-shell"><aside className="sidebar"><div className="brand-block"><div className="brand-mark">S</div><div><strong>SellerTray</strong><span>Merchant Management</span></div></div><nav className="side-nav" aria-label="SellerTray management">{MERCHANT_PORTAL_SECTIONS.map((section) => { const items = NAV.filter((item) => item.section === section); if (!items.length) return null; return <div key={section} className="nav-group"><p className="nav-section">{section}</p>{items.map((item) => <button key={item.id} className={page === item.id ? 'nav-button active' : 'nav-button'} onClick={() => setPage(item.id)}><span>{initials(item.label)}</span>{item.label}</button>)}</div>; })}</nav><div className="sidebar-foot"><p>{session.user.email}</p><button className="text-button" onClick={() => void signOut()}>Sign out</button></div></aside>
    <main className="workspace"><header className="topbar"><div><p className="eyebrow">{currentNav?.label ?? 'Merchant Management'}</p><h1>{business.name}</h1></div><div className="topbar-actions"><Select label="Business" value={businessId} onChange={setBusinessId}>{managementBusinesses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</Select><Select label="Branch" value={branchId} onChange={setBranchId} disabled={!branches.length}>{branches.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</Select><button className="icon-button" onClick={() => setDark((value) => !value)}>{dark ? 'Light' : 'Dark'}</button><button className="secondary-button" disabled={loading} onClick={() => void refresh()}>{loading ? 'Refreshing' : 'Refresh'}</button></div></header>
      {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
      <section className="context-bar"><Context label="Role" value={title(business.role)} /><Context label="Merchant ID" value={business.merchantCode || '—'} /><Context label="Subscription" value={statusText(business.subscriptionStatus)} /><Context label="Branch context" value={branch?.name ?? 'No active Branch'} /></section>
      {page === 'overview' && <DashboardOverview tenantId={business.id} currency={business.currency} go={setPage} />}
      {page === 'sales' && branch && <SalesManagement tenantId={business.id} branchId={branch.id} />}
      {page === 'sales' && !branch && <PageTable eyebrow="Sales" title="Choose a Branch" note="Select a Branch to review completed sales."><Empty title="No active Branch" body="Sales are reviewed within a Branch so transaction and stock context remain clear." /></PageTable>}
      {page === 'orders' && branch && <OrdersManagement tenantId={business.id} branchId={branch.id} currency={business.currency} />}
      {page === 'orders' && !branch && <PageTable eyebrow="Orders" title="Choose a Branch" note="Select a Branch to review open orders and POS drafts."><Empty title="No active Branch" body="Orders are reviewed within a Branch so fulfilment and transaction context remain clear." /></PageTable>}
      {page === 'customers' && <CustomersManagement tenantId={business.id} currency={business.currency} />}
      {page === 'inventory' && <InventoryManagement tenantId={business.id} branch={branch} branches={branches} stockRows={workspace.stock} />}
      {page === 'payments' && <PaymentsManagement tenantId={business.id} />}
      {page === 'cash' && <Cash business={business} branch={branch} rows={workspace.shifts} />}
      {page === 'whatsapp' && <WhatsAppManagement tenantId={business.id} role={managementRole} branches={branches} connectionStatusHint={business.whatsappConnectionStatus} />}
      {page === 'reports' && <ReportCenter tenantId={business.id} currency={business.currency} />}
      {page === 'ai' && <AiInsights tenantId={business.id} />}
      {page === 'purchasing' && <PurchasingManagement tenantId={business.id} currency={business.currency} />}
      {managementPage && <ManagementPage page={page} tenantId={business.id} currency={business.currency} onBranchesChanged={refresh} />}
    </main></div>;
}

function Login() { const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setMessage(''); try { const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password }); if (error) throw error; } catch (cause) { setMessage(errorMessage(cause, 'Unable to sign in.')); } finally { setBusy(false); } } return <div className="login-shell"><section className="login-brand"><div className="brand-mark large">S</div><p className="eyebrow">SellerTray</p><h1>Run the business. Keep selling on mobile.</h1><p>Manage orders, stock, Branch performance, cash controls, WhatsApp and reporting from one merchant workspace.</p></section><form className="login-card" onSubmit={submit}><div><p className="eyebrow">Merchant Management</p><h2>Sign in</h2><p className="muted">Use the same SellerTray account you use for your business.</p></div><label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>{message ? <div className="error-banner compact">{message}</div> : null}<button className="primary-button" disabled={busy}>{busy ? 'Signing in' : 'Continue'}</button></form></div>; }
function Cash({ business, branch, rows }: { business: Business; branch: Branch | null; rows: ShiftRow[] }) { return <PageTable eyebrow={branch?.name ?? 'Branch'} title="Cash & Shifts" note="Review opening cash, expected cash, declared cash and close variance.">{rows.length ? <Table headers={['Register', 'Status', 'Opening', 'Expected', 'Declared', 'Variance', 'Opened']}>{rows.map((row) => <tr key={row.shift_id}><td><strong>{row.register_name}</strong></td><td><Pill value={row.status} /></td><td>{money(numberValue(row.opening_cash), row.currency || business.currency)}</td><td>{row.expected_cash == null ? '—' : money(numberValue(row.expected_cash), row.currency || business.currency)}</td><td>{row.declared_cash == null ? '—' : money(numberValue(row.declared_cash), row.currency || business.currency)}</td><td className={row.variance != null && numberValue(row.variance) !== 0 ? 'danger-text' : ''}>{row.variance == null ? '—' : money(numberValue(row.variance), row.currency || business.currency)}</td><td>{dateTime(row.opened_at)}</td></tr>)}</Table> : <Empty title="No cashier shifts" body="Shift history will appear after a register is operated in this Branch." />}</PageTable>; }
function Select({ label, value, onChange, disabled, children }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; children: ReactNode }) { return <label className="select-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>{children}</select></label>; }
function Context({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function Heading({ eyebrow, title: heading, note }: { eyebrow: string; title: string; note?: string }) { return <div className="section-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{heading}</h2></div>{note ? <p className="muted">{note}</p> : null}</div>; }
function PageTable({ eyebrow, title: heading, note, children }: { eyebrow: string; title: string; note: string; children: ReactNode }) { return <div className="page-stack"><Heading eyebrow={eyebrow} title={heading} note={note} /><article className="panel">{children}</article></div>; }
function Table({ headers, children }: { headers: string[]; children: ReactNode }) { return <div className="table-wrap"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
function Empty({ title: heading, body }: { title: string; body: string }) { return <div className="empty-state"><strong>{heading}</strong><p>{body}</p></div>; }
function Pill({ value }: { value: string }) { const text = value.toLowerCase(); const tone = /paid|completed|connected|reviewed|active/.test(text) ? 'good' : /failed|cancel|error|past_due/.test(text) ? 'bad' : 'neutral'; return <span className={`status-pill ${tone}`}>{statusText(value)}</span>; }
function Status({ title: heading, body, action }: { title: string; body: string; action?: ReactNode }) { return <div className="status-page"><div className="status-card"><div className="brand-mark large">S</div><p className="eyebrow">SellerTray</p><h1>{heading}</h1><p>{body}</p>{action}</div></div>; }
function merchantRole(value: unknown): MerchantRole { return value === 'owner' || value === 'manager' || value === 'staff' ? value : 'staff'; }
function initials(value: string): string { return value.split(/\s|&/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(''); }
function title(value: string): string { return value ? value[0].toUpperCase() + value.slice(1) : value; }
function statusText(value: string): string { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatNumber(value: number): string { return new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 }).format(value); }
function money(value: number, currency: string): string { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(value); } catch { return `${currency || 'NGN'} ${formatNumber(value)}`; } }
function dateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
