import { useEffect, useState } from 'react';
import PaymentReconciliationManagement from './PaymentReconciliationManagement';
import ReceivablesManagement from './ReceivablesManagement';
import { errorMessage, supabase } from './supabase';

type Branch = { id: string; name: string; isDefault: boolean };
type MoneyTab = 'reconciliation' | 'receivables';

export default function PaymentsManagement({ tenantId }: { tenantId: string }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeTab, setActiveTab] = useState<MoneyTab>('reconciliation');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setActiveTab('reconciliation');
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
      <div><p className="eyebrow">Money requiring action</p><h2>Payments & Receivables</h2></div>
      <p className="muted">Reconcile payment activity and collect outstanding customer balances here. Payment-method configuration belongs in Settings.</p>
    </div>
    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
    <div className="management-tabs" role="tablist" aria-label="Payments and receivables">
      <button type="button" role="tab" aria-selected={activeTab === 'reconciliation'} className={activeTab === 'reconciliation' ? 'active' : ''} onClick={() => setActiveTab('reconciliation')}>Reconciliation</button>
      <button type="button" role="tab" aria-selected={activeTab === 'receivables'} className={activeTab === 'receivables' ? 'active' : ''} onClick={() => setActiveTab('receivables')}>Customer Receivables</button>
    </div>
    {activeTab === 'reconciliation'
      ? <PaymentReconciliationManagement tenantId={tenantId} branches={branches} />
      : <ReceivablesManagement tenantId={tenantId} branches={branches} />}
  </div>;
}
