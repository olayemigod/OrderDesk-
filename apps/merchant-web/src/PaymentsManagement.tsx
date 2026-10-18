import { useEffect, useState } from 'react';
import PaymentBranchManagement from './PaymentBranchManagement';
import PaymentReconciliationManagement from './PaymentReconciliationManagement';
import ReceivablesManagement from './ReceivablesManagement';
import { errorMessage, supabase } from './supabase';

type Branch = { id: string; name: string; isDefault: boolean };

export default function PaymentsManagement({ tenantId }: { tenantId: string }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.rpc('get_sellertray_accessible_branches', { p_tenant_id: tenantId }).then(({ data, error: branchError }) => {
      if (!active) return;
      if (branchError) {
        setBranches([]);
        setError(errorMessage(branchError, 'Unable to load Branch filters for money management.'));
        return;
      }
      setError(null);
      setBranches(((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id ?? ''),
        name: String(row.name ?? 'Branch'),
        isDefault: row.is_default === true,
      })).filter((row) => row.id));
    });
    return () => { active = false; };
  }, [tenantId]);

  return <div className="page-stack">
    <div className="section-heading">
      <div><p className="eyebrow">Money management</p><h2>Payments</h2></div>
      <p className="muted">Reconcile payments, follow customer balances, and manage where payment methods can be used without bypassing SellerTray payment authority.</p>
    </div>
    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
    <PaymentReconciliationManagement tenantId={tenantId} branches={branches} />
    <ReceivablesManagement tenantId={tenantId} branches={branches} />
    <PaymentBranchManagement tenantId={tenantId} />
  </div>;
}
