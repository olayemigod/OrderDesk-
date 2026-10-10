import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { errorMessage, numberValue, supabase } from './supabase';

type MerchantRole = 'owner' | 'manager' | 'staff';
type Page = 'overview' | 'orders' | 'inventory' | 'cash' | 'whatsapp' | 'reports' | 'products' | 'team' | 'devices' | 'settings';
type Business = { id: string; name: string; merchantCode: string; role: MerchantRole; currency: string; subscriptionStatus: string; whatsappConnectionStatus: string };
type Branch = { id: string; code: string; name: string; isDefault: boolean };
type OrderRow = { id: string; branch_id: string; public_order_id: string; status: string; payment_status: string; fulfillment_status: string; source: string; amount_paid: number | string; created_at: string; customers: CustomerRow | CustomerRow[] | null };
type CustomerRow = { display_name: string | null; phone: string | null; wa_id: string };
type StockRow = { catalog_item_id: string; item_name: string; sku: string | null; category: string | null; stock_uom: string; quantity_on_hand: number | string; last_movement_at: string | null };
type ShiftRow = { shift_id: string; register_name: string; status: string; currency: string; opening_cash: number | string; expected_cash: number | string | null; declared_cash: number | string | null; variance: number | string | null; opened_at: string };
type Report = { ordersTotal: number; completed: number; orderValue: number; averageOrderValue: number; paidValue: number; awaitingPayment: number; verificationRequired: number; awaitingFulfillment: number; whatsappOrders: number; topItems: Array<{ name: string; quantity: number; value: number }> };
type Workspace = { report: Report | null; orders: OrderRow[]; stock: StockRow[]; shifts: ShiftRow[] };

const MANAGEMENT_ROLES: MerchantRole[] = ['owner', 'manager'];
const NAV: Array<{ id: Page; label: string; section?: string }> = [
  { id: 'overview', label: 'Overview' }, { id: 'orders', label: 'Orders' }, { id: 'inventory', label: 'Inventory' },
  { id: 'cash', label: 'Cash & Shifts' }, { id: 'whatsapp', label: 'WhatsApp' }, { id: 'reports', label: 'Reports' },
  { id: 'products', label: 'Products & Pricing', section: 'Management' }, { id: 'team', label: 'Team & Branches' },
  { id: 'devices', label: 'Devices & Printers' }, { id: 'settings', label: 'Settings' },
];

