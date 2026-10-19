import { useState } from 'react';
import InventoryReportCenter from './InventoryReportCenter';
import ProcurementReportCenter from './ProcurementReportCenter';
import SalesReportCenter from './SalesReportCenter';
import type { MerchantPortalPage } from './portalNavigation';

type ReportView = 'sales' | 'inventory' | 'purchasing';
type BranchOption = { id: string; name: string };

export default function ReportCenter({ tenantId, currency, branches, go, openBranch }: { tenantId: string; currency: string; branches: BranchOption[]; go: (page: MerchantPortalPage) => void; openBranch: (page: MerchantPortalPage, branchId: string) => void }) {
  const [view, setView] = useState<ReportView>('sales');
  return <div className="page-stack">
    <div className="section-heading"><div><p className="eyebrow">Business reporting</p><h2>Report Center</h2></div><p className="muted">Sales, inventory value, payments, channels, Branch performance, purchasing and supplier balances use the same governed commerce and stock records as SellerTray mobile and WhatsApp.</p></div>
    <div className="report-center-tabs" role="tablist" aria-label="Report Center sections">
      <button type="button" role="tab" aria-selected={view === 'sales'} className={view === 'sales' ? 'active' : ''} onClick={() => setView('sales')}>Sales & Operations</button>
      <button type="button" role="tab" aria-selected={view === 'inventory'} className={view === 'inventory' ? 'active' : ''} onClick={() => setView('inventory')}>Inventory Value</button>
      <button type="button" role="tab" aria-selected={view === 'purchasing'} className={view === 'purchasing' ? 'active' : ''} onClick={() => setView('purchasing')}>Purchasing</button>
    </div>
    {view === 'sales' ? <SalesReportCenter tenantId={tenantId} currency={currency} branches={branches} go={go} openBranch={openBranch} /> : view === 'inventory' ? <InventoryReportCenter tenantId={tenantId} currency={currency} /> : <ProcurementReportCenter tenantId={tenantId} currency={currency} />}
  </div>;
}
