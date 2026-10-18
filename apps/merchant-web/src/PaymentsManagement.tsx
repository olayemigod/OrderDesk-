import PaymentBranchManagement from './PaymentBranchManagement';
import PaymentReconciliationManagement from './PaymentReconciliationManagement';
import ReceivablesManagement from './ReceivablesManagement';

export default function PaymentsManagement({ tenantId }: { tenantId: string }) {
  return <div className="page-stack">
    <div className="section-heading">
      <div><p className="eyebrow">Money</p><h2>Payments</h2></div>
      <p className="muted">Reconcile payments, follow customer balances, and manage where payment methods can be used.</p>
    </div>
    <PaymentReconciliationManagement tenantId={tenantId} />
    <ReceivablesManagement tenantId={tenantId} />
    <PaymentBranchManagement tenantId={tenantId} />
  </div>;
}