export default function App() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [page, setPage] = useState<Page>('overview');
  const [workspace, setWorkspace] = useState<Workspace>({ report: null, orders: [], stock: [], shifts: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState(() => localStorage.getItem('sellertray.merchant.theme') === 'dark');

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => { if (mounted) { setSession(data.session); setBooting(false); } });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) { setBusinesses([]); setBusinessId(''); setBranches([]); setBranchId(''); }
    });
    return () => { mounted = false; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('sellertray.merchant.theme', dark ? 'dark' : 'light');
  }, [dark]);

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
      const next = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id ?? ''), name: String(row.name ?? 'SellerTray business'), merchantCode: String(row.merchant_code ?? ''),
        role: role(row.role), currency: String(row.currency ?? 'NGN'), subscriptionStatus: String(row.subscription_status ?? 'unknown'),
        whatsappConnectionStatus: String(row.whatsapp_connection_status ?? 'not_connected'),
      } satisfies Business));
      setBusinesses(next);
      const manageable = next.filter((row) => MANAGEMENT_ROLES.includes(row.role));
      setBusinessId((current) => manageable.some((row) => row.id === current) ? current : manageable[0]?.id ?? '');
    } catch (cause) { setError(errorMessage(cause, 'Unable to load your SellerTray businesses.')); }
    finally { setLoading(false); }
  }

  async function loadWorkspace(tenantId: string) {
    setLoading(true); setError(null);
    try {
      const [branchResult, reportResult, orderResult] = await Promise.all([
        supabase.rpc('get_sellertray_accessible_branches', { p_tenant_id: tenantId }),
        supabase.rpc('sellertray_report_summary', { p_tenant_id: tenantId, p_days: 30 }),
        supabase.from('orders').select('id,branch_id,public_order_id,status,payment_status,fulfillment_status,source,amount_paid,created_at,customers(display_name,phone,wa_id)').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(100),
      ]);
      if (branchResult.error) throw branchResult.error;
      if (reportResult.error) throw reportResult.error;
      if (orderResult.error) throw orderResult.error;
      const nextBranches = ((branchResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id ?? ''), code: String(row.code ?? ''), name: String(row.name ?? 'Branch'), isDefault: row.is_default === true }));
      const chosen = nextBranches.find((row) => row.id === branchId)?.id ?? nextBranches.find((row) => row.isDefault)?.id ?? nextBranches[0]?.id ?? '';
      setBranches(nextBranches); setBranchId(chosen);
      setWorkspace({ report: parseReport(reportResult.data), orders: (orderResult.data ?? []) as unknown as OrderRow[], stock: [], shifts: [] });
      if (chosen) await loadBranchData(tenantId, chosen);
    } catch (cause) { setError(errorMessage(cause, 'Unable to load SellerTray management data.')); }
    finally { setLoading(false); }
  }

  async function loadBranchData(tenantId: string, selectedBranchId: string) {
    try {
      const [stockResult, shiftResult] = await Promise.all([
        supabase.rpc('get_sellertray_branch_stock', { p_tenant_id: tenantId, p_branch_id: selectedBranchId }),
        supabase.rpc('get_sellertray_cash_shift_history', { p_tenant_id: tenantId, p_branch_id: selectedBranchId, p_limit: 50 }),
      ]);
      if (stockResult.error) throw stockResult.error;
      if (shiftResult.error) throw shiftResult.error;
      setWorkspace((current) => ({ ...current, stock: (stockResult.data ?? []) as StockRow[], shifts: (shiftResult.data ?? []) as ShiftRow[] }));
    } catch (cause) { setError(errorMessage(cause, 'Unable to load this Branch.')); }
  }

  async function refresh() { if (businessId) await loadWorkspace(businessId); }
  async function signOut() { await supabase.auth.signOut(); }

  if (booting) return <Status title="Opening SellerTray" body="Checking your merchant session." />;
  if (!session) return <Login />;
  if (loading && businesses.length === 0) return <Status title="Opening your business" body="Loading SellerTray management." />;
  if (businesses.length > 0 && managementBusinesses.length === 0) return <Status title="Use SellerTray mobile for daily operations" body="Merchant Web management is available to business Owners and Managers. Staff access remains available in the SellerTray mobile app for permitted Branch operations." action={<button className="secondary-button" onClick={() => void signOut()}>Sign out</button>} />;
  if (!business) return <Status title="No management workspace" body={error || 'No Owner or Manager business is available for this account.'} action={<button className="secondary-button" onClick={() => void signOut()}>Sign out</button>} />;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-block"><div className="brand-mark">S</div><div><strong>SellerTray</strong><span>Merchant Management</span></div></div>
      <nav className="side-nav" aria-label="SellerTray management">{NAV.map((item, index) => <div key={item.id}>{item.section ? <p className="nav-section">{item.section}</p> : null}<button className={page === item.id ? 'nav-button active' : 'nav-button'} onClick={() => setPage(item.id)}><span>{initials(item.label)}</span>{item.label}</button>{index === 5 ? <div className="nav-divider" /> : null}</div>)}</nav>
      <div className="sidebar-foot"><p>{session.user.email}</p><button className="text-button" onClick={() => void signOut()}>Sign out</button></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><div><p className="eyebrow">{NAV.find((item) => item.id === page)?.label}</p><h1>{business.name}</h1></div><div className="topbar-actions">
        <Select label="Business" value={businessId} onChange={setBusinessId}>{managementBusinesses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</Select>
        <Select label="Branch" value={branchId} onChange={setBranchId} disabled={!branches.length}>{branches.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</Select>
        <button className="icon-button" onClick={() => setDark((value) => !value)}>{dark ? 'Light' : 'Dark'}</button>
        <button className="secondary-button" disabled={loading} onClick={() => void refresh()}>{loading ? 'Refreshing' : 'Refresh'}</button>
      </div></header>
      {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
      <section className="context-bar"><Context label="Role" value={title(business.role)} /><Context label="Merchant ID" value={business.merchantCode || '—'} /><Context label="Subscription" value={statusText(business.subscriptionStatus)} /><Context label="Branch context" value={branch?.name ?? 'No active Branch'} /></section>
      {page === 'overview' && <Overview business={business} branch={branch} data={workspace} go={setPage} />}
      {page === 'orders' && <Orders business={business} branch={branch} rows={workspace.orders} />}
      {page === 'inventory' && <Inventory branch={branch} rows={workspace.stock} />}
      {page === 'cash' && <Cash business={business} branch={branch} rows={workspace.shifts} />}
      {page === 'whatsapp' && <WhatsApp business={business} />}
      {page === 'reports' && <Reports business={business} report={workspace.report} />}
      {page === 'products' && <Placeholder title="Products & Pricing" body="Manage products, Stock UOM, alternate UOMs, barcodes and selling prices from the shared SellerTray catalogue." />}
      {page === 'team' && <Placeholder title="Team & Branches" body="Manage Branches, staff assignments and capabilities. SellerTray continues to enforce Branch authority on the server." />}
      {page === 'devices' && <Placeholder title="Devices & Printers" body="Review registers, receipt printers and print-job history without changing completed sales." />}
      {page === 'settings' && <Placeholder title="Settings" body="Business profile, payments, WhatsApp configuration and merchant preferences will live here." />}
    </main>
  </div>;
}

function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setMessage(''); try { const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password }); if (error) throw error; } catch (cause) { setMessage(errorMessage(cause, 'Unable to sign in.')); } finally { setBusy(false); } }
  return <div className="login-shell"><section className="login-brand"><div className="brand-mark large">S</div><p className="eyebrow">SellerTray</p><h1>Run the business. Keep selling on mobile.</h1><p>Manage orders, stock, Branch performance, cash controls, WhatsApp and reporting from one merchant workspace.</p></section><form className="login-card" onSubmit={submit}><div><p className="eyebrow">Merchant Management</p><h2>Sign in</h2><p className="muted">Use the same SellerTray account you use for your business.</p></div><label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>{message ? <div className="error-banner compact">{message}</div> : null}<button className="primary-button" disabled={busy}>{busy ? 'Signing in' : 'Continue'}</button></form></div>;
}

