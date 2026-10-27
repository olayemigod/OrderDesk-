begin;

-- Hosted package-proof performance convergence.
--
-- These covering indexes mirror the already-proven agreement-package index
-- hardening from the earlier architecture line and close the two current
-- Order Form foreign-key advisor gaps without changing agreement semantics.
create index if not exists sellertray_order_forms_installment_order_fk_idx
  on public.sellertray_commercial_order_forms(
    tenant_id,
    commercial_order_id,
    installment_obligation_id
  )
  where installment_obligation_id is not null;

create index if not exists sellertray_order_forms_supersedes_tenant_fk_idx
  on public.sellertray_commercial_order_forms(
    tenant_id,
    supersedes_order_form_id
  )
  where supersedes_order_form_id is not null;

commit;
