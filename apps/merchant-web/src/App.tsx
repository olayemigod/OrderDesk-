import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { errorMessage, numberValue, supabase } from './supabase';

type MerchantRole = 'owner' | 'manager' | 'staff';
type Page =
  | 'overview'
  | 'orders'
  | 'inventory'
  | 'cash'
  | 'whatsapp'
  | 'reports'
  | 'products'
  | 'team'
  | 'devices'
  | 'settings';

type Business = {
  id: string;
  name: string;
  merchantCode: string;
  role: MerchantRole;
  currency: string;
  subscriptionStatus: string;
  whatsappConnectionStatus: string;
};

type Branch = {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
};

type ReportSummary = {
  ordersTotal: number;
  completed: number;
  orderValue: number;
  averageOrderValue: number;
  paidValue: number;
  awaitingPayment: number;
  verificationRequired: number;
  awaitingFulfillment: number;
  whatsappOrders: number;
  topItems: Array<{ name: string; quantity: number; value: number }>;
};

type OrderRow = {
  id: string;
  branch_id: string;
  public_order_id: string;
  status: string;
  payment_status: string;
  fulfillment_status: string;
  source: string;
  amount_paid: number | string;
  created_at: string;
  customers:
    | { display_name: string | null; phone: string | null; wa_id: string }
    | Array<{ display_name: string | null; phone: string | null; wa_id: string }>
    | null;
};

type StockRow = {
  catalog_item_id: string;
  item_name: string;
  sku: string | null;
  category: string | null;
  stock_uom: string;
  quantity_on_hand: number | string;
  last_movement_at: string | null;
};

type ShiftRow = {
  shift_id: string;
  register_id: string;
  register_name: string;
  status: 'open' | 'closed' | 'reviewed';
  currency: string;
  opening_cash: number | string;
  expected_cash: number | string | null;
  declared_cash: number | string | null;
  variance: number | string | null;
  opened_by_user_id: string;
  opened_at: string;
  closed_at: string | null;
  review_decision: 'accepted' | 'follow_up' | null;
  reviewed_at: string | null;
};

type WorkspaceData = {
  report: ReportSummary | null;
  orders: OrderRow[];
  stock: StockRow[];
  shifts: ShiftRow[];
};

const MANAGEMENT_ROLES: MerchantRole[] = ['owner', 'manager'];
const NAV_ITEMS: Array<{ id: Page; label: string; section?: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'orders', label: 'Orders' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'cash', label: 'Cash & Shifts' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'reports', label: 'Reports' },
  { id: 'products', label: 'Products & Pricing', section: 'Management' },
  { id: 'team', label: 'Team & Branches' },
  { id: 'devices', label: 'Devices & Printers' },
  { id: 'settings', label: 'Settings' },
];

