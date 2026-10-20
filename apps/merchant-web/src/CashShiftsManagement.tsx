import { useEffect, useState } from 'react';
import BusinessExpensesManagement from './BusinessExpensesManagement';
import CashShiftsReview from './CashShiftsReview';

type Branch = { id: string; name: string; isDefault: boolean };
type MoneyView = 'shifts' | 'expenses';

export default function CashShiftsManagement({
  tenantId,
  currency,
  branches,
  initialBranchId,
}: {
  tenantId: string;
  currency: string;
  branches: Branch[];
  initialBranchId?: string;
}) {
  const [view, setView] = useState<MoneyView>('shifts');

  useEffect(() => {
    setView('shifts');
  }, [tenantId]);

  return <div className="page-stack">
    <article className="panel">
      <div className="panel-head">
        <div><p className="eyebrow">Money</p><h3>Cash & Expenses</h3><p className="muted">Review cashier drawers separately from management-level Business Expenses. Deposits and owner withdrawals remain cash transfers, not operating expenses.</p></div>
      </div>
      <div className="panel-actions" role="tablist" aria-label="Money management">
        <button className="secondary-button" disabled={view === 'shifts'} onClick={() => setView('shifts')} role="tab" aria-selected={view === 'shifts'}>Cash & Shifts</button>
        <button className="secondary-button" disabled={view === 'expenses'} onClick={() => setView('expenses')} role="tab" aria-selected={view === 'expenses'}>Business Expenses</button>
      </div>
    </article>

    {view === 'shifts'
      ? <CashShiftsReview tenantId={tenantId} currency={currency} branches={branches} initialBranchId={initialBranchId} />
      : <BusinessExpensesManagement tenantId={tenantId} currency={currency} branches={branches} initialBranchId={initialBranchId} />}
  </div>;
}
