import { useState } from 'react';
import ProcurementReportCenter from './ProcurementReportCenter';
import SalesReportCenter from './SalesReportCenter';

type ReportView = 'sales' | 'purchasing';

export default function ReportCenter({ tenantId, currency }: { tenantId: string; currency: string }) {
  const [view, setView] = useState<ReportView>('sales');

  return <div className="page-stack">
    <div className="report-center-tabs" role="tablist" aria-label="Report Center sections">
      <button
        type="button"
        role="tab"
        aria-selected={view === 'sales'}
        className={view === 'sales' ? 'active' : ''}
        onClick={() => setView('sales')}
      >
        Sales & Operations
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === 'purchasing'}
        className={view === 'purchasing' ? 'active' : ''}
        onClick={() => setView('purchasing')}
      >
        Purchasing
      </button>
    </div>

    {view === 'sales'
      ? <SalesReportCenter tenantId={tenantId} currency={currency} />
      : <ProcurementReportCenter tenantId={tenantId} currency={currency} />}
  </div>;
}
