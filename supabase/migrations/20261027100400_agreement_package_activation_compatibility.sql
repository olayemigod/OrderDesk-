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

-- Keep the billing-state read model aligned with the service-delivery gate.
-- Existing OA5C orders without an Order Form remain Master-only; package-path
-- orders report agreement readiness only after their exact current Order Form is
-- confirmed as well.
create or replace function public.get_sellertray_installment_billing_state(
  p_tenant_id uuid,
  p_installment_obligation_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_state jsonb;
  v_master_accepted_at timestamptz;
  v_contract_accepted_at timestamptz;
  v_entitlement_state text;
  v_setup_required integer;
  v_setup_ready integer;
  v_qualifying_settled boolean;
  v_commercial_order_id uuid;
  v_order_form_confirmation_required boolean := false;
  v_order_form_confirmed boolean := false;
begin
  v_state := public.get_sellertray_installment_billing_state_legacy_order_agreement(
    p_tenant_id,
    p_installment_obligation_id
  );
  v_commercial_order_id := nullif(v_state->>'commercialOrderId','')::uuid;
  v_master_accepted_at := public.sellertray_master_agreement_accepted_at(p_tenant_id,now());

  if v_commercial_order_id is not null then
    v_contract_accepted_at := public.sellertray_installment_contract_accepted_at(
      p_tenant_id,v_commercial_order_id,p_installment_obligation_id
    );

    select exists (
      select 1
      from public.sellertray_commercial_order_forms f
      where f.tenant_id=p_tenant_id
        and f.commercial_order_id=v_commercial_order_id
        and f.installment_obligation_id is not distinct from p_installment_obligation_id
        and not exists (
          select 1
          from public.sellertray_commercial_order_forms replacement
          where replacement.tenant_id=f.tenant_id
            and replacement.supersedes_order_form_id=f.id
        )
    ) into v_order_form_confirmation_required;

    if v_order_form_confirmation_required then
      select exists (
        select 1
        from public.sellertray_commercial_order_forms f
        join public.sellertray_order_form_confirmations c
          on c.tenant_id=f.tenant_id and c.order_form_id=f.id
        where f.tenant_id=p_tenant_id
          and f.commercial_order_id=v_commercial_order_id
          and f.installment_obligation_id is not distinct from p_installment_obligation_id
          and not exists (
            select 1
            from public.sellertray_commercial_order_forms replacement
            where replacement.tenant_id=f.tenant_id
              and replacement.supersedes_order_form_id=f.id
          )
      ) into v_order_form_confirmed;
    end if;
  else
    v_contract_accepted_at := v_master_accepted_at;
  end if;

  v_entitlement_state := coalesce(v_state->>'entitlementState','pending');
  if v_entitlement_state not in ('provisional','full') then
    v_setup_required := coalesce((v_state->>'setupRequiredCount')::integer,0);
    v_setup_ready := coalesce((v_state->>'setupReadyCount')::integer,0);
    v_qualifying_settled := coalesce((v_state->>'qualifyingSettlementSatisfied')::boolean,false);

    if v_contract_accepted_at is null then
      v_entitlement_state := 'pending_agreement';
    elsif v_setup_required=0 or v_setup_ready<v_setup_required then
      v_entitlement_state := 'pending_setup';
    elsif not v_qualifying_settled then
      v_entitlement_state := 'awaiting_qualifying_settlement';
    else
      v_entitlement_state := 'ready_for_activation';
    end if;
  end if;

  return v_state || jsonb_build_object(
    'agreementAccepted',v_contract_accepted_at is not null,
    'agreementAcceptedAt',v_contract_accepted_at,
    'masterAgreementAccepted',v_master_accepted_at is not null,
    'masterAgreementAcceptedAt',v_master_accepted_at,
    'masterAgreementVersionId',public.resolve_sellertray_master_agreement_version_id(now()),
    'orderFormConfirmationRequired',v_order_form_confirmation_required,
    'orderFormConfirmed',case when v_order_form_confirmation_required then v_order_form_confirmed else null end,
    'entitlementState',v_entitlement_state
  );
end;
$$;
revoke all on function public.get_sellertray_installment_billing_state(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_installment_billing_state(uuid,uuid)
  to service_role;

-- Keep the universal legal prerequisite visible at the actual service-delivery
-- boundary. The renamed core retains the package-aware Order Form check above.
alter function public.reconcile_sellertray_installment_entitlement(uuid,uuid)
  rename to reconcile_sellertray_installment_entitlement_package_core;

create or replace function public.reconcile_sellertray_installment_entitlement(
  p_tenant_id uuid,
  p_installment_obligation_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
begin
  if public.sellertray_master_agreement_accepted_at(p_tenant_id,now()) is null then
    return public.get_sellertray_installment_billing_state(
      p_tenant_id,p_installment_obligation_id
    );
  end if;

  return public.reconcile_sellertray_installment_entitlement_package_core(
    p_tenant_id,p_installment_obligation_id
  );
end;
$$;

revoke all on function public.reconcile_sellertray_installment_entitlement(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.reconcile_sellertray_installment_entitlement(uuid,uuid)
  to service_role;

commit;
