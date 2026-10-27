begin;

-- Preserve the universal Master Agreement as the service-delivery authority for
-- every current OA5C commercial order. Orders that have moved onto the new
-- Agreement Package contract additionally require confirmation of their exact
-- current Order Form. Legacy C1A order-bound acceptance never substitutes for
-- the universal Master Agreement.
create or replace function public.sellertray_installment_contract_accepted_at(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_installment_obligation_id uuid
)
returns timestamptz
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_has_current_order_form boolean := false;
  v_order_form_confirmed_at timestamptz;
  v_master_accepted_at timestamptz;
begin
  v_master_accepted_at := public.sellertray_master_agreement_accepted_at(p_tenant_id,now());
  if v_master_accepted_at is null then
    return null;
  end if;

  select exists (
    select 1
    from public.sellertray_commercial_order_forms f
    where f.tenant_id=p_tenant_id
      and f.commercial_order_id=p_commercial_order_id
      and f.installment_obligation_id is not distinct from p_installment_obligation_id
      and not exists (
        select 1
        from public.sellertray_commercial_order_forms replacement
        where replacement.tenant_id=f.tenant_id
          and replacement.supersedes_order_form_id=f.id
      )
  ) into v_has_current_order_form;

  -- Compatibility boundary: OA5C orders created before Order Forms were
  -- introduced remain governed by the already-approved universal Master
  -- Agreement prerequisite. No legacy C1A acceptance fallback is permitted.
  if not v_has_current_order_form then
    return v_master_accepted_at;
  end if;

  select c.confirmed_at
  into v_order_form_confirmed_at
  from public.sellertray_commercial_order_forms f
  join public.sellertray_order_form_confirmations c
    on c.tenant_id=f.tenant_id
   and c.order_form_id=f.id
  where f.tenant_id=p_tenant_id
    and f.commercial_order_id=p_commercial_order_id
    and f.installment_obligation_id is not distinct from p_installment_obligation_id
    and not exists (
      select 1
      from public.sellertray_commercial_order_forms replacement
      where replacement.tenant_id=f.tenant_id
        and replacement.supersedes_order_form_id=f.id
    )
  order by c.confirmed_at desc
  limit 1;

  if v_order_form_confirmed_at is null then
    return null;
  end if;

  return greatest(v_master_accepted_at,v_order_form_confirmed_at);
end;
$$;

revoke all on function public.sellertray_installment_contract_accepted_at(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_installment_contract_accepted_at(uuid,uuid,uuid)
  to service_role;

commit;
