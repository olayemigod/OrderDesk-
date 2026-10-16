import PaymentBranchManagement from './PaymentBranchManagement';
import PaymentReconciliationManagement from './PaymentReconciliationManagement';

export default function PaymentsManagement({ tenantId }: { tenantId: string }) {
  return <div className="page-stack">
    <div className="section-heading">
      <div><p className="eyebrow">Money</p><h2>Payments</h2></div>
      <p className="muted">Review payment verification and exceptions, then manage where payment methods and card terminals can be used.</p>
    </div>
    <PaymentReconciliationManagement tenantId={tenantId} />
    <PaymentBranchManagement tenantId={tenantId} />
  </div>;
}
