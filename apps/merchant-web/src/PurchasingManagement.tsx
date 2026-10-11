import { useState } from 'react';
import PurchasingOperationsManagement from './PurchasingOperationsManagement';
import SupplierPaymentsCenter from './SupplierPaymentsCenter';

type PurchasingView = 'operations' | 'payments';

export default function PurchasingManagement({ tenantId, currency }: { tenantId: string; currency: string }) {
  const [view, setView] = useState<PurchasingView>('operations');

  return <div className="page-stack">
    <div className="purchasing-tabs purchasing-top-tabs" role="tablist" aria-label="Purchasing management">
      <button
        type="button"
        role="tab"
        aria-selected={view === 'operations'}
        className={view === 'operations' ? 'active' : ''}
        onClick={() => setView('operations')}
      >
        Purchasing
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === 'payments'}
        className={view === 'payments' ? 'active' : ''}
        onClick={() => setView('payments')}
      >
        Supplier Payments
      </button>
    </div>

    {view === 'operations'
      ? <PurchasingOperationsManagement tenantId={tenantId} currency={currency} />
      : <SupplierPaymentsCenter tenantId={tenantId} />}
  </div>;
}
