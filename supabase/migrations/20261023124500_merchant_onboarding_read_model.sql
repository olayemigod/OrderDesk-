begin;

-- SellerTray OA1 — unified merchant onboarding read authority.
--
-- This migration is deliberately read-only. It projects the approved onboarding
-- lifecycle from the existing Business, Branch, commercial-order, agreement,
-- provider-confirmed payment, Branch setup and entitlement authorities.
-- It does not create a second payment/subscription engine, does not activate a
-- Business, and does not make the OA1 state an operational write gate.
--
-- Existing tenant_subscriptions remains the pre-C2 runtime compatibility bridge.
-- OA4/C2 may later enforce onboarding activation after the merchant estate has
-- been migrated to governed commercial orders.

create or replace function public.get_sellertray_onboarding_state_core(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_tenant public.tenants%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_subscription public.tenant_subscriptions%rowtype;
  v_has_subscription boolean := false;
  v_plan_code text;
  v_billing_cycle text;
  v_active_branch_count integer := 0;
  v_agreement_required boolean := false;
  v_agreement_accepted_at timestamptz;
  v_schedule_count integer := 0;
  v_paid_schedule_count integer := 0;
  v_first_installment_amount numeric(18,2);
  v_first_paid_at timestamptz;
  v_confirmed_payment_amount numeric(18,2) := 0;
  v_approved_adjustment_amount numeric(18,2) := 0;
  v_outstanding_amount numeric(18,2) := 0;
  v_qualifying_settlement boolean := false;
  v_fully_settled boolean := false;
  v_setup_required_count integer := 0;
  v_setup_ready_count integer := 0;
  v_setup_branches jsonb := '[]'::jsonb;
  v_entitlement_state text := 'not_active';
  v_entitlement_effective_from timestamptz;
  v_entitlement_effective_until timestamptz;
  v_runtime_can_write boolean := false;
  v_current_stage text;
  v_blockers jsonb := '[]'::jsonb;
  v_next_action jsonb;
begin
  if p_tenant_id is null then
    raise exception 'Business is required' using errcode='22023';
  end if;

  select t.* into v_tenant
  from public.tenants t
  where t.id=p_tenant_id;
  if not found then
    raise exception 'Business not found' using errcode='P0002';
  end if;

  select count(*)::integer into v_active_branch_count
  from public.branches b
  where b.tenant_id=p_tenant_id and b.is_active;

  -- The current commercial bridge creates only one initial subscription order.
  -- Select the first governed subscription order so later renewal work cannot
  -- silently redefine the merchant's original onboarding lifecycle.
  select o.* into v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id
    and exists (
      select 1
      from public.sellertray_commercial_order_price_snapshots ps
      where ps.tenant_id=o.tenant_id
        and ps.commercial_order_id=o.id
        and ps.line_type='subscription'
    )
  order by o.ordered_at,o.created_at,o.id
  limit 1;

  if v_order.id is not null then
    select ps.plan_code,ps.billing_cycle
      into v_plan_code,v_billing_cycle
    from public.sellertray_commercial_order_price_snapshots ps
    where ps.tenant_id=p_tenant_id
      and ps.commercial_order_id=v_order.id
      and ps.line_type='subscription'
    order by ps.line_no
    limit 1;

    select io.* into v_obligation
    from public.sellertray_commercial_installment_obligations io
    where io.tenant_id=p_tenant_id
      and io.commercial_order_id=v_order.id
    order by io.created_at,io.id
    limit 1;

    if v_obligation.id is not null then
      v_agreement_required := true;

      select ac.accepted_at
        into v_agreement_accepted_at
      from public.sellertray_commercial_agreements a
      join public.sellertray_commercial_agreement_acceptances ac
        on ac.tenant_id=a.tenant_id and ac.agreement_id=a.id
      where a.tenant_id=p_tenant_id
        and a.commercial_order_id=v_order.id
        and a.installment_obligation_id=v_obligation.id
        and a.agreement_family='installment_agreement'
        and not exists (
          select 1
          from public.sellertray_commercial_agreements replacement
          where replacement.tenant_id=a.tenant_id
            and replacement.supersedes_agreement_id=a.id
        )
      order by ac.accepted_at desc
      limit 1;

      select
        count(*)::integer,
        count(distinct pc.installment_schedule_id)::integer,
        coalesce(sum(pc.amount),0)::numeric(18,2),
        max(sch.amount_due) filter (where sch.sequence_no=1),
        max(pc.paid_at) filter (where sch.sequence_no=1)
      into
        v_schedule_count,
        v_paid_schedule_count,
        v_confirmed_payment_amount,
        v_first_installment_amount,
        v_first_paid_at
      from public.sellertray_commercial_installment_schedule sch
      left join public.sellertray_commercial_installment_payment_confirmations pc
        on pc.tenant_id=sch.tenant_id
       and pc.installment_schedule_id=sch.id
      where sch.tenant_id=p_tenant_id
        and sch.installment_obligation_id=v_obligation.id;

      -- C1B's approved installment activation condition is qualifying first
      -- settlement, not full settlement of every later installment.
      v_qualifying_settlement := v_first_paid_at is not null;
    end if;

    v_outstanding_amount := greatest(
      round((v_order.total_gross_amount-v_approved_adjustment_amount-v_confirmed_payment_amount)::numeric,2),
      0::numeric
    );
    v_fully_settled := v_outstanding_amount < 0.005;

    -- A future non-installment first-purchase path may have no installment
    -- obligation. Until its governed confirmation authority lands, only a fully
    -- confirmed zero balance may qualify it as settled.
    if v_obligation.id is null then
      v_qualifying_settlement := v_fully_settled;
    end if;

    select
      count(*)::integer,
      count(r.id)::integer,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'branchId',ps.branch_id,
            'branchCode',b.code,
            'branchName',b.name,
            'ready',r.id is not null,
            'readyAt',r.ready_at
          )
          order by ps.line_no
        ),
        '[]'::jsonb
      )
    into v_setup_required_count,v_setup_ready_count,v_setup_branches
    from public.sellertray_commercial_order_price_snapshots ps
    join public.branches b
      on b.tenant_id=ps.tenant_id and b.id=ps.branch_id
    left join public.sellertray_commercial_branch_setup_readiness r
      on r.tenant_id=ps.tenant_id
     and r.commercial_order_id=ps.commercial_order_id
     and r.branch_id=ps.branch_id
    where ps.tenant_id=p_tenant_id
      and ps.commercial_order_id=v_order.id
      and ps.line_type='branch_setup';

    select
      case e.event_type
        when 'installment.full_entitlement_released' then 'full'
        when 'installment.provisional_activated' then 'provisional'
        else 'not_active'
      end,
      e.effective_from,
      e.effective_until
    into v_entitlement_state,v_entitlement_effective_from,v_entitlement_effective_until
    from public.sellertray_commercial_entitlement_events e
    where e.tenant_id=p_tenant_id
      and e.commercial_order_id=v_order.id
      and e.event_type in (
        'installment.provisional_activated',
        'installment.full_entitlement_released'
      )
    order by
      case e.event_type when 'installment.full_entitlement_released' then 0 else 1 end,
      e.recorded_at desc
    limit 1;

    if not found then
      v_entitlement_state := 'not_active';
      v_entitlement_effective_from := null;
      v_entitlement_effective_until := null;
    end if;
  end if;

  select s.* into v_subscription
  from public.tenant_subscriptions s
  where s.tenant_id=p_tenant_id;
  v_has_subscription := found;

  if v_has_subscription then
    v_runtime_can_write := public.orderdesk_subscription_can_write(p_tenant_id);
  end if;

  -- User-facing stage order follows ONBOARDING_ACTIVATION.md, while the
  -- entitlement event remains authoritative evidence that onboarding activation
  -- already happened. OA1 deliberately does not use this projection to gate Sell.
  if v_entitlement_state in ('provisional','full') then
    v_current_stage := 'active';
    if v_runtime_can_write then
      v_next_action := jsonb_build_object(
        'code','start_selling',
        'label','Continue selling',
        'surface','mobile'
      );
    else
      v_blockers := jsonb_build_array(jsonb_build_object(
        'code','subscription_attention_required',
        'message','The governed onboarding activation exists, but runtime subscription access needs attention.',
        'surface','merchant_web'
      ));
      v_next_action := jsonb_build_object(
        'code','resolve_subscription',
        'label','Review subscription access',
        'surface','merchant_web'
      );
    end if;
  elsif v_order.id is null and v_active_branch_count=0 then
    v_current_stage := 'business_setup';
    v_blockers := jsonb_build_array(jsonb_build_object(
      'code','active_branch_required',
      'message','Prepare at least one active Branch before creating the commercial purchase.',
      'surface','mobile'
    ));
    v_next_action := jsonb_build_object(
      'code','prepare_branch',
      'label','Prepare a Branch',
      'surface','mobile'
    );
  elsif v_order.id is null then
    v_current_stage := 'commercial_order';
    v_blockers := jsonb_build_array(jsonb_build_object(
      'code','commercial_order_required',
      'message','Choose the SellerTray plan and Branch setup scope for this Business.',
      'surface','merchant_web'
    ));
    v_next_action := jsonb_build_object(
      'code','select_plan',
      'label','Choose plan and purchase',
      'surface','merchant_web'
    );
  elsif v_agreement_required and v_agreement_accepted_at is null then
    v_current_stage := 'agreement';
    v_blockers := jsonb_build_array(jsonb_build_object(
      'code','agreement_acceptance_required',
      'message','The current commercial agreement must be accepted before activation can proceed.',
      'surface','merchant_web'
    ));
    v_next_action := jsonb_build_object(
      'code','review_agreement',
      'label','Review and accept agreement',
      'surface','merchant_web'
    );
  elsif not v_qualifying_settlement then
    v_current_stage := 'settlement';
    v_blockers := jsonb_build_array(jsonb_build_object(
      'code','qualifying_settlement_required',
      'message','A qualifying confirmed payment is required before Branch setup can complete activation.',
      'surface','merchant_web'
    ));
    v_next_action := jsonb_build_object(
      'code','pay_outstanding',
      'label','Complete required payment',
      'surface','merchant_web'
    );
  elsif v_setup_required_count=0 then
    v_current_stage := 'setup';
    v_blockers := jsonb_build_array(jsonb_build_object(
      'code','branch_setup_scope_required',
      'message','The commercial purchase does not yet contain a governed Branch setup scope.',
      'surface','admin_web'
    ));
    v_next_action := jsonb_build_object(
      'code','resolve_setup_scope',
      'label','Resolve Branch setup scope',
      'surface','admin_web'
    );
  elsif v_setup_ready_count<v_setup_required_count then
    v_current_stage := 'setup';
    v_blockers := jsonb_build_array(jsonb_build_object(
      'code','branch_setup_incomplete',
      'message',format('%s of %s required Branch setups are complete.',v_setup_ready_count,v_setup_required_count),
      'surface','mobile'
    ));
    v_next_action := jsonb_build_object(
      'code','prepare_branches',
      'label','Prepare Branch setup',
      'surface','mobile'
    );
  else
    v_current_stage := 'activation';
    v_blockers := jsonb_build_array(jsonb_build_object(
      'code','activation_reconciliation_pending',
      'message','Commercial terms, settlement and Branch setup are ready. Activation reconciliation is pending.',
      'surface','shared_core'
    ));
    v_next_action := jsonb_build_object(
      'code','await_activation_reconciliation',
      'label','Await automatic activation',
      'surface','shared_core'
    );
  end if;

  return jsonb_build_object(
    'readModelVersion','oa1-v1',
    'generatedAt',now(),
    'tenantId',p_tenant_id,
    'currentStage',v_current_stage,
    'blockers',v_blockers,
    'nextAction',v_next_action,
    'accessEnforcement','informational_only_until_oa4',
    'branchPreparation',jsonb_build_object(
      'activeBranchCount',v_active_branch_count,
      'readyForCommercialOrder',v_active_branch_count>0
    ),
    'commercialOrder',case when v_order.id is null then null else jsonb_build_object(
      'id',v_order.id,
      'reference',v_order.order_reference,
      'currency',v_order.currency,
      'grossAmount',v_order.total_gross_amount,
      'orderedAt',v_order.ordered_at,
      'planCode',v_plan_code,
      'billingCycle',v_billing_cycle,
      'installmentObligationId',v_obligation.id,
      'installmentStructureCode',v_obligation.structure_code
    ) end,
    'agreement',jsonb_build_object(
      'required',v_agreement_required,
      'accepted',not v_agreement_required or v_agreement_accepted_at is not null,
      'acceptedAt',v_agreement_accepted_at
    ),
    'settlement',jsonb_build_object(
      'currency',coalesce(v_order.currency,v_tenant.currency),
      'grossAmount',coalesce(v_order.total_gross_amount,0),
      'approvedAdjustmentAmount',v_approved_adjustment_amount,
      'gatewayPaymentAmount',v_confirmed_payment_amount,
      'directPaymentAmount',0,
      'confirmedPaymentAmount',v_confirmed_payment_amount,
      'outstandingAmount',v_outstanding_amount,
      'qualifyingSettlementSatisfied',v_qualifying_settlement,
      'fullySettled',v_fully_settled,
      'installmentCount',v_schedule_count,
      'paidInstallmentCount',v_paid_schedule_count,
      'firstInstallmentAmount',v_first_installment_amount,
      'firstPaidAt',v_first_paid_at
    ),
    'branchSetup',jsonb_build_object(
      'requiredCount',v_setup_required_count,
      'readyCount',v_setup_ready_count,
      'ready',v_setup_required_count>0 and v_setup_ready_count=v_setup_required_count,
      'branches',v_setup_branches
    ),
    'activation',jsonb_build_object(
      'entitlementState',v_entitlement_state,
      'effectiveFrom',v_entitlement_effective_from,
      'effectiveUntil',v_entitlement_effective_until,
      'operationallyActive',v_entitlement_state in ('provisional','full') and v_runtime_can_write
    ),
    'legacyRuntime',jsonb_build_object(
      'status',case when v_has_subscription then v_subscription.status else null end,
      'canWrite',v_runtime_can_write,
      'compatibilityAccess',v_runtime_can_write and v_entitlement_state='not_active'
    )
  );
