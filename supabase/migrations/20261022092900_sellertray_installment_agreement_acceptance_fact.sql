begin;

-- Shared SellerTray commercial fact: whether the current installment agreement
-- for an immutable commercial obligation has immutable acceptance evidence.
-- This centralizes the exact C1B predicate without creating a second agreement
-- or entitlement authority.
create or replace function public.sellertray_installment_agreement_is_accepted(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_installment_obligation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1
    from public.sellertray_commercial_agreements a
    join public.sellertray_commercial_agreement_acceptances ac
      on ac.tenant_id=a.tenant_id and ac.agreement_id=a.id
    where a.tenant_id=p_tenant_id
      and a.commercial_order_id=p_commercial_order_id
      and a.installment_obligation_id=p_installment_obligation_id
      and a.agreement_family='installment_agreement'
      and not exists (
        select 1
        from public.sellertray_commercial_agreements replacement
        where replacement.tenant_id=a.tenant_id
          and replacement.supersedes_agreement_id=a.id
      )
  );
$$;

revoke all on function public.sellertray_installment_agreement_is_accepted(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_installment_agreement_is_accepted(uuid,uuid,uuid)
  to service_role;

commit;