function Overview({ business, branch, data, go }: { business: Business; branch: Branch | null; data: Workspace; go: (page: Page) => void }) {
  const report = data.report; const branchOrders = branch ? data.orders.filter((row) => row.branch_id === branch.id) : []; const out = data.stock.filter((row) => numberValue(row.quantity_on_hand) <= 0).length; const open = data.shifts.filter((row) => row.status === 'open').length;
  return <div className="page-stack"><Heading eyebrow="Last 30 days" title="Business overview" note="Business-wide reporting. Operational cards follow the selected Branch." /><div className="metric-grid"><Metric label="Order value" value={money(report?.orderValue ?? 0, business.currency)} note={`${report?.ordersTotal ?? 0} orders`} /><Metric label="Paid value" value={money(report?.paidValue ?? 0, business.currency)} note={`${report?.awaitingPayment ?? 0} awaiting payment`} /><Metric label="Completed" value={String(report?.completed ?? 0)} note={`${report?.awaitingFulfillment ?? 0} awaiting fulfilment`} /><Metric label="Average order" value={money(report?.averageOrderValue ?? 0, business.currency)} note={`${report?.whatsappOrders ?? 0} from WhatsApp`} /></div><div className="two-column"><article className="panel"><div className="panel-head"><div><p className="eyebrow">Selected Branch</p><h3>{branch?.name ?? 'No Branch'}</h3></div><button className="text-button" onClick={() => go('orders')}>View orders</button></div><div className="status-grid"><Stat label="Recent orders" value={branchOrders.length} /><Stat label="Products in stock view" value={data.stock.length} /><Stat label="Out of stock" value={out} /><Stat label="Open shifts" value={open} /></div></article><article className="panel"><div className="panel-head"><div><p className="eyebrow">Attention</p><h3>What needs review</h3></div></div><Attention label="Payment verification" value={report?.verificationRequired ?? 0} onClick={() => go('orders')} /><Attention label="Awaiting fulfilment" value={report?.awaitingFulfillment ?? 0} onClick={() => go('orders')} /><Attention label="Out-of-stock products" value={out} onClick={() => go('inventory')} /></article></div>{report?.topItems.length ? <article className="panel"><div className="panel-head"><div><p className="eyebrow">Top products</p><h3>Sales contribution</h3></div><button className="text-button" onClick={() => go('reports')}>Open reports</button></div><Table headers={['Product','Quantity','Value']}>{report.topItems.slice(0,6).map((item) => <tr key={item.name}><td>{item.name}</td><td>{formatNumber(item.quantity)}</td><td>{money(item.value,business.currency)}</td></tr>)}</Table></article> : null}</div>;
}

