import type { Session } from '@supabase/supabase-js';
import AgreementLifecycleCore from './AgreementLifecycleCore';
import OrderFormTemplateAdministration from './OrderFormTemplateAdministration';

// Agreements is intentionally platform-scoped; tenant context is optional and used only for Business acceptance review.
export default function AgreementLifecycleManagement({ session, tenantId }: { session: Session; tenantId?: string }) {
  return <div className="workspace-stack">
    <AgreementLifecycleCore session={session} tenantId={tenantId ?? ''} />
    <OrderFormTemplateAdministration session={session} />
  </div>;
}