export default function App() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [activeBusinessId, setActiveBusinessId] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState('');
  const [page, setPage] = useState<Page>('overview');
  const [data, setData] = useState<WorkspaceData>({ report: null, orders: [], stock: [], shifts: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState(() => localStorage.getItem('sellertray.merchant.theme') === 'dark');

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data: authData }) => {
      if (!active) return;
      setSession(authData.session);
      setBooting(false);
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setBusinesses([]);
        setActiveBusinessId('');
        setBranches([]);
        setActiveBranchId('');
      }
    });
    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('sellertray.merchant.theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    if (!session) return;
    void loadBusinesses();
  }, [session?.access_token]);

  useEffect(() => {
    if (!activeBusinessId) return;
    void loadBusinessWorkspace(activeBusinessId);
  }, [activeBusinessId]);

  useEffect(() => {
    if (!activeBusinessId || !activeBranchId) return;
    void loadBranchData(activeBusinessId, activeBranchId);
  }, [activeBranchId]);

  const activeBusiness = useMemo(
    () => businesses.find((business) => business.id === activeBusinessId) ?? null,
    [activeBusinessId, businesses],
  );
  const activeBranch = useMemo(
    () => branches.find((branch) => branch.id === activeBranchId) ?? null,
    [activeBranchId, branches],
  );
  const managementBusinesses = useMemo(
    () => businesses.filter((business) => MANAGEMENT_ROLES.includes(business.role)),
    [businesses],
  );

  async function loadBusinesses() {
    setLoading(true);
    setError(null);
    try {
      const { data: rows, error: rpcError } = await supabase.rpc('sellertray_list_businesses_for_current_user');
      if (rpcError) throw rpcError;
      const next = ((rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id ?? ''),
        name: String(row.name ?? 'SellerTray business'),
        merchantCode: String(row.merchant_code ?? ''),
        role: normalizeRole(row.role),
        currency: String(row.currency ?? 'NGN'),
        subscriptionStatus: String(row.subscription_status ?? 'unknown'),
        whatsappConnectionStatus: String(row.whatsapp_connection_status ?? 'not_connected'),
      } satisfies Business));
      setBusinesses(next);
      const manageable = next.filter((business) => MANAGEMENT_ROLES.includes(business.role));
      setActiveBusinessId((current) => manageable.some((business) => business.id === current) ? current : manageable[0]?.id ?? '');
    } catch (err) {
      setError(errorMessage(err, 'Unable to load your SellerTray businesses.'));
    } finally {
      setLoading(false);
    }
  }

  async function loadBusinessWorkspace(tenantId: string) {
    setLoading(true);
    setError(null);
    try {
      const [branchResult, reportResult, ordersResult] = await Promise.all([
        supabase.rpc('get_sellertray_accessible_branches', { p_tenant_id: tenantId }),
        supabase.rpc('sellertray_report_summary', { p_tenant_id: tenantId, p_days: 30 }),
        supabase
          .from('orders')
          .select('id,branch_id,public_order_id,status,payment_status,fulfillment_status,source,amount_paid,created_at,customers(display_name,phone,wa_id)')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false })
          .limit(100),
      ]);
      if (branchResult.error) throw branchResult.error;
      if (reportResult.error) throw reportResult.error;
      if (ordersResult.error) throw ordersResult.error;

      const nextBranches = ((branchResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id ?? ''),
        code: String(row.code ?? ''),
        name: String(row.name ?? 'Branch'),
        isDefault: row.is_default === true,
      } satisfies Branch));
      setBranches(nextBranches);
      const nextBranchId = nextBranches.find((branch) => branch.isDefault)?.id ?? nextBranches[0]?.id ?? '';
      setActiveBranchId((current) => nextBranches.some((branch) => branch.id === current) ? current : nextBranchId);
      setData((current) => ({
        ...current,
        report: parseReport(reportResult.data),
        orders: (ordersResult.data ?? []) as unknown as OrderRow[],
        stock: [],
        shifts: [],
      }));
      if (nextBranchId) await loadBranchData(tenantId, nextBranchId);
    } catch (err) {
      setError(errorMessage(err, 'Unable to load SellerTray management data.'));
    } finally {
      setLoading(false);
    }
  }

  async function loadBranchData(tenantId: string, branchId: string) {
    if (!tenantId || !branchId) return;
    try {
      const [stockResult, shiftResult] = await Promise.all([
        supabase.rpc('get_sellertray_branch_stock', {
          p_tenant_id: tenantId,
          p_branch_id: branchId,
        }),
        supabase.rpc('get_sellertray_cash_shift_history', {
          p_tenant_id: tenantId,
          p_branch_id: branchId,
          p_limit: 50,
        }),
      ]);
      if (stockResult.error) throw stockResult.error;
      if (shiftResult.error) throw shiftResult.error;
      setData((current) => ({
        ...current,
        stock: (stockResult.data ?? []) as StockRow[],
        shifts: (shiftResult.data ?? []) as ShiftRow[],
      }));
    } catch (err) {
      setError(errorMessage(err, 'Unable to load this Branch.'));
    }
  }

  async function refresh() {
    if (!activeBusinessId) return;
    await loadBusinessWorkspace(activeBusinessId);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (booting) return <StatusPage title="Opening SellerTray" body="Checking your merchant session." />;
  if (!session) return <Login />;
  if (loading && businesses.length === 0) return <StatusPage title="Opening your business" body="Loading SellerTray management." />;
  if (businesses.length > 0 && managementBusinesses.length === 0) {
    return <StaffBoundary email={session.user.email ?? ''} onSignOut={signOut} />;
  }
  if (!activeBusiness) {
    return <StatusPage title="No management workspace" body="This account is not an Owner or Manager of a SellerTray business." error={error} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">S</div>
          <div>
            <strong>SellerTray</strong>
            <span>Merchant Management</span>
          </div>
        </div>
        <nav className="side-nav" aria-label="SellerTray management">
          {NAV_ITEMS.map((item, index) => (
            <div key={item.id}>
              {item.section ? <p className="nav-section">{item.section}</p> : null}
              <button className={page === item.id ? 'nav-button active' : 'nav-button'} onClick={() => setPage(item.id)}>
                <span>{navInitial(item.label)}</span>
                {item.label}
              </button>
              {index === 5 ? <div className="nav-divider" /> : null}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <p>{session.user.email}</p>
          <button className="text-button" onClick={() => void signOut()}>Sign out</button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{pageTitle(page)}</p>
            <h1>{activeBusiness.name}</h1>
          </div>
          <div className="topbar-actions">
            <label className="select-field">
              <span>Business</span>
              <select value={activeBusinessId} onChange={(event) => setActiveBusinessId(event.target.value)}>
                {managementBusinesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
              </select>
            </label>
            <label className="select-field">
              <span>Branch</span>
              <select value={activeBranchId} onChange={(event) => setActiveBranchId(event.target.value)} disabled={branches.length === 0}>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>
            <button className="icon-button" onClick={() => setDark((value) => !value)} aria-label="Change appearance">{dark ? 'Light' : 'Dark'}</button>
            <button className="secondary-button" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing' : 'Refresh'}</button>
          </div>
        </header>

        {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}

        <section className="context-bar">
          <div><span>Role</span><strong>{capitalize(activeBusiness.role)}</strong></div>
          <div><span>Merchant ID</span><strong>{activeBusiness.merchantCode || '—'}</strong></div>
          <div><span>Subscription</span><strong>{friendlyStatus(activeBusiness.subscriptionStatus)}</strong></div>
          <div><span>Branch context</span><strong>{activeBranch?.name ?? 'No active Branch'}</strong></div>
        </section>

        {page === 'overview' ? <Overview business={activeBusiness} branch={activeBranch} data={data} onNavigate={setPage} /> : null}
        {page === 'orders' ? <Orders business={activeBusiness} branch={activeBranch} orders={data.orders} /> : null}
        {page === 'inventory' ? <Inventory branch={activeBranch} stock={data.stock} /> : null}
        {page === 'cash' ? <Cash business={activeBusiness} branch={activeBranch} shifts={data.shifts} /> : null}
        {page === 'whatsapp' ? <WhatsApp business={activeBusiness} /> : null}
        {page === 'reports' ? <Reports business={activeBusiness} report={data.report} /> : null}
        {page === 'products' ? <ComingSoon title="Products & Pricing" body="Manage products, Stock UOM, alternate UOMs, barcodes and selling prices from the shared SellerTray catalogue." /> : null}
        {page === 'team' ? <ComingSoon title="Team & Branches" body="Manage Branches, staff assignments and capabilities. Branch authority remains enforced by SellerTray on the server." /> : null}
        {page === 'devices' ? <ComingSoon title="Devices & Printers" body="Review registers and printers, including receipt printer configuration and print-job history." /> : null}
        {page === 'settings' ? <ComingSoon title="Settings" body="Business profile, payments, WhatsApp configuration and merchant preferences will live here." /> : null}
      </main>
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) throw authError;
    } catch (err) {
      setError(errorMessage(err, 'Unable to sign in.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <section className="login-brand">
        <div className="brand-mark large">S</div>
        <p className="eyebrow">SellerTray</p>
        <h1>Run the business. Keep selling on mobile.</h1>
        <p>Manage orders, stock, Branch performance, cash controls, WhatsApp and reporting from one merchant workspace.</p>
      </section>
      <form className="login-card" onSubmit={submit}>
        <div>
          <p className="eyebrow">Merchant Management</p>
          <h2>Sign in</h2>
          <p className="muted">Use the same SellerTray account you use for your business.</p>
        </div>
        <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error ? <div className="error-banner compact">{error}</div> : null}
        <button className="primary-button" disabled={busy}>{busy ? 'Signing in' : 'Continue'}</button>
      </form>
    </div>
  );
}

function StaffBoundary({ email, onSignOut }: { email: string; onSignOut: () => Promise<void> }) {
  return (
    <StatusPage
      title="Use SellerTray mobile for daily operations"
      body="Merchant Web management is available to business Owners and Managers. Your Staff access remains available in the SellerTray mobile app for permitted Branch operations."
      detail={email}
      action={<button className="secondary-button" onClick={() => void onSignOut()}>Sign out</button>}
    />
  );
}

function Overview({ business, branch, data, onNavigate }: { business: Business; branch: Branch | null; data: WorkspaceData; onNavigate: (page: Page) => void }) {
  const report = data.report;
  const branchOrders = branch ? data.orders.filter((order) => order.branch_id === branch.id) : [];
  const lowStock = data.stock.filter((row) => numberValue(row.quantity_on_hand) <= 0).length;
  const openShifts = data.shifts.filter((shift) => shift.status === 'open').length;
  return (
    <div className="page-stack">
      <div className="section-heading">
        <div><p className="eyebrow">Last 30 days</p><h2>Business overview</h2></div>
        <p className="muted">Business-wide reporting. Operational cards below follow the selected Branch.</p>
      </div>
      <div className="metric-grid">
        <Metric label="Order value" value={money(report?.orderValue ?? 0, business.currency)} note={`${report?.ordersTotal ?? 0} orders`} />
        <Metric label="Paid value" value={money(report?.paidValue ?? 0, business.currency)} note={`${report?.awaitingPayment ?? 0} awaiting payment`} />
        <Metric label="Completed" value={String(report?.completed ?? 0)} note={`${report?.awaitingFulfillment ?? 0} awaiting fulfilment`} />
        <Metric label="Average order" value={money(report?.averageOrderValue ?? 0, business.currency)} note={`${report?.whatsappOrders ?? 0} from WhatsApp`} />
      </div>
      <div className="two-column">
        <article className="panel">
          <div className="panel-head"><div><p className="eyebrow">Selected Branch</p><h3>{branch?.name ?? 'No Branch'}</h3></div><button className="text-button" onClick={() => onNavigate('orders')}>View orders</button></div>
          <div className="status-grid">
            <StatusStat label="Recent orders" value={String(branchOrders.length)} />
            <StatusStat label="Products in stock view" value={String(data.stock.length)} />
            <StatusStat label="Out of stock" value={String(lowStock)} />
            <StatusStat label="Open shifts" value={String(openShifts)} />
          </div>
        </article>
        <article className="panel">
          <div className="panel-head"><div><p className="eyebrow">Attention</p><h3>What needs review</h3></div></div>
          <AttentionRow label="Payment verification" value={report?.verificationRequired ?? 0} action={() => onNavigate('orders')} />
          <AttentionRow label="Awaiting fulfilment" value={report?.awaitingFulfillment ?? 0} action={() => onNavigate('orders')} />
          <AttentionRow label="Out-of-stock products" value={lowStock} action={() => onNavigate('inventory')} />
        </article>
      </div>
      <article className="panel">
        <div className="panel-head"><div><p className="eyebrow">Top products</p><h3>Sales contribution</h3></div><button className="text-button" onClick={() => onNavigate('reports')}>Open reports</button></div>
        {(report?.topItems ?? []).length === 0 ? <EmptyState title="No product activity yet" body="Top-selling products will appear as completed sales accumulate." /> : (
          <div className="table-wrap"><table><thead><tr><th>Product</th><th>Quantity</th><th>Value</th></tr></thead><tbody>{report!.topItems.slice(0, 6).map((item) => <tr key={item.name}><td>{item.name}</td><td>{formatNumber(item.quantity)}</td><td>{money(item.value, business.currency)}</td></tr>)}</tbody></table></div>
        )}
      </article>
    </div>
  );
}

function Orders({ business, branch, orders }: { business: Business; branch: Branch | null; orders: OrderRow[] }) {
  const rows = branch ? orders.filter((order) => order.branch_id === branch.id) : orders;
  return (
    <LiveTable title="Orders" eyebrow={branch?.name ?? 'Accessible orders'} description="Orders from POS, WhatsApp and other SellerTray channels use the same commerce record.">
      {rows.length === 0 ? <EmptyState title="No orders in this Branch" body="New sales and WhatsApp orders will appear here." /> : (
        <div className="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Source</th><th>Status</th><th>Payment</th><th>Collected</th><th>Created</th></tr></thead><tbody>{rows.map((order) => {
          const customer = one(order.customers);
          return <tr key={order.id}><td><strong>{order.public_order_id}</strong></td><td>{customer?.display_name || customer?.phone || customer?.wa_id || 'Customer'}</td><td>{capitalize(order.source)}</td><td><StatusPill value={order.status} /></td><td><StatusPill value={order.payment_status} /></td><td>{money(numberValue(order.amount_paid), business.currency)}</td><td>{dateTime(order.created_at)}</td></tr>;
        })}</tbody></table></div>
      )}
    </LiveTable>
  );
}

function Inventory({ branch, stock }: { branch: Branch | null; stock: StockRow[] }) {
  return (
    <LiveTable title="Inventory" eyebrow={branch?.name ?? 'Branch stock'} description="Current quantity is ledger-derived and stored in each product's Stock UOM.">
      {stock.length === 0 ? <EmptyState title="No stock rows" body="Receive or count stock from SellerTray operations to establish inventory." /> : (
        <div className="table-wrap"><table><thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Quantity on hand</th><th>Stock UOM</th><th>Last movement</th></tr></thead><tbody>{stock.map((row) => <tr key={row.catalog_item_id}><td><strong>{row.item_name}</strong></td><td>{row.sku || '—'}</td><td>{row.category || '—'}</td><td className={numberValue(row.quantity_on_hand) <= 0 ? 'danger-text' : ''}>{formatNumber(numberValue(row.quantity_on_hand))}</td><td>{row.stock_uom}</td><td>{row.last_movement_at ? dateTime(row.last_movement_at) : 'No movement'}</td></tr>)}</tbody></table></div>
      )}
    </LiveTable>
  );
}

function Cash({ business, branch, shifts }: { business: Business; branch: Branch | null; shifts: ShiftRow[] }) {
  return (
    <LiveTable title="Cash & Shifts" eyebrow={branch?.name ?? 'Branch'} description="Review cashier opening cash, expected cash, declared cash and close variance.">
      {shifts.length === 0 ? <EmptyState title="No cashier shifts" body="Cashier shift history will appear after a register is operated in this Branch." /> : (
        <div className="table-wrap"><table><thead><tr><th>Register</th><th>Status</th><th>Opening</th><th>Expected</th><th>Declared</th><th>Variance</th><th>Opened</th></tr></thead><tbody>{shifts.map((shift) => <tr key={shift.shift_id}><td><strong>{shift.register_name}</strong></td><td><StatusPill value={shift.status} /></td><td>{money(numberValue(shift.opening_cash), shift.currency || business.currency)}</td><td>{shift.expected_cash === null ? '—' : money(numberValue(shift.expected_cash), shift.currency || business.currency)}</td><td>{shift.declared_cash === null ? '—' : money(numberValue(shift.declared_cash), shift.currency || business.currency)}</td><td className={shift.variance !== null && numberValue(shift.variance) !== 0 ? 'danger-text' : ''}>{shift.variance === null ? '—' : money(numberValue(shift.variance), shift.currency || business.currency)}</td><td>{dateTime(shift.opened_at)}</td></tr>)}</tbody></table></div>
      )}
    </LiveTable>
  );
}

function WhatsApp({ business }: { business: Business }) {
  const connected = business.whatsappConnectionStatus === 'connected';
  return (
    <div className="page-stack">
      <div className="section-heading"><div><p className="eyebrow">Customer channel</p><h2>WhatsApp</h2></div></div>
      <article className="panel hero-panel">
        <div><p className="eyebrow">Connection</p><h3>{connected ? 'WhatsApp is connected' : 'WhatsApp needs attention'}</h3><p className="muted">WhatsApp orders use the same customers, products, UOMs, Branches, payments, inventory and reporting as POS sales.</p></div>
        <StatusPill value={business.whatsappConnectionStatus} />
      </article>
      <div className="two-column">
        <ComingSoon title="Receiving Branch" body="Connected numbers are routed to the Branch configured for future conversations and orders." />
        <ComingSoon title="Conversation review" body="Merchant Web will provide management review and analysis; day-to-day conversation handling remains optimized for mobile." />
      </div>
    </div>
  );
}

function Reports({ business, report }: { business: Business; report: ReportSummary | null }) {
  return (
    <div className="page-stack">
      <div className="section-heading"><div><p className="eyebrow">Last 30 days</p><h2>Reports</h2></div><p className="muted">This first management view uses the shared SellerTray reporting read model.</p></div>
      <div className="metric-grid">
        <Metric label="Orders" value={String(report?.ordersTotal ?? 0)} note={`${report?.completed ?? 0} completed`} />
        <Metric label="Order value" value={money(report?.orderValue ?? 0, business.currency)} note="Business-wide" />
        <Metric label="Paid value" value={money(report?.paidValue ?? 0, business.currency)} note={`${report?.awaitingPayment ?? 0} awaiting`} />
        <Metric label="WhatsApp orders" value={String(report?.whatsappOrders ?? 0)} note="Shared commerce core" />
      </div>
      <ComingSoon title="Report Center" body="Branch comparison, sales, payments, inventory, cashier, customer and channel reports will be added here using server-side reporting read models rather than duplicated browser calculations." />
    </div>
  );
}

function LiveTable({ title, eyebrow, description, children }: { title: string; eyebrow: string; description: string; children: React.ReactNode }) {
  return <div className="page-stack"><div className="section-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><p className="muted">{description}</p></div><article className="panel">{children}</article></div>;
}

function ComingSoon({ title, body }: { title: string; body: string }) {
  return <article className="panel placeholder-panel"><div className="placeholder-mark">{navInitial(title)}</div><div><h3>{title}</h3><p className="muted">{body}</p></div></article>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function StatusStat({ label, value }: { label: string; value: string }) {
  return <div className="status-stat"><span>{label}</span><strong>{value}</strong></div>;
}

function AttentionRow({ label, value, action }: { label: string; value: number; action: () => void }) {
  return <button className="attention-row" onClick={action}><span>{label}</span><strong>{value}</strong></button>;
}

function StatusPill({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const tone = normalized.includes('paid') || normalized.includes('completed') || normalized.includes('connected') || normalized.includes('reviewed') || normalized.includes('active')
    ? 'good'
    : normalized.includes('failed') || normalized.includes('cancel') || normalized.includes('error') || normalized.includes('past_due')
      ? 'bad'
      : 'neutral';
  return <span className={`status-pill ${tone}`}>{friendlyStatus(value)}</span>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><strong>{title}</strong><p>{body}</p></div>;
}

function StatusPage({ title, body, detail, error, action }: { title: string; body: string; detail?: string; error?: string | null; action?: React.ReactNode }) {
  return <div className="status-page"><div className="status-card"><div className="brand-mark large">S</div><p className="eyebrow">SellerTray</p><h1>{title}</h1><p>{body}</p>{detail ? <p className="muted">{detail}</p> : null}{error ? <div className="error-banner compact">{error}</div> : null}{action}</div></div>;
}

function parseReport(value: unknown): ReportSummary {
  const root = record(value);
  const orders = record(root.orders);
  const payments = record(root.payments);
  const fulfillment = record(root.fulfillment);
  const topItems = Array.isArray(root.topItems) ? root.topItems.flatMap((item) => {
    const row = record(item);
    return typeof row.name === 'string' && row.name.trim()
      ? [{ name: row.name, quantity: numberValue(row.quantity), value: numberValue(row.value) }]
      : [];
  }) : [];
  return {
    ordersTotal: numberValue(orders.total),
    completed: numberValue(orders.completed),
    orderValue: numberValue(orders.orderValue),
    averageOrderValue: numberValue(orders.averageOrderValue),
    paidValue: numberValue(payments.paidValue),
    awaitingPayment: numberValue(payments.awaitingPayment),
    verificationRequired: numberValue(payments.verificationRequired),
    awaitingFulfillment: numberValue(fulfillment.awaitingFulfillment),
    whatsappOrders: numberValue(orders.whatsapp),
    topItems,
  };
}

function normalizeRole(value: unknown): MerchantRole {
  return value === 'owner' || value === 'manager' || value === 'staff' ? value : 'staff';
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency || 'NGN'} ${formatNumber(value)}`;
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 }).format(value);
}

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function friendlyStatus(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function navInitial(value: string): string {
  return value.split(/\s|&/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}

function pageTitle(page: Page): string {
  return NAV_ITEMS.find((item) => item.id === page)?.label ?? 'SellerTray';
}
