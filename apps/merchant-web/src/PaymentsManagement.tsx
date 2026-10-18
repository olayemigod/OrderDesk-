import PaymentBranchManagement from './PaymentBranchManagement';
import PaymentReconciliationManagement from './PaymentReconciliationManagement';
import ReceivablesManagement from './ReceivablesManagement';

type Branch = { id: string; name: string; isDefault: boolean };
type Props = { tenantId: string; branchId: string; branches: Branch[] };

export default function PaymentsManagement({ tenantId, branchId, branches }: Props) {
  return <div className="page-stack">
    <div className="section-heading">
      <div><p className="eyebrow">Money management</p><h2>Payments</h2></div>
      <p className="muted">Reconcile payments, follow customer balances, and manage where payment methods can be used without bypassing SellerTray payment authority.</p>
    </div>
    <PaymentReconciliationManagement tenantId={tenantId} branchId={branchId} branches={branches} />
    <ReceivablesManagement tenantId={tenantId} branchId={branchId} branches={branches} />
    <PaymentBranchManagement tenantId={tenantId} />
  </div>;
}
