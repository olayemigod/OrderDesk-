import PaymentBranchManagement from './PaymentBranchManagement';

export default function PaymentsManagement({ tenantId }: { tenantId: string }) {
  return <div className="page-stack">
    <div className="section-heading">
      <div>
        <p className="eyebrow">Money</p>
        <h2>Payments</h2>
      </div>
      <p className="muted">Manage where configured payment methods and card terminals can be used. Settlement and reconciliation remain governed workflows and are not represented here until their shared authority is available.</p>
    </div>
    <PaymentBranchManagement tenantId={tenantId} />
  </div>;
}