end;
$$;

revoke all on function public.get_sellertray_onboarding_state_core(uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_onboarding_state_core(uuid)
  to service_role;

create or replace function public.get_sellertray_onboarding_state(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
  v_state jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  if v_role not in ('owner','manager') then
    raise exception 'Onboarding commercial status requires an Owner or Manager' using errcode='42501';
  end if;

  v_state := public.get_sellertray_onboarding_state_core(p_tenant_id);
  return v_state || jsonb_build_object(
    'viewer',jsonb_build_object('kind','merchant','role',v_role)
  );
end;
$$;

revoke all on function public.get_sellertray_onboarding_state(uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_onboarding_state(uuid)
  to authenticated;

create or replace function public.get_sellertray_onboarding_state_admin(
  p_actor_user_id uuid,
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_role text;
  v_state jsonb;
begin
  if p_actor_user_id is null then
    raise exception 'Platform administrator is required' using errcode='22023';
  end if;

  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if v_role not in ('admin','support') then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;

  v_state := public.get_sellertray_onboarding_state_core(p_tenant_id);
  return v_state || jsonb_build_object(
    'viewer',jsonb_build_object('kind','platform','role',v_role)
  );
end;
$$;

revoke all on function public.get_sellertray_onboarding_state_admin(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_onboarding_state_admin(uuid,uuid)
  to service_role;

comment on function public.get_sellertray_onboarding_state_core(uuid) is
  'OA1 shared SellerTray onboarding projection. Read-only and not an operational access gate.';
comment on function public.get_sellertray_onboarding_state(uuid) is
  'Owner/Manager SellerTray onboarding read model derived from shared governed authorities.';
comment on function public.get_sellertray_onboarding_state_admin(uuid,uuid) is
  'ProcessEdge Admin/Support read wrapper over the shared SellerTray onboarding projection.';

commit;
