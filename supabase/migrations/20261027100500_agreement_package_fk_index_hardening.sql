begin;

-- Hosted package-proof performance convergence.
--
-- Cover the two Order Form composite foreign keys with full indexes. Supabase's
-- FK advisor does not treat partial indexes as covering nullable foreign keys,
-- so keep these indexes unfiltered even though the final key column may be null.
create index if not exists sellertray_order_forms_installment_order_fk_idx
  on public.sellertray_commercial_order_forms(
    tenant_id,
    commercial_order_id,
    installment_obligation_id
  );

create index if not exists sellertray_order_forms_supersedes_tenant_fk_idx
  on public.sellertray_commercial_order_forms(
    tenant_id,
    supersedes_order_form_id
  );

commit;