function Orders({ business, branch, rows }: { business: Business; branch: Branch | null; rows: OrderRow[] }) {
  const visible = branch ? rows.filter((row) => row.branch_id === branch.id) : rows;
  return <PageTable eyebrow={branch?.name ?? 'Accessible orders'} title="Orders" note="POS, WhatsApp and future sales channels use the same SellerTray order record.">{visible.length ? <Table headers={['Order','Customer','Source','Status','Payment','Collected','Created']}>{visible.map((row) => { const customer = one(row.customers); return <tr key={row.id}><td><strong>{row.public_order_id}</strong></td><td>{customer?.display_name || customer?.phone || customer?.wa_id || 'Customer'}</td><td>{title(row.source)}</td><td><Pill value={row.status} /></td><td><Pill value={row.payment_status} /></td><td>{money(numberValue(row.amount_paid),business.currency)}</td><td>{dateTime(row.created_at)}</td></tr>; })}</Table> : <Empty title="No orders in this Branch" body="New POS and WhatsApp orders will appear here." />}</PageTable>;
}

function Inventory({ branch, rows }: { branch: Branch | null; rows: StockRow[] }) {
  return <PageTable eyebrow={branch?.name ?? 'Branch stock'} title="Inventory" note="Current quantities are ledger-derived and stored in each product's Stock UOM.">{rows.length ? <Table headers={['Product','SKU','Category','On hand','Stock UOM','Last movement']}>{rows.map((row) => <tr key={row.catalog_item_id}><td><strong>{row.item_name}</strong></td><td>{row.sku || '—'}</td><td>{row.category || '—'}</td><td className={numberValue(row.quantity_on_hand) <= 0 ? 'danger-text' : ''}>{formatNumber(numberValue(row.quantity_on_hand))}</td><td>{row.stock_uom}</td><td>{row.last_movement_at ? dateTime(row.last_movement_at) : 'No movement'}</td></tr>)}</Table> : <Empty title="No stock rows" body="Receive or count stock from SellerTray operations to establish inventory." />}</PageTable>;
}

function Cash({ business, branch, rows }: { business: Business; branch: Branch | null; rows: ShiftRow[] }) {
  return <PageTable eyebrow={branch?.name ?? 'Branch'} title="Cash & Shifts" note="Review opening cash, expected cash, declared cash and close variance.">{rows.length ? <Table headers={['Register','Status','Opening','Expected','Declared','Variance','Opened']}>{rows.map((row) => <tr key={row.shift_id}><td><strong>{row.register_name}</strong></td><td><Pill value={row.status} /></td><td>{money(numberValue(row.opening_cash),row.currency || business.currency)}</td><td>{row.expected_cash == null ? '—' : money(numberValue(row.expected_cash),row.currency || business.currency)}</td><td>{row.declared_cash == null ? '—' : money(numberValue(row.declared_cash),row.currency || business.currency)}</td><td className={row.variance != null && numberValue(row.variance) !== 0 ? 'danger-text' : ''}>{row.variance == null ? '—' : money(numberValue(row.variance),row.currency || business.currency)}</td><td>{dateTime(row.opened_at)}</td></tr>)}</Table> : <Empty title="No cashier shifts" body="Shift history will appear after a register is operated in this Branch." />}</PageTable>;
}

function WhatsApp({ business }: { business: Business }) { const connected = business.whatsappConnectionStatus === 'connected'; return <div className="page-stack"><Heading eyebrow="Customer channel" title="WhatsApp" /><article className="panel hero-panel"><div><p className="eyebrow">Connection</p><h3>{connected ? 'WhatsApp is connected' : 'WhatsApp needs attention'}</h3><p className="muted">WhatsApp orders use the same customers, products, UOMs, Branches, payments, inventory and reporting as POS sales.</p></div><Pill value={business.whatsappConnectionStatus} /></article><div className="two-column"><Placeholder title="Receiving Branch" body="Connected numbers route future conversations and orders to their configured Branch." /><Placeholder title="Conversation review" body="Management review belongs here while day-to-day customer handling remains optimized for mobile." /></div></div>; }
function Reports({ business, report }: { business: Business; report: Report | null }) { return <div className="page-stack"><Heading eyebrow="Last 30 days" title="Reports" note="This view uses the shared SellerTray reporting read model." /><div className="metric-grid"><Metric label="Orders" value={String(report?.ordersTotal ?? 0)} note={`${report?.completed ?? 0} completed`} /><Metric label="Order value" value={money(report?.orderValue ?? 0,business.currency)} note="Business-wide" /><Metric label="Paid value" value={money(report?.paidValue ?? 0,business.currency)} note={`${report?.awaitingPayment ?? 0} awaiting`} /><Metric label="WhatsApp orders" value={String(report?.whatsappOrders ?? 0)} note="Shared commerce core" /></div><Placeholder title="Report Center" body="Branch comparison, sales, payments, inventory, cashier, customer and channel reports will use server-side reporting read models rather than duplicated browser calculations." /></div>; }

