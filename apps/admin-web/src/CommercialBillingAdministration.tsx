import type { Session } from '@supabase/supabase-js';
import CommercialBillingAdministrationLegacy from './CommercialBillingAdministrationLegacy';
import CommercialSettlementAdministration from './CommercialSettlementAdministration';
import SetupSchedulingAdministration from './SetupSchedulingAdministration';

export default function CommercialBillingAdministration({
  session,
  actorRole,
  initialTenantId,
}: {
  session: Session;
  actorRole: 'admin' | 'support';
  initialTenantId?: string | null;
}) {
  return (
    <div className="workspace-stack">
      <CommercialBillingAdministrationLegacy
        session={session}
        actorRole={actorRole}
        initialTenantId={initialTenantId}
      />
      <section className="workspace-panel">
        <div className="workspace-panel-heading">
          <div>
            <h2>Commercial settlement</h2>
            <p>Govern discounts, direct ProcessEdge payments and installment availability from the same authoritative settlement model used by Merchant Web.</p>
          </div>
        </div>
        <CommercialSettlementAdministration session={session} initialTenantId={initialTenantId} />
      </section>
      <SetupSchedulingAdministration session={session} initialTenantId={initialTenantId} />
    </div>
  );
}
