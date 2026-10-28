import { useEffect, useState } from 'react';
import BranchesManagement from './BranchesManagement';
import CatalogueMasterManagement from './CatalogueMasterManagement';
import DevicesPrintersManagement from './DevicesPrintersManagement';
import FeedbackDashboard from './FeedbackDashboard';
import PaymentBranchManagement from './PaymentBranchManagement';
import ProductsManagement from './ProductsManagement';
import { SellerTraySelect } from './SellerTrayElements';
import SettingsManagement from './SettingsManagement';
import SetupSchedulingManagement from './SetupSchedulingManagement';
import SuppliersManagement from './SuppliersManagement';
import TeamPermissionsManagement from './TeamPermissionsManagement';
import { errorMessage, supabase } from './supabase';

type ManagementPageId = 'products' | 'categories' | 'units' | 'suppliers' | 'branches' | 'team' | 'devices' | 'feedback' | 'setup_activation' | 'settings';
type Branch = { id: string; name: string; isDefault: boolean };

export default function ManagementPage({
  page,
  tenantId,
  currency,
  onBranchesChanged,
}: {
  page: ManagementPageId;
  tenantId: string;
  currency: string;
  onBranchesChanged?: () => void | Promise<void>;
}) {
  if (page === 'products') return <ProductsManagement tenantId={tenantId} currency={currency} />;
  if (page === 'categories') return <CatalogueMasterManagement tenantId={tenantId} kind="category" />;
  if (page === 'units') return <CatalogueMasterManagement tenantId={tenantId} kind="unit" />;
  if (page === 'suppliers') return <SuppliersManagement tenantId={tenantId} currency={currency} />;
  if (page === 'branches') return <BranchesManagement tenantId={tenantId} onBranchesChanged={onBranchesChanged} />;
  if (page === 'team') return <TeamPermissionsManagement tenantId={tenantId} />;
  if (page === 'devices') return <DeviceManagement tenantId={tenantId} />;
  if (page === 'feedback') return <FeedbackDashboard tenantId={tenantId} />;
  if (page === 'setup_activation') return <SetupSchedulingManagement tenantId={tenantId} />;
  if (page === 'settings') return <div className="page-stack">
    <SettingsManagement tenantId={tenantId} />
    <section className="page-stack settings-payment-availability" aria-label="Payment configuration">
      <div className="section-heading"><div><p className="eyebrow">Settings · Payments</p><h2>Branch availability & terminals</h2></div><p className="muted">Configure where payment methods can be used and add physical card terminals. Reconciliation and customer balances remain under Money.</p></div>
      <PaymentBranchManagement tenantId={tenantId} />
    </section>
  </div>;
  return null;
}

function DeviceManagement({ tenantId }: { tenantId: string }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.rpc('get_sellertray_accessible_branches', { p_tenant_id: tenantId }).then(({ data, error: rpcError }) => {
      if (!active) return;
      if (rpcError) { setError(errorMessage(rpcError, 'Unable to load Printer Branches.')); return; }
      const next = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id ?? ''), name: String(row.name ?? 'Branch'), isDefault: row.is_default === true })).filter((row) => row.id);
      setBranches(next);
      setBranchId(next.find((row) => row.isDefault)?.id ?? next[0]?.id ?? '');
    });
    return () => { active = false; };
  }, [tenantId]);

  if (error) return <article className="panel"><div className="error-banner compact">{error}</div></article>;
  if (!branches.length) return <article className="panel"><div className="empty-state"><strong>No active Branch</strong><p>Create or activate a Branch before managing printers.</p></div></article>;

  const branch = branches.find((row) => row.id === branchId) ?? branches[0];
  return <div className="page-stack">
    <label className="select-field device-branch-select"><span>Printer Branch</span><SellerTraySelect value={branch?.id ?? ''} onChange={(event) => setBranchId(event.target.value)}>{branches.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</SellerTraySelect></label>
    <DevicesPrintersManagement tenantId={tenantId} branchId={branch?.id ?? ''} branchName={branch?.name ?? ''} />
  </div>;
}