function Select({ label, value, onChange, disabled, children }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; children: ReactNode }) { return <label className="select-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>{children}</select></label>; }
function Context({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function Heading({ eyebrow, title: heading, note }: { eyebrow: string; title: string; note?: string }) { return <div className="section-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{heading}</h2></div>{note ? <p className="muted">{note}</p> : null}</div>; }
function PageTable({ eyebrow, title: heading, note, children }: { eyebrow: string; title: string; note: string; children: ReactNode }) { return <div className="page-stack"><Heading eyebrow={eyebrow} title={heading} note={note} /><article className="panel">{children}</article></div>; }
function Table({ headers, children }: { headers: string[]; children: ReactNode }) { return <div className="table-wrap"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }
function Stat({ label, value }: { label: string; value: number }) { return <div className="status-stat"><span>{label}</span><strong>{value}</strong></div>; }
function Attention({ label, value, onClick }: { label: string; value: number; onClick: () => void }) { return <button className="attention-row" onClick={onClick}><span>{label}</span><strong>{value}</strong></button>; }
function Placeholder({ title: heading, body }: { title: string; body: string }) { return <article className="panel placeholder-panel"><div className="placeholder-mark">{initials(heading)}</div><div><h3>{heading}</h3><p className="muted">{body}</p></div></article>; }
function Empty({ title: heading, body }: { title: string; body: string }) { return <div className="empty-state"><strong>{heading}</strong><p>{body}</p></div>; }
function Pill({ value }: { value: string }) { const text = value.toLowerCase(); const tone = /paid|completed|connected|reviewed|active/.test(text) ? 'good' : /failed|cancel|error|past_due/.test(text) ? 'bad' : 'neutral'; return <span className={`status-pill ${tone}`}>{statusText(value)}</span>; }
function Status({ title: heading, body, action }: { title: string; body: string; action?: ReactNode }) { return <div className="status-page"><div className="status-card"><div className="brand-mark large">S</div><p className="eyebrow">SellerTray</p><h1>{heading}</h1><p>{body}</p>{action}</div></div>; }

function parseReport(value: unknown): Report { const root = object(value); const orders = object(root.orders); const payments = object(root.payments); const fulfilment = object(root.fulfillment); const topItems = Array.isArray(root.topItems) ? root.topItems.flatMap((item) => { const row = object(item); return typeof row.name === 'string' && row.name.trim() ? [{ name: row.name, quantity: numberValue(row.quantity), value: numberValue(row.value) }] : []; }) : []; return { ordersTotal: numberValue(orders.total), completed: numberValue(orders.completed), orderValue: numberValue(orders.orderValue), averageOrderValue: numberValue(orders.averageOrderValue), paidValue: numberValue(payments.paidValue), awaitingPayment: numberValue(payments.awaitingPayment), verificationRequired: numberValue(payments.verificationRequired), awaitingFulfillment: numberValue(fulfilment.awaitingFulfillment), whatsappOrders: numberValue(orders.whatsapp), topItems }; }
function role(value: unknown): MerchantRole { return value === 'owner' || value === 'manager' || value === 'staff' ? value : 'staff'; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function one<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
function initials(value: string): string { return value.split(/\s|&/).filter(Boolean).slice(0,2).map((part) => part[0]?.toUpperCase()).join(''); }
function title(value: string): string { return value ? value[0].toUpperCase() + value.slice(1) : value; }
function statusText(value: string): string { return value.replaceAll('_',' ').replace(/\b\w/g,(letter) => letter.toUpperCase()); }
function formatNumber(value: number): string { return new Intl.NumberFormat('en-NG',{ maximumFractionDigits: 2 }).format(value); }
function money(value: number, currency: string): string { try { return new Intl.NumberFormat('en-NG',{ style:'currency', currency: currency || 'NGN', maximumFractionDigits:2 }).format(value); } catch { return `${currency || 'NGN'} ${formatNumber(value)}`; } }
function dateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG',{ dateStyle:'medium', timeStyle:'short' }).format(date); }
