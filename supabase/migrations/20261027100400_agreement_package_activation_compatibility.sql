begin;

-- Preserve the universal Master Agreement as the service-delivery authority for
-- every current OA5C commercial order. Orders that have moved onto the new
-- Agreement Package contract additionally require confirmation of their exact
-- current Order Form. Legacy C1A order-bound acceptance never substitutes for
-- the universal Master Agreement.
--
-- Hosted OA5C proof environments received different ad-hoc subsets of the
-- repository migrations before this file became authoritative. This migration
-- therefore converges the final activation boundary from either shape instead
-- of assuming that 20261027100000 supplied every intermediate function body.
-- It mutates no commercial/legal history and only reconstructs governed
-- functions/aliases to the same final state produced by a clean replay.

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

-- Keep every caller, including older OA5C compatibility code, on the same final
-- contract gate rather than a stale Master-only helper.
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
  select public.sellertray_installment_contract_accepted_at(
    p_tenant_id,p_commercial_order_id,p_installment_obligation_id
  ) is not null
$$;
revoke all on function public.sellertray_installment_agreement_is_accepted(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_installment_agreement_is_accepted(uuid,uuid,uuid)
  to service_role;

-- Some hosted proof environments never received the clean-replay billing-state
-- alias. Preserve the currently installed read model under the expected legacy
-- name before replacing the public package-aware boundary. Clean installs and
-- already-converged environments simply skip this rename.
do $$
begin
  if to_regprocedure('public.get_sellertray_installment_billing_state_legacy_order_agreement(uuid,uuid)') is null then
    if to_regprocedure('public.get_sellertray_installment_billing_state(uuid,uuid)') is null then
      raise exception 'SellerTray installment billing-state authority is missing' using errcode='P0002';
    end if;
    alter function public.get_sellertray_installment_billing_state(uuid,uuid)
      rename to get_sellertray_installment_billing_state_legacy_order_agreement;
  end if;
end;
$$;
revoke all on function public.get_sellertray_installment_billing_state_legacy_order_agreement(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_installment_billing_state_legacy_order_agreement(uuid,uuid)
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

-- Hosted proof subsets did not all receive the same entitlement-reconciliation
-- body. Preserve the currently installed function under the clean-replay core
-- name when needed, then overwrite that core with the canonical package-aware
-- implementation. This prevents migration-history repair from freezing an old
-- Master-only or legacy-order implementation into the target runtime.
do $$
begin
  if to_regprocedure('public.reconcile_sellertray_installment_entitlement_package_core(uuid,uuid)') is null then
    if to_regprocedure('public.reconcile_sellertray_installment_entitlement(uuid,uuid)') is null then
      raise exception 'SellerTray installment entitlement reconciliation authority is missing' using errcode='P0002';
    end if;
    alter function public.reconcile_sellertray_installment_entitlement(uuid,uuid)
      rename to reconcile_sellertray_installment_entitlement_package_core;
  end if;
end;
$$;

create or replace function public.reconcile_sellertray_installment_entitlement_package_core(
  p_tenant_id uuid,
  p_installment_obligation_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_snapshot public.sellertray_installment_contract_snapshots%rowtype;
  v_subscription public.tenant_subscriptions%rowtype;
  v_existing_provisional public.sellertray_commercial_entitlement_events%rowtype;
  v_existing_full public.sellertray_commercial_entitlement_events%rowtype;
  v_plan_code text;
  v_billing_cycle text;
  v_agreement_accepted_at timestamptz;
  v_setup_required integer:=0;
  v_setup_ready integer:=0;
  v_setup_ready_at timestamptz;
  v_settlement jsonb;
  v_qualifying_settled boolean:=false;
  v_fully_settled boolean:=false;
  v_settlement_at timestamptz;
  v_activation_at timestamptz;
  v_provisional_until timestamptz;
  v_full_until timestamptz;
  v_provisional_id uuid;
  v_full_id uuid;
  v_runtime_owned boolean:=false;
begin
  perform public.lock_sellertray_commercial_order(io.tenant_id,io.commercial_order_id)
  from public.sellertray_commercial_installment_obligations io
  where io.tenant_id=p_tenant_id and io.id=p_installment_obligation_id;
  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.id=p_installment_obligation_id;
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=v_obligation.commercial_order_id;
  select s.* into strict v_snapshot
  from public.sellertray_installment_contract_snapshots s
  where s.tenant_id=p_tenant_id and s.installment_obligation_id=v_obligation.id;
  select s.plan_code,s.billing_cycle into strict v_plan_code,v_billing_cycle
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=p_tenant_id and s.commercial_order_id=v_order.id and s.line_type='subscription';

  v_agreement_accepted_at:=public.sellertray_installment_contract_accepted_at(
    p_tenant_id,v_order.id,v_obligation.id
  );
  select count(*)::integer,count(r.id)::integer,max(r.ready_at)
  into v_setup_required,v_setup_ready,v_setup_ready_at
  from public.sellertray_commercial_order_price_snapshots s
  left join public.sellertray_commercial_branch_setup_readiness r
    on r.tenant_id=s.tenant_id and r.commercial_order_id=s.commercial_order_id and r.branch_id=s.branch_id
  where s.tenant_id=p_tenant_id and s.commercial_order_id=v_order.id and s.line_type='branch_setup';

  v_settlement:=public.get_sellertray_commercial_settlement_state(p_tenant_id,v_order.id);
  v_fully_settled:=coalesce((v_settlement->>'outstandingAmount')::numeric,0)<0.005;
  select coalesce(bool_and((x->>'remainingAmount')::numeric<0.005),false)
  into v_qualifying_settled
  from jsonb_array_elements(coalesce(v_settlement->'schedule','[]'::jsonb)) x
  where (x->>'sequenceNo')::integer<=v_snapshot.qualifying_settlement_sequence;
  select max(event_at) into v_settlement_at
  from (
    select a.approved_at event_at from public.sellertray_commercial_adjustments a
      where a.tenant_id=p_tenant_id and a.commercial_order_id=v_order.id
    union all
    select pc.paid_at from public.sellertray_commercial_installment_payment_confirmations pc
      where pc.tenant_id=p_tenant_id and pc.commercial_order_id=v_order.id
    union all
    select dp.paid_at from public.sellertray_commercial_direct_payment_confirmations dp
      where dp.tenant_id=p_tenant_id and dp.commercial_order_id=v_order.id
  ) settlement_fact;
  select e.* into v_existing_provisional
  from public.sellertray_commercial_entitlement_events e
  where e.tenant_id=p_tenant_id and e.installment_obligation_id=v_obligation.id
    and e.event_type='installment.provisional_activated'
  order by e.recorded_at desc limit 1;
  select e.* into v_existing_full
  from public.sellertray_commercial_entitlement_events e
  where e.tenant_id=p_tenant_id and e.installment_obligation_id=v_obligation.id
    and e.event_type='installment.full_entitlement_released'
  order by e.recorded_at desc limit 1;

  if v_agreement_accepted_at is null
     or v_setup_required=0
     or v_setup_ready<v_setup_required
     or not v_qualifying_settled
     or v_settlement_at is null then
    return public.get_sellertray_installment_billing_state(p_tenant_id,p_installment_obligation_id);
  end if;

  if v_existing_provisional.id is not null then
    v_activation_at:=v_existing_provisional.effective_from;
    v_provisional_id:=v_existing_provisional.id;
  else
    v_activation_at:=greatest(
      v_agreement_accepted_at,
      coalesce(v_setup_ready_at,v_agreement_accepted_at),
      v_settlement_at
    );
  end if;

  if v_billing_cycle='monthly' then
    v_full_until:=v_activation_at+interval '1 month';
  elsif v_billing_cycle='yearly' then
    v_full_until:=v_activation_at+interval '12 months';
  else
    raise exception 'Unsupported SellerTray billing cycle for entitlement reconciliation' using errcode='23514';
  end if;

  if v_snapshot.provisional_entitlement_months>0 then
    v_provisional_until:=least(
      v_activation_at+make_interval(months=>v_snapshot.provisional_entitlement_months),v_full_until
    );
    if v_existing_provisional.id is null then
      v_provisional_id:=public.append_sellertray_commercial_entitlement_event(
        p_tenant_id,v_plan_code,v_order.id,v_obligation.id,
        'installment.provisional_activated','oa2:provisional:'||v_obligation.id::text,
        v_activation_at,v_provisional_until,
        jsonb_build_object(
          'template_code',v_snapshot.template_code,
          'template_version',v_snapshot.template_version,
          'provisional_months',v_snapshot.provisional_entitlement_months,
          'qualifying_settlement_sequence',v_snapshot.qualifying_settlement_sequence,
          'activation_at',v_activation_at,
          'full_term_until',v_full_until,
          'master_agreement_version_id',public.resolve_sellertray_master_agreement_version_id(v_activation_at)
        ),
        null,'Governed SellerTray installment provisional entitlement'
      );
    end if;
  elsif not v_fully_settled then
    return public.get_sellertray_installment_billing_state(p_tenant_id,p_installment_obligation_id);
  end if;

  if v_fully_settled then
    if v_existing_full.id is not null then
      v_full_id:=v_existing_full.id;
    else
      v_full_id:=public.append_sellertray_commercial_entitlement_event(
        p_tenant_id,v_plan_code,v_order.id,v_obligation.id,
        'installment.full_entitlement_released','oa2:full:'||v_obligation.id::text,
        v_activation_at,v_full_until,
        jsonb_build_object(
          'template_code',v_snapshot.template_code,
          'template_version',v_snapshot.template_version,
          'billing_cycle',v_billing_cycle,
          'activation_at',v_activation_at,
          'settled_amount',v_settlement->>'netAmountDue',
          'master_agreement_version_id',public.resolve_sellertray_master_agreement_version_id(now())
        ),
        null,'Governed SellerTray full-settlement entitlement release'
      );
    end if;
  end if;

  select s.* into strict v_subscription
  from public.tenant_subscriptions s
  where s.tenant_id=p_tenant_id
  for update;
  if v_subscription.current_period_start is not null and v_subscription.current_period_end is not null then
    select exists(
      select 1 from public.sellertray_commercial_entitlement_events e
      where e.tenant_id=p_tenant_id
        and e.commercial_order_id=v_order.id
        and e.effective_from=v_subscription.current_period_start
        and e.effective_until=v_subscription.current_period_end
        and e.event_type in ('installment.provisional_activated','installment.full_entitlement_released')
    ) into v_runtime_owned;
  end if;
  if v_subscription.status<>'trial' and not v_runtime_owned
     and (v_subscription.current_period_start is not null
       or v_subscription.current_period_end is not null
       or v_subscription.status<>'active') then
    raise exception 'Existing SellerTray runtime subscription is not owned by this commercial installment order'
      using errcode='23505';
  end if;

  update public.tenant_subscriptions
  set plan_code=v_plan_code,
      status='active',
      current_period_start=v_activation_at,
      current_period_end=case when v_full_id is not null then v_full_until else v_provisional_until end,
      grace_ends_at=null,
      cancel_at_period_end=false,
      updated_at=now()
  where tenant_id=p_tenant_id;
  return public.get_sellertray_installment_billing_state(p_tenant_id,p_installment_obligation_id);
end;
$$;
revoke all on function public.reconcile_sellertray_installment_entitlement_package_core(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.reconcile_sellertray_installment_entitlement_package_core(uuid,uuid)
  to service_role;

-- Keep the universal legal prerequisite visible at the actual service-delivery
-- boundary. The converged core retains the package-aware Order Form check above.
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
