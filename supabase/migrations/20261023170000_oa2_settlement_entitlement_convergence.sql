begin;

-- SellerTray OA2 settlement/entitlement convergence
--
-- Entitlement is still released only by reconciliation. OA2 changes the inputs:
-- settlement may contain approved adjustments, direct payments and gateway
-- confirmations, and provisional duration comes from the immutable contract
-- snapshot rather than hard-coded structure names.

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
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_snapshot public.sellertray_installment_contract_snapshots%rowtype;
  v_plan_code text;
  v_billing_cycle text;
  v_agreement_accepted_at timestamptz;
  v_setup_required integer := 0;
  v_setup_ready integer := 0;
  v_setup_ready_at timestamptz;
  v_settlement jsonb;
  v_schedule jsonb := '[]'::jsonb;
  v_schedule_count integer := 0;
  v_settled_count integer := 0;
  v_qualifying_settled boolean := false;
  v_first_paid_at timestamptz;
  v_first_settlement_at timestamptz;
  v_provisional public.sellertray_commercial_entitlement_events%rowtype;
  v_full public.sellertray_commercial_entitlement_events%rowtype;
  v_state text := 'pending';
begin
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
  where s.tenant_id=p_tenant_id and s.commercial_order_id=v_order.id
    and s.line_type='subscription';

  select ac.accepted_at into v_agreement_accepted_at
  from public.sellertray_commercial_agreements a
  join public.sellertray_commercial_agreement_acceptances ac
    on ac.tenant_id=a.tenant_id and ac.agreement_id=a.id
  where a.tenant_id=p_tenant_id
    and a.commercial_order_id=v_order.id
    and a.installment_obligation_id=v_obligation.id
    and a.agreement_family='installment_agreement'
    and not exists (
      select 1 from public.sellertray_commercial_agreements replacement
      where replacement.tenant_id=a.tenant_id and replacement.supersedes_agreement_id=a.id
    )
  order by ac.accepted_at desc
  limit 1;

  select count(*)::integer,count(r.id)::integer,max(r.ready_at)
    into v_setup_required,v_setup_ready,v_setup_ready_at
  from public.sellertray_commercial_order_price_snapshots s
  left join public.sellertray_commercial_branch_setup_readiness r
    on r.tenant_id=s.tenant_id
   and r.commercial_order_id=s.commercial_order_id
   and r.branch_id=s.branch_id
  where s.tenant_id=p_tenant_id
    and s.commercial_order_id=v_order.id
    and s.line_type='branch_setup';

  v_settlement := public.get_sellertray_commercial_settlement_state(p_tenant_id,v_order.id);

  with allocation as (
    select (x->>'scheduleId')::uuid as schedule_id,
           (x->>'settledAmount')::numeric as settled_amount,
           (x->>'remainingAmount')::numeric as remaining_amount
    from jsonb_array_elements(coalesce(v_settlement->'schedule','[]'::jsonb)) x
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',sch.id,
           'sequenceNo',sch.sequence_no,
           'percentage',sch.percentage,
           'amountDue',sch.amount_due,
           'settledAmount',coalesce(a.settled_amount,0),
           'remainingAmount',coalesce(a.remaining_amount,sch.amount_due),
           'dueAt',sch.due_at,
           'paymentStatus',case
             when coalesce(a.remaining_amount,sch.amount_due)<0.005 then 'settled'
             when coalesce(a.settled_amount,0)>0 then 'partial'
             else 'unpaid'
           end,
           'dueState',case
             when coalesce(a.remaining_amount,sch.amount_due)<0.005 then 'settled'
             when sch.due_at is null then 'unscheduled'
             when sch.due_at<=now() then 'past_due'
             else 'scheduled'
           end,
           'paidAt',pc.paid_at,
           'provider',pc.provider,
           'providerReference',pc.provider_reference
         ) order by sch.sequence_no),'[]'::jsonb),
         count(*)::integer,
         count(*) filter (where coalesce(a.remaining_amount,sch.amount_due)<0.005)::integer
    into v_schedule,v_schedule_count,v_settled_count
  from public.sellertray_commercial_installment_schedule sch
  left join allocation a on a.schedule_id=sch.id
  left join public.sellertray_commercial_installment_payment_confirmations pc
    on pc.tenant_id=sch.tenant_id and pc.installment_schedule_id=sch.id
  where sch.tenant_id=p_tenant_id and sch.installment_obligation_id=v_obligation.id;

  select coalesce(bool_and((x->>'remainingAmount')::numeric<0.005),false)
    into v_qualifying_settled
  from jsonb_array_elements(coalesce(v_settlement->'schedule','[]'::jsonb)) x
  where (x->>'sequenceNo')::integer<=v_snapshot.qualifying_settlement_sequence;

  select min(paid_at) into v_first_paid_at
  from (
    select pc.paid_at
    from public.sellertray_commercial_installment_payment_confirmations pc
    where pc.tenant_id=p_tenant_id and pc.commercial_order_id=v_order.id
    union all
    select dp.paid_at
    from public.sellertray_commercial_direct_payment_confirmations dp
    where dp.tenant_id=p_tenant_id and dp.commercial_order_id=v_order.id
  ) paid;

  select min(event_at) into v_first_settlement_at
  from (
    select a.approved_at as event_at
    from public.sellertray_commercial_adjustments a
    where a.tenant_id=p_tenant_id and a.commercial_order_id=v_order.id
    union all
    select pc.paid_at
    from public.sellertray_commercial_installment_payment_confirmations pc
    where pc.tenant_id=p_tenant_id and pc.commercial_order_id=v_order.id
    union all
    select dp.paid_at
    from public.sellertray_commercial_direct_payment_confirmations dp
    where dp.tenant_id=p_tenant_id and dp.commercial_order_id=v_order.id
  ) settlement_fact;

  select e.* into v_provisional
  from public.sellertray_commercial_entitlement_events e
  where e.tenant_id=p_tenant_id and e.installment_obligation_id=v_obligation.id
    and e.event_type='installment.provisional_activated'
  order by e.recorded_at desc limit 1;

  select e.* into v_full
  from public.sellertray_commercial_entitlement_events e
  where e.tenant_id=p_tenant_id and e.installment_obligation_id=v_obligation.id
    and e.event_type='installment.full_entitlement_released'
  order by e.recorded_at desc limit 1;

  if v_full.id is not null then
    v_state := 'full';
  elsif v_provisional.id is not null then
    v_state := 'provisional';
  elsif v_agreement_accepted_at is null then
    v_state := 'pending_agreement';
  elsif v_setup_ready<v_setup_required then
    v_state := 'pending_setup';
  elsif not v_qualifying_settled then
    v_state := 'awaiting_qualifying_settlement';
  else
    v_state := 'ready_for_activation';
  end if;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'commercialOrderId',v_order.id,
    'installmentObligationId',v_obligation.id,
    'structureCode',v_obligation.structure_code,
    'contractTemplateCode',v_snapshot.template_code,
    'contractTemplateVersion',v_snapshot.template_version,
    'currency',v_obligation.currency,
    'obligatedAmount',v_obligation.obligated_amount,
    'planCode',v_plan_code,
    'billingCycle',v_billing_cycle,
    'agreementAccepted',v_agreement_accepted_at is not null,
    'agreementAcceptedAt',v_agreement_accepted_at,
    'setupRequiredCount',v_setup_required,
    'setupReadyCount',v_setup_ready,
    'setupReady',v_setup_ready=v_setup_required,
    'setupReadyAt',v_setup_ready_at,
    'paidInstallmentCount',v_settled_count,
    'installmentCount',v_schedule_count,
    'qualifyingSettlementSequence',v_snapshot.qualifying_settlement_sequence,
    'qualifyingSettlementSatisfied',v_qualifying_settled,
    'provisionalEntitlementMonths',v_snapshot.provisional_entitlement_months,
    'fullyPaid',coalesce((v_settlement->>'outstandingAmount')::numeric,0)<0.005,
    'firstPaidAt',v_first_paid_at,
    'firstSettlementAt',v_first_settlement_at,
    'entitlementState',v_state,
    'activationAt',coalesce(v_provisional.effective_from,v_full.effective_from),
    'provisionalUntil',v_provisional.effective_until,
    'fullTermUntil',v_full.effective_until,
    'nextPayableScheduleId',nullif(v_settlement->>'nextInstallmentScheduleId','')::uuid,
    'nextPayableAmount',coalesce((v_settlement->>'nextPayableAmount')::numeric,0),
    'settlement',v_settlement,
    'schedule',v_schedule,
    'dueEnforcementMode','informational_only'
  );
