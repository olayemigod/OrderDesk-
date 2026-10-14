import { useEffect, useState } from 'react';
import DevicesPrintersManagement from './DevicesPrintersManagement';
import PaymentBranchManagement from './PaymentBranchManagement';
import ProductsManagement from './ProductsManagement';
import SettingsManagement from './SettingsManagement';
import TeamBranchesManagement from './TeamBranchesManagement';
import { errorMessage, supabase } from './supabase';

type ManagementPageId = 'products' | 'team' | 'devices' | 'settings';
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
  if (page === 'team') return <TeamBranchesManagement tenantId={tenantId} onBranchesChanged={onBranchesChanged} />;
  if (page === 'devices') return <DeviceManagement tenantId={tenantId} />;
  return <div className="page-stack"><SettingsManagement tenantId={tenantId} /><PaymentBranchManagement tenantId={tenantId} /></div>;
}

function DeviceManagement({ tenantId }: { tenantId: string }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.rpc('get_sellertray_accessible_branches', { p_tenant_id: tenantId }).then(({ data, error: rpcError }) => {
      if (!active) return;
      if (rpcError) {
        setError(errorMessage(rpcError, 'Unable to load Printer Branches.'));
        return;
      }
      const next = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id ?? ''),
        name: String(row.name ?? 'Branch'),
        isDefault: row.is_default === true,
      })).filter((row) => row.id);
      setBranches(next);
      setBranchId(next.find((row) => row.isDefault)?.id ?? next[0]?.id ?? '');
    });
    return () => { active = false; };
  }, [tenantId]);

  if (error) return <article className="panel"><div className="error-banner compact">{error}</div></article>;
  if (!branches.length) return <article className="panel"><div className="empty-state"><strong>No active Branch</strong><p>Create or activate a Branch before managing registers and printers.</p></div></article>;

  const branch = branches.find((row) => row.id === branchId) ?? branches[0];
  return <div className="page-stack">
    <label className="select-field device-branch-select"><span>Printer Branch</span><select value={branch?.id ?? ''} onChange={(event) => setBranchId(event.target.value)}>{branches.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
    <DevicesPrintersManagement tenantId={tenantId} branchId={branch?.id ?? ''} branchName={branch?.name ?? ''} />
  </div>;
}
