import CashShiftsReview from './CashShiftsReview';

type Branch = { id: string; name: string; isDefault: boolean };

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
  return <CashShiftsReview tenantId={tenantId} currency={currency} branches={branches} initialBranchId={initialBranchId} />;
}
