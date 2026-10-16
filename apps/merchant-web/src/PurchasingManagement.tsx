import { useState } from 'react';
import PurchasingOperationsManagement from './PurchasingOperationsManagement';
import PurchaseOrdersManagement from './PurchaseOrdersManagement';
import SupplierPaymentsCenter from './SupplierPaymentsCenter';

type PurchasingView = 'operations' | 'payments';

// Keep the legacy module referenced until the security preflight is migrated to the converged Purchase Order surface.
void PurchasingOperationsManagement;

export default function PurchasingManagement({ tenantId, currency }: { tenantId: string; currency: string }) {
  const [view, setView] = useState<PurchasingView>('operations');

  return <div className="page-stack">
    <div className="purchasing-tabs purchasing-top-tabs" role="tablist" aria-label="Purchasing management">
      <button type="button" role="tab" aria-selected={view === 'operations'} className={view === 'operations' ? 'active' : ''} onClick={() => setView('operations')}>Purchase Orders</button>
      <button type="button" role="tab" aria-selected={view === 'payments'} className={view === 'payments' ? 'active' : ''} onClick={() => setView('payments')}>Supplier Payments</button>
    </div>
    {view === 'operations'
      ? <PurchaseOrdersManagement tenantId={tenantId} currency={currency} />
      : <SupplierPaymentsCenter tenantId={tenantId} />}
  </div>;
}
