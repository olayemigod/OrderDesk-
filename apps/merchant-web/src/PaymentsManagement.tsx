import PaymentBranchManagement from './PaymentBranchManagement';
import PaymentReconciliationManagement from './PaymentReconciliationManagement';
import ReceivablesManagement from './ReceivablesManagement';
import ReturnsManagement from './ReturnsManagement';

export default function PaymentsManagement({ tenantId }: { tenantId: string }) {
  return <div className="page-stack">
    <div className="section-heading">
      <div><p className="eyebrow">Money</p><h2>Payments</h2></div>
      <p className="muted">Reconcile payments, follow customer balances, review returns and refunds, and manage where payment methods can be used.</p>
    </div>
    <PaymentReconciliationManagement tenantId={tenantId} />
    <ReceivablesManagement tenantId={tenantId} />
    <ReturnsManagement tenantId={tenantId} />
    <PaymentBranchManagement tenantId={tenantId} />
  </div>;
}
