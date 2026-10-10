import ProductsManagement from './ProductsManagement';
import TeamBranchesManagement from './TeamBranchesManagement';

type ManagementPageId = 'products' | 'team' | 'devices' | 'settings';

export default function ManagementPage({
  page,
  tenantId,
  currency,
  onBranchesChanged,
}: {
  page: ManagementPageId;
  tenantId: string;
  currency: string;
  onBranchesChanged?: () => void | Promise<void>;
}) {
  if (page === 'products') return <ProductsManagement tenantId={tenantId} currency={currency} />;
  if (page === 'team') return <TeamBranchesManagement tenantId={tenantId} onBranchesChanged={onBranchesChanged} />;
  if (page === 'devices') return <Placeholder title="Devices & Printers" body="Review registers, receipt printers and print-job history without changing completed sales." />;
  return <Placeholder title="Settings" body="Business profile, payments, WhatsApp configuration and merchant preferences will live here." />;
}

function Placeholder({ title, body }: { title: string; body: string }) {
  return <article className="panel placeholder-panel"><div className="placeholder-mark">{initials(title)}</div><div><h3>{title}</h3><p className="muted">{body}</p></div></article>;
}

function initials(value: string): string {
  return value.split(/\s|&/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}