end;
$$;

revoke all on function public.get_sellertray_installment_billing_state(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_installment_billing_state(uuid,uuid)
  to service_role;

create or replace function public.reconcile_sellertray_installment_entitlement(
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
  v_setup_required integer := 0;
  v_setup_ready integer := 0;
  v_setup_ready_at timestamptz;
  v_settlement jsonb;
  v_qualifying_settled boolean := false;
  v_fully_settled boolean := false;
  v_settlement_at timestamptz;
  v_activation_at timestamptz;
  v_provisional_until timestamptz;
  v_full_until timestamptz;
  v_provisional_id uuid;
  v_full_id uuid;
  v_runtime_owned boolean := false;
begin
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
  where s.tenant_id=p_tenant_id and s.commercial_order_id=v_order.id
    and s.line_type='subscription';

  select ac.accepted_at into v_agreement_accepted_at
  from public.sellertray_commercial_agreements a
  join public.sellertray_commercial_agreement_acceptances ac
    on ac.tenant_id=a.tenant_id and ac.agreement_id=a.id
  where a.tenant_id=p_tenant_id
    and a.commercial_order_id=v_order.id
    and a.installment_obligation_id=v_obligation.id
    and a.agreement_family='installment_agreement'
    and not exists (
      select 1 from public.sellertray_commercial_agreements replacement
      where replacement.tenant_id=a.tenant_id and replacement.supersedes_agreement_id=a.id
    )
  order by ac.accepted_at desc limit 1;

  select count(*)::integer,count(r.id)::integer,max(r.ready_at)
    into v_setup_required,v_setup_ready,v_setup_ready_at
  from public.sellertray_commercial_order_price_snapshots s
  left join public.sellertray_commercial_branch_setup_readiness r
    on r.tenant_id=s.tenant_id
   and r.commercial_order_id=s.commercial_order_id
   and r.branch_id=s.branch_id
  where s.tenant_id=p_tenant_id and s.commercial_order_id=v_order.id
    and s.line_type='branch_setup';

  v_settlement := public.get_sellertray_commercial_settlement_state(p_tenant_id,v_order.id);
  v_fully_settled := coalesce((v_settlement->>'outstandingAmount')::numeric,0)<0.005;

  select coalesce(bool_and((x->>'remainingAmount')::numeric<0.005),false)
    into v_qualifying_settled
  from jsonb_array_elements(coalesce(v_settlement->'schedule','[]'::jsonb)) x
  where (x->>'sequenceNo')::integer<=v_snapshot.qualifying_settlement_sequence;

  -- Reconciliation consumes immutable settlement facts. The latest fact present
  -- when the qualifying threshold is first reconciled is a conservative,
  -- deterministic activation boundary. Once a provisional event exists its
  -- original effective_from remains authoritative on every replay.
  select max(event_at) into v_settlement_at
  from (
    select a.approved_at as event_at
    from public.sellertray_commercial_adjustments a
    where a.tenant_id=p_tenant_id and a.commercial_order_id=v_order.id
    union all
    select pc.paid_at
    from public.sellertray_commercial_installment_payment_confirmations pc
    where pc.tenant_id=p_tenant_id and pc.commercial_order_id=v_order.id
    union all
    select dp.paid_at
    from public.sellertray_commercial_direct_payment_confirmations dp
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
     or v_setup_ready<v_setup_required
     or not v_qualifying_settled
     or v_settlement_at is null then
    return public.get_sellertray_installment_billing_state(p_tenant_id,p_installment_obligation_id);
  end if;

  if v_existing_provisional.id is not null then
    v_activation_at := v_existing_provisional.effective_from;
    v_provisional_id := v_existing_provisional.id;
  else
    v_activation_at := greatest(
      v_agreement_accepted_at,
      coalesce(v_setup_ready_at,v_agreement_accepted_at),
      v_settlement_at
    );
  end if;

  if v_billing_cycle='monthly' then
    v_full_until := v_activation_at+interval '1 month';
  elsif v_billing_cycle='yearly' then
    v_full_until := v_activation_at+interval '12 months';
  else
    raise exception 'Unsupported SellerTray billing cycle for entitlement reconciliation'
      using errcode='23514';
  end if;

  if v_snapshot.provisional_entitlement_months>0 then
    v_provisional_until := least(
      v_activation_at+make_interval(months=>v_snapshot.provisional_entitlement_months),
      v_full_until
    );

    if v_existing_provisional.id is null then
      v_provisional_id := public.append_sellertray_commercial_entitlement_event(
        p_tenant_id,v_plan_code,v_order.id,v_obligation.id,
        'installment.provisional_activated',
        'oa2:provisional:'||v_obligation.id::text,
        v_activation_at,v_provisional_until,
        jsonb_build_object(
          'template_code',v_snapshot.template_code,
          'template_version',v_snapshot.template_version,
          'provisional_months',v_snapshot.provisional_entitlement_months,
          'qualifying_settlement_sequence',v_snapshot.qualifying_settlement_sequence,
          'activation_at',v_activation_at,
          'full_term_until',v_full_until
        ),
        null,
        'Governed OA2 installment provisional entitlement'
      );
    end if;
  elsif not v_fully_settled then
    return public.get_sellertray_installment_billing_state(p_tenant_id,p_installment_obligation_id);
  end if;

  if v_fully_settled then
    if v_existing_full.id is not null then
      v_full_id := v_existing_full.id;
    else
      v_full_id := public.append_sellertray_commercial_entitlement_event(
        p_tenant_id,v_plan_code,v_order.id,v_obligation.id,
        'installment.full_entitlement_released',
        'oa2:full:'||v_obligation.id::text,
        v_activation_at,v_full_until,
        jsonb_build_object(
          'template_code',v_snapshot.template_code,
          'template_version',v_snapshot.template_version,
          'billing_cycle',v_billing_cycle,
          'activation_at',v_activation_at,
          'settled_amount',v_settlement->>'netAmountDue'
        ),
        null,
        'Governed OA2 full-settlement entitlement release'
      );
    end if;
  end if;

  select s.* into strict v_subscription
  from public.tenant_subscriptions s
  where s.tenant_id=p_tenant_id
  for update;

  if v_subscription.current_period_start is not null
     and v_subscription.current_period_end is not null then
    select exists (
      select 1
      from public.sellertray_commercial_entitlement_events e
      where e.tenant_id=p_tenant_id
        and e.commercial_order_id=v_order.id
        and e.effective_from=v_subscription.current_period_start
        and e.effective_until=v_subscription.current_period_end
        and e.event_type in ('installment.provisional_activated','installment.full_entitlement_released')
    ) into v_runtime_owned;
  end if;

  if v_subscription.status<>'trial'
     and not v_runtime_owned
     and (
       v_subscription.current_period_start is not null
       or v_subscription.current_period_end is not null
       or v_subscription.status<>'active'
     ) then
    raise exception 'Existing SellerTray runtime subscription is not owned by this commercial installment order'
      using errcode='23505';
  end if;

  update public.tenant_subscriptions
  set plan_code=v_plan_code,
      status='active',
      current_period_start=v_activation_at,
      current_period_end=case
        when v_full_id is not null then v_full_until
        else v_provisional_until
      end,
      grace_ends_at=null,
      cancel_at_period_end=false,
      updated_at=now()
  where tenant_id=p_tenant_id;

  return public.get_sellertray_installment_billing_state(p_tenant_id,p_installment_obligation_id);
end;
$$;

revoke all on function public.reconcile_sellertray_installment_entitlement(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.reconcile_sellertray_installment_entitlement(uuid,uuid)
  to service_role;

commit;
