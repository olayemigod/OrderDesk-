begin;
-- Forward deployment convergence for a live pre-OA1 database whose ledger has
-- advanced beyond the original onboarding migration versions. Replay the exact
-- governed foundations, then restore the final OA4 authorities. Never backdate
-- the live ledger or change existing commercial/equipment/entitlement history.
-- A clean replay already has OA2 tables and therefore skips their CREATE TABLE
-- foundation. A partially present OA2 foundation fails closed for inspection.

-- Source: 20261022064000_platform_admin_bounded_bootstrap.sql
create or replace function public.platform_admin_bootstrap(p_actor_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if v_role is null then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;

  return jsonb_build_object(
    'actorRole',v_role,
    'generatedAt',now(),
    'merchantCount',(select count(*)::integer from public.tenants),
    'legacyTrialRecords',(
      select count(*)::integer
      from public.tenants t
      left join public.tenant_subscriptions s on s.tenant_id=t.id
      where coalesce(s.status,t.subscription_status)='trial'
    )
  );
end;
$$;

create or replace function public.platform_admin_operations_summary(p_actor_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_result jsonb;
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if v_role is null then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;

  with tenant_periods as materialized (
    select
      t.id,
      t.whatsapp_connection_status,
      coalesce(p.usage_event_code,'AI_ORDER_ACTIVITY') usage_event_code,
      coalesce(s.current_period_start,s.trial_started_at,date_trunc('month',now())) period_start,
      coalesce(s.current_period_end,s.trial_ends_at,date_trunc('month',now())+interval '1 month') period_end
    from public.tenants t
    left join public.tenant_subscriptions s on s.tenant_id=t.id
    left join public.subscription_plans p on p.code=s.plan_code
  ), ai as materialized (
    select
      count(*)::integer attempts,
      count(*) filter(where a.outcome='success')::integer successes,
      count(*) filter(where a.outcome<>'success')::integer non_success,
      count(distinct a.tenant_id)::integer tenants_with_attempts,
      coalesce(sum(a.input_tokens),0)::bigint input_tokens,
      coalesce(sum(a.cached_input_tokens),0)::bigint cached_input_tokens,
      coalesce(sum(a.output_tokens),0)::bigint output_tokens,
      coalesce(sum(a.reasoning_tokens),0)::bigint reasoning_tokens,
      coalesce(sum(a.total_tokens),0)::bigint total_tokens,
      coalesce(max(a.catalogue_items_total),0)::integer catalogue_total_max,
      coalesce(round(sum(coalesce(a.catalogue_items_sent,0))::numeric/nullif(count(*),0),1),0) catalogue_sent_avg,
      coalesce(round(sum(coalesce(a.catalogue_aliases_sent,0))::numeric/nullif(count(*),0),1),0) catalogue_aliases_avg,
      (array_agg(a.model order by a.created_at desc) filter(where a.model is not null))[1] latest_model
    from public.ai_parser_attempts a
    join tenant_periods tp on tp.id=a.tenant_id
    where a.created_at>=tp.period_start and a.created_at<tp.period_end
  ), usage as materialized (
    select coalesce(sum(u.quantity),0)::integer metered_external_order_units
    from public.usage_events u
    join tenant_periods tp on tp.id=u.tenant_id
    where u.event_code=tp.usage_event_code
      and u.occurred_at>=tp.period_start and u.occurred_at<tp.period_end
  )
  select jsonb_build_object(
    'actorRole',v_role,
    'generatedAt',now(),
    'merchantCount',(select count(*)::integer from tenant_periods),
    'whatsapp',jsonb_build_object(
      'connected',(select count(*) filter(where whatsapp_connection_status='connected')::integer from tenant_periods),
      'errors',(select count(*) filter(where whatsapp_connection_status='error')::integer from tenant_periods),
      'pending',(select count(*) filter(where whatsapp_connection_status='pending')::integer from tenant_periods),
      'notConnected',(select count(*) filter(where whatsapp_connection_status='not_connected')::integer from tenant_periods)
    ),
    'ai',jsonb_build_object(
      'tenantsWithAttempts',ai.tenants_with_attempts,
      'attempts',ai.attempts,
      'successes',ai.successes,
      'nonSuccess',ai.non_success,
      'inputTokens',ai.input_tokens,
      'cachedInputTokens',ai.cached_input_tokens,
      'outputTokens',ai.output_tokens,
      'reasoningTokens',ai.reasoning_tokens,
      'totalTokens',ai.total_tokens,
      'meteredExternalOrderUnits',usage.metered_external_order_units,
      'catalogueItemsTotalMax',ai.catalogue_total_max,
      'catalogueItemsSentAvg',ai.catalogue_sent_avg,
      'catalogueAliasesSentAvg',ai.catalogue_aliases_avg,
      'latestObservedModel',ai.latest_model
    )
  ) into v_result
  from ai cross join usage;

  return v_result;
end;
$$;

revoke all on function public.platform_admin_bootstrap(uuid) from public,anon,authenticated;
revoke all on function public.platform_admin_operations_summary(uuid) from public,anon,authenticated;
grant execute on function public.platform_admin_bootstrap(uuid) to service_role;
grant execute on function public.platform_admin_operations_summary(uuid) to service_role;

-- Source: 20261022092900_sellertray_installment_agreement_acceptance_fact.sql
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

-- Source: 20261023124500_merchant_onboarding_read_model.sql
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

  if v_role is null or v_role not in ('owner','manager') then
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

  if v_role is null or v_role not in ('admin','support') then
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

do $oa4_foundation$
begin
  if to_regclass('public.sellertray_installment_schedule_templates') is null and to_regclass('public.platform_admin_capability_grant_versions') is null then
    -- Source: 20261023160000_oa2_flexible_commercial_settlement.sql
    execute $oa4_source_0$
-- SellerTray OA2 Flexible Commercial Settlement Authority
--
-- Forward-only convergence layer. Existing orders, accepted agreements,
-- installment obligations/schedules, provider confirmations and entitlement
-- history remain immutable. OA2 adds versioned installment policy/templates,
-- immutable contract snapshots, audited commercial credits and one settlement
-- projection shared by Admin, Merchant Web, Mobile status, WhatsApp and AI.

-- ---------------------------------------------------------------------------
-- 1. Versioned installment schedule templates
-- ---------------------------------------------------------------------------

create table public.sellertray_installment_schedule_templates (
  id uuid primary key default gen_random_uuid(),
  template_code text not null,
  version integer not null,
  display_name text not null,
  status text not null default 'published',
  provisional_entitlement_months integer not null default 0,
  qualifying_settlement_sequence integer not null default 1,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_by_user_id uuid references auth.users(id) on delete restrict,
  change_reason text not null,
  created_at timestamptz not null default now(),
  unique (template_code,version),
  constraint sellertray_installment_templates_code_check
    check (template_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint sellertray_installment_templates_version_check check (version > 0),
  constraint sellertray_installment_templates_name_check
    check (char_length(btrim(display_name)) between 1 and 120),
  constraint sellertray_installment_templates_status_check
    check (status in ('published','retired')),
  constraint sellertray_installment_templates_provisional_check
    check (provisional_entitlement_months between 0 and 120),
  constraint sellertray_installment_templates_qualifying_check
    check (qualifying_settlement_sequence > 0),
  constraint sellertray_installment_templates_reason_check
    check (char_length(btrim(change_reason)) between 1 and 1000),
  constraint sellertray_installment_templates_effective_check
    check (effective_until is null or effective_until > effective_from)
);

create table public.sellertray_installment_schedule_template_lines (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.sellertray_installment_schedule_templates(id) on delete restrict,
  sequence_no integer not null,
  percentage numeric(9,6),
  fixed_amount numeric(18,2),
  due_offset_days integer,
  created_at timestamptz not null default now(),
  unique (template_id,sequence_no),
  constraint sellertray_installment_template_lines_sequence_check check (sequence_no > 0),
  constraint sellertray_installment_template_lines_allocation_check
    check (
      (percentage is not null and percentage > 0 and percentage <= 100 and fixed_amount is null)
      or
      (fixed_amount is not null and fixed_amount > 0 and percentage is null)
    ),
  constraint sellertray_installment_template_lines_due_check
    check (due_offset_days is null or due_offset_days >= 0)
);

create index sellertray_installment_templates_effective_idx
  on public.sellertray_installment_schedule_templates(template_code,status,effective_from desc);

create or replace function public.validate_sellertray_installment_schedule_template()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_template_id uuid;
  v_count integer;
  v_percent_count integer;
  v_fixed_count integer;
  v_percent numeric;
  v_qualifying integer;
begin
  if tg_table_name='sellertray_installment_schedule_templates' then
    v_template_id := new.id;
  else
    v_template_id := new.template_id;
  end if;

  select count(*)::integer,
         count(*) filter (where l.percentage is not null)::integer,
         count(*) filter (where l.fixed_amount is not null)::integer,
         coalesce(sum(l.percentage),0)
    into v_count,v_percent_count,v_fixed_count,v_percent
  from public.sellertray_installment_schedule_template_lines l
  where l.template_id=v_template_id;

  select t.qualifying_settlement_sequence
    into v_qualifying
  from public.sellertray_installment_schedule_templates t
  where t.id=v_template_id;

  if v_qualifying is null then
    return new;
  end if;
  if v_count=0 then
    raise exception 'SellerTray installment template requires at least one line' using errcode='23514';
  end if;
  if v_percent_count not in (0,v_count) or v_fixed_count not in (0,v_count) then
    raise exception 'SellerTray installment template cannot mix percentage and fixed allocation lines' using errcode='23514';
  end if;
  if v_percent_count=v_count and abs(v_percent-100) >= 0.000001 then
    raise exception 'SellerTray percentage installment template must total 100 percent' using errcode='23514';
  end if;
  if v_qualifying > v_count then
    raise exception 'SellerTray qualifying settlement sequence exceeds template line count' using errcode='23514';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_sellertray_installment_schedule_template()
  from public,anon,authenticated;

create constraint trigger validate_sellertray_installment_template_header
after insert on public.sellertray_installment_schedule_templates
deferrable initially deferred
for each row execute function public.validate_sellertray_installment_schedule_template();

create constraint trigger validate_sellertray_installment_template_line
after insert on public.sellertray_installment_schedule_template_lines
deferrable initially deferred
for each row execute function public.validate_sellertray_installment_schedule_template();

create trigger prevent_sellertray_installment_template_mutation
before update or delete on public.sellertray_installment_schedule_templates
for each row execute function public.prevent_sellertray_commercial_history_mutation();

create trigger prevent_sellertray_installment_template_line_mutation
before update or delete on public.sellertray_installment_schedule_template_lines
for each row execute function public.prevent_sellertray_commercial_history_mutation();

insert into public.sellertray_installment_schedule_templates (
  template_code,version,display_name,status,provisional_entitlement_months,
  qualifying_settlement_sequence,effective_from,change_reason
) values
  ('two_installment_70_30',1,'70 / 30','published',2,1,'2026-10-21 00:00:00+00','System seed from approved C1B 70:30 structure'),
  ('three_installment_60_20_20',1,'60 / 20 / 20','published',3,1,'2026-10-21 00:00:00+00','System seed from approved C1B 60:20:20 structure');

insert into public.sellertray_installment_schedule_template_lines(template_id,sequence_no,percentage)
select t.id,x.sequence_no,x.percentage
from public.sellertray_installment_schedule_templates t
join lateral (
  values
    ('two_installment_70_30'::text,1,70::numeric),
    ('two_installment_70_30',2,30),
    ('three_installment_60_20_20',1,60),
    ('three_installment_60_20_20',2,20),
    ('three_installment_60_20_20',3,20)
) x(template_code,sequence_no,percentage) on x.template_code=t.template_code
where t.version=1;

-- Flush the deferred seed validation before later ALTER TABLE statements.
-- PostgreSQL rejects ALTER TABLE while deferred trigger events are pending.
set constraints validate_sellertray_installment_template_header,
                validate_sellertray_installment_template_line immediate;

-- ---------------------------------------------------------------------------
-- 2. Effective-dated installment availability policy
-- ---------------------------------------------------------------------------

create table public.sellertray_installment_policy_versions (
  id uuid primary key default gen_random_uuid(),
  scope_kind text not null,
  tenant_id uuid references public.tenants(id) on delete restrict,
  commercial_order_id uuid,
  plan_code text references public.subscription_plans(code) on delete restrict,
  billing_cycle text,
  enabled boolean not null,
  default_template_id uuid references public.sellertray_installment_schedule_templates(id) on delete restrict,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_by_user_id uuid references auth.users(id) on delete restrict,
  change_reason text not null,
  created_at timestamptz not null default now(),
  constraint sellertray_installment_policy_order_same_tenant
    foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id)
    on delete restrict,
  constraint sellertray_installment_policy_scope_kind_check
    check (scope_kind in ('platform','plan_cycle','tenant','commercial_order')),
  constraint sellertray_installment_policy_cycle_check
    check (billing_cycle is null or billing_cycle in ('monthly','yearly')),
  constraint sellertray_installment_policy_reason_check
    check (char_length(btrim(change_reason)) between 1 and 1000),
  constraint sellertray_installment_policy_effective_check
    check (effective_until is null or effective_until > effective_from),
  constraint sellertray_installment_policy_scope_shape_check
    check (
      (scope_kind='platform' and tenant_id is null and commercial_order_id is null and plan_code is null and billing_cycle is not null)
      or
      (scope_kind='plan_cycle' and tenant_id is null and commercial_order_id is null and plan_code is not null and billing_cycle is not null)
      or
      (scope_kind='tenant' and tenant_id is not null and commercial_order_id is null and plan_code is null and billing_cycle is not null)
      or
      (scope_kind='commercial_order' and tenant_id is not null and commercial_order_id is not null and plan_code is null and billing_cycle is null)
    ),
  constraint sellertray_installment_policy_template_check
    check ((enabled and default_template_id is not null) or not enabled)
);

create index sellertray_installment_policy_resolution_idx
  on public.sellertray_installment_policy_versions(scope_kind,billing_cycle,effective_from desc);
create index sellertray_installment_policy_tenant_idx
  on public.sellertray_installment_policy_versions(tenant_id,effective_from desc)
  where tenant_id is not null;
create index sellertray_installment_policy_order_idx
  on public.sellertray_installment_policy_versions(commercial_order_id,effective_from desc)
  where commercial_order_id is not null;

create trigger prevent_sellertray_installment_policy_mutation
before update or delete on public.sellertray_installment_policy_versions
for each row execute function public.prevent_sellertray_commercial_history_mutation();

insert into public.sellertray_installment_policy_versions (
  scope_kind,billing_cycle,enabled,default_template_id,effective_from,change_reason
)
select 'platform','yearly',true,t.id,'2026-10-21 00:00:00+00','System seed preserving pre-OA2 yearly installment availability'
from public.sellertray_installment_schedule_templates t
where t.template_code='two_installment_70_30' and t.version=1;

insert into public.sellertray_installment_policy_versions (
  scope_kind,billing_cycle,enabled,default_template_id,effective_from,change_reason
) values (
  'platform','monthly',false,null,'2026-10-21 00:00:00+00','System seed: monthly installments disabled unless explicitly governed on'
);

create or replace function public.resolve_sellertray_installment_policy(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_plan_code text,
  p_billing_cycle text,
  p_as_of timestamptz default now()
)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  with candidates as (
    select p.*,
      case p.scope_kind
        when 'commercial_order' then 400
        when 'tenant' then 300
        when 'plan_cycle' then 200
        else 100
      end as precedence
    from public.sellertray_installment_policy_versions p
    where p.effective_from <= p_as_of
      and (p.effective_until is null or p.effective_until > p_as_of)
      and (
        (p.scope_kind='commercial_order' and p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id)
        or (p.scope_kind='tenant' and p.tenant_id=p_tenant_id and p.billing_cycle=p_billing_cycle)
        or (p.scope_kind='plan_cycle' and p.plan_code=p_plan_code and p.billing_cycle=p_billing_cycle)
        or (p.scope_kind='platform' and p.billing_cycle=p_billing_cycle)
      )
  )
  select jsonb_build_object(
    'policyVersionId',c.id,
    'scopeKind',c.scope_kind,
    'enabled',c.enabled,
    'defaultTemplateId',c.default_template_id,
    'effectiveFrom',c.effective_from,
    'effectiveUntil',c.effective_until
  )
  from candidates c
  order by c.precedence desc,c.effective_from desc,c.created_at desc
  limit 1;
$$;

revoke all on function public.resolve_sellertray_installment_policy(uuid,uuid,text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.resolve_sellertray_installment_policy(uuid,uuid,text,text,timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Immutable obligation contract snapshots
-- ---------------------------------------------------------------------------

alter table public.sellertray_commercial_installment_obligations
  drop constraint if exists sellertray_commercial_installment_obligations_structure_check;
alter table public.sellertray_commercial_installment_obligations
  add constraint sellertray_commercial_installment_obligations_structure_check
  check (structure_code ~ '^[a-z][a-z0-9_]{1,63}$');

create table public.sellertray_installment_contract_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  commercial_order_id uuid not null,
  installment_obligation_id uuid not null,
  policy_version_id uuid references public.sellertray_installment_policy_versions(id) on delete restrict,
  template_id uuid not null references public.sellertray_installment_schedule_templates(id) on delete restrict,
  template_code text not null,
  template_version integer not null,
  provisional_entitlement_months integer not null,
  qualifying_settlement_sequence integer not null,
  snapshotted_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (installment_obligation_id),
  constraint sellertray_installment_contract_order_same_tenant
    foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id) on delete restrict,
  constraint sellertray_installment_contract_obligation_same_tenant
    foreign key (tenant_id,installment_obligation_id)
    references public.sellertray_commercial_installment_obligations(tenant_id,id) on delete restrict,
  constraint sellertray_installment_contract_template_code_check
    check (template_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint sellertray_installment_contract_template_version_check check (template_version > 0),
  constraint sellertray_installment_contract_provisional_check
    check (provisional_entitlement_months between 0 and 120),
  constraint sellertray_installment_contract_qualifying_check
    check (qualifying_settlement_sequence > 0)
);

create trigger prevent_sellertray_installment_contract_snapshot_mutation
before update or delete on public.sellertray_installment_contract_snapshots
for each row execute function public.prevent_sellertray_commercial_history_mutation();

insert into public.sellertray_installment_contract_snapshots (
  tenant_id,commercial_order_id,installment_obligation_id,policy_version_id,
  template_id,template_code,template_version,provisional_entitlement_months,
  qualifying_settlement_sequence,snapshotted_at
)
select o.tenant_id,o.commercial_order_id,o.id,
       case when p.enabled then p.id else null end,
       t.id,t.template_code,t.version,t.provisional_entitlement_months,
       t.qualifying_settlement_sequence,o.created_at
from public.sellertray_commercial_installment_obligations o
join public.sellertray_commercial_order_price_snapshots s
  on s.tenant_id=o.tenant_id
 and s.commercial_order_id=o.commercial_order_id
 and s.line_type='subscription'
join public.sellertray_installment_schedule_templates t
  on t.template_code=o.structure_code and t.version=1
left join lateral (
  select pv.*
  from public.sellertray_installment_policy_versions pv
  where pv.scope_kind='platform'
    and pv.billing_cycle=s.billing_cycle
    and pv.effective_from <= o.created_at
    and (pv.effective_until is null or pv.effective_until > o.created_at)
  order by pv.effective_from desc,pv.created_at desc
  limit 1
) p on true
on conflict (installment_obligation_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Immutable commercial adjustments and direct payments
-- ---------------------------------------------------------------------------

create table public.sellertray_commercial_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  commercial_order_id uuid not null,
  command_id uuid not null,
  adjustment_type text not null default 'discount',
  amount numeric(18,2) not null,
  currency text not null,
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,command_id),
  constraint sellertray_commercial_adjustments_order_same_tenant
    foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id) on delete restrict,
  constraint sellertray_commercial_adjustments_type_check check (adjustment_type='discount'),
  constraint sellertray_commercial_adjustments_amount_check check (amount > 0),
  constraint sellertray_commercial_adjustments_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint sellertray_commercial_adjustments_reason_check
    check (char_length(btrim(reason)) between 1 and 1000),
  constraint sellertray_commercial_adjustments_evidence_check check (jsonb_typeof(evidence)='object'),
  constraint sellertray_commercial_adjustments_time_check
    check (approved_at <= recorded_at + interval '5 minutes')
);

create table public.sellertray_commercial_direct_payment_confirmations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  commercial_order_id uuid not null,
  command_id uuid not null,
  payment_reference text not null,
  payment_method text not null,
  amount numeric(18,2) not null,
  currency text not null,
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  paid_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,command_id),
  unique (tenant_id,payment_reference),
  constraint sellertray_commercial_direct_payments_order_same_tenant
    foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id) on delete restrict,
  constraint sellertray_commercial_direct_payments_reference_check
    check (char_length(btrim(payment_reference)) between 1 and 160),
  constraint sellertray_commercial_direct_payments_method_check
    check (payment_method ~ '^[a-z][a-z0-9_-]{0,31}$'),
  constraint sellertray_commercial_direct_payments_amount_check check (amount > 0),
  constraint sellertray_commercial_direct_payments_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint sellertray_commercial_direct_payments_reason_check
    check (char_length(btrim(reason)) between 1 and 1000),
  constraint sellertray_commercial_direct_payments_evidence_check check (jsonb_typeof(evidence)='object'),
  constraint sellertray_commercial_direct_payments_time_check
    check (paid_at <= recorded_at + interval '5 minutes')
);

create index sellertray_commercial_adjustments_order_idx
  on public.sellertray_commercial_adjustments(tenant_id,commercial_order_id,approved_at);
create index sellertray_commercial_direct_payments_order_idx
  on public.sellertray_commercial_direct_payment_confirmations(tenant_id,commercial_order_id,paid_at);

create trigger prevent_sellertray_commercial_adjustment_mutation
before update or delete on public.sellertray_commercial_adjustments
for each row execute function public.prevent_sellertray_commercial_history_mutation();
create trigger prevent_sellertray_commercial_direct_payment_mutation
before update or delete on public.sellertray_commercial_direct_payment_confirmations
for each row execute function public.prevent_sellertray_commercial_history_mutation();

create or replace function public.prepare_sellertray_commercial_credit_fact()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_adjustments numeric(18,2);
  v_gateway numeric(18,2);
  v_direct numeric(18,2);
begin
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=new.tenant_id and o.id=new.commercial_order_id;

  new.currency := v_order.currency;
  new.reason := btrim(new.reason);

  select coalesce(sum(a.amount),0)::numeric(18,2) into v_adjustments
  from public.sellertray_commercial_adjustments a
  where a.tenant_id=new.tenant_id and a.commercial_order_id=new.commercial_order_id;

  select coalesce(sum(p.amount),0)::numeric(18,2) into v_gateway
  from public.sellertray_commercial_installment_payment_confirmations p
  where p.tenant_id=new.tenant_id and p.commercial_order_id=new.commercial_order_id;

  select coalesce(sum(p.amount),0)::numeric(18,2) into v_direct
  from public.sellertray_commercial_direct_payment_confirmations p
  where p.tenant_id=new.tenant_id and p.commercial_order_id=new.commercial_order_id;

  if v_adjustments+v_gateway+v_direct+new.amount > v_order.total_gross_amount + 0.004 then
    raise exception 'Commercial credits cannot exceed immutable order gross' using errcode='23514';
  end if;
  return new;
end;
$$;

revoke all on function public.prepare_sellertray_commercial_credit_fact()
  from public,anon,authenticated;
create trigger prepare_sellertray_commercial_adjustment
before insert on public.sellertray_commercial_adjustments
for each row execute function public.prepare_sellertray_commercial_credit_fact();
create trigger prepare_sellertray_commercial_direct_payment
before insert on public.sellertray_commercial_direct_payment_confirmations
for each row execute function public.prepare_sellertray_commercial_credit_fact();

-- ---------------------------------------------------------------------------
-- 5. Authoritative settlement projection and deterministic allocation
-- ---------------------------------------------------------------------------

create or replace function public.get_sellertray_commercial_settlement_state(
  p_tenant_id uuid,
  p_commercial_order_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_adjustments numeric(18,2) := 0;
  v_gateway numeric(18,2) := 0;
  v_direct numeric(18,2) := 0;
  v_net_due numeric(18,2) := 0;
  v_total_paid numeric(18,2) := 0;
  v_outstanding numeric(18,2) := 0;
  v_credit numeric(18,2) := 0;
  v_schedule jsonb := '[]'::jsonb;
  v_next_schedule_id uuid;
  v_next_payable numeric(18,2);
  v_status text;
begin
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id;

  select coalesce(sum(a.amount),0)::numeric(18,2) into v_adjustments
  from public.sellertray_commercial_adjustments a
  where a.tenant_id=p_tenant_id and a.commercial_order_id=p_commercial_order_id;

  select coalesce(sum(p.amount),0)::numeric(18,2) into v_gateway
  from public.sellertray_commercial_installment_payment_confirmations p
  where p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id;

  select coalesce(sum(p.amount),0)::numeric(18,2) into v_direct
  from public.sellertray_commercial_direct_payment_confirmations p
  where p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id;

  v_net_due := greatest(v_order.total_gross_amount-v_adjustments,0)::numeric(18,2);
  v_total_paid := (v_gateway+v_direct)::numeric(18,2);
  v_outstanding := greatest(v_net_due-v_total_paid,0)::numeric(18,2);
  v_credit := least(v_adjustments+v_total_paid,v_order.total_gross_amount)::numeric(18,2);

  select o.* into v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.commercial_order_id=p_commercial_order_id;

  if found then
    with lines as (
      select s.id,s.sequence_no,s.percentage,s.amount_due,s.due_at,
             coalesce(sum(s.amount_due) over (
               order by s.sequence_no
               rows between unbounded preceding and 1 preceding
             ),0)::numeric(18,2) as prior_due
      from public.sellertray_commercial_installment_schedule s
      where s.tenant_id=p_tenant_id
        and s.installment_obligation_id=v_obligation.id
    ), allocated as (
      select l.*,
             least(l.amount_due,greatest(v_credit-l.prior_due,0))::numeric(18,2) as settled_amount,
             greatest(l.amount_due-least(l.amount_due,greatest(v_credit-l.prior_due,0)),0)::numeric(18,2) as remaining_amount
      from lines l
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'scheduleId',a.id,
             'sequenceNo',a.sequence_no,
             'percentage',a.percentage,
             'amountDue',a.amount_due,
             'settledAmount',a.settled_amount,
             'remainingAmount',a.remaining_amount,
             'dueAt',a.due_at,
             'settled',a.remaining_amount < 0.005
           ) order by a.sequence_no),'[]'::jsonb),
           (array_agg(a.id order by a.sequence_no) filter (where a.remaining_amount >= 0.005))[1],
           (array_agg(least(a.remaining_amount,v_outstanding)::numeric(18,2) order by a.sequence_no)
              filter (where a.remaining_amount >= 0.005))[1]
      into v_schedule,v_next_schedule_id,v_next_payable
    from allocated a;
  end if;

  if v_outstanding < 0.005 then
    v_status := 'settled';
    v_next_schedule_id := null;
    v_next_payable := 0;
  elsif v_total_paid > 0 or v_adjustments > 0 then
    v_status := 'partially_settled';
  else
    v_status := 'unsettled';
  end if;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'commercialOrderId',p_commercial_order_id,
    'currency',v_order.currency,
    'grossAmount',v_order.total_gross_amount,
    'approvedAdjustmentAmount',v_adjustments,
    'gatewayPaymentAmount',v_gateway,
    'directPaymentAmount',v_direct,
    'totalConfirmedPaymentAmount',v_total_paid,
    'netAmountDue',v_net_due,
    'outstandingAmount',v_outstanding,
    'overpaymentAmount',greatest(v_total_paid-v_net_due,0)::numeric(18,2),
    'settlementStatus',v_status,
    'installmentObligationId',v_obligation.id,
    'schedule',v_schedule,
    'nextInstallmentScheduleId',v_next_schedule_id,
    'nextPayableAmount',coalesce(v_next_payable,v_outstanding)
  );
end;
$$;

revoke all on function public.get_sellertray_commercial_settlement_state(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_commercial_settlement_state(uuid,uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. Stale checkout retirement
-- ---------------------------------------------------------------------------

alter table public.billing_checkout_sessions
  drop constraint if exists billing_checkout_sessions_status_check;
alter table public.billing_checkout_sessions
  add constraint billing_checkout_sessions_status_check
    check (status in ('preparing','initialized','paid','failed','expired','superseded'));

drop index if exists public.billing_checkout_sessions_installment_active_key;
create unique index billing_checkout_sessions_installment_active_key
  on public.billing_checkout_sessions(tenant_id,installment_schedule_id)
  where checkout_kind='installment' and status in ('preparing','initialized','paid');

create or replace function public.supersede_sellertray_stale_installment_checkouts(
  p_tenant_id uuid,
  p_commercial_order_id uuid
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_state jsonb;
  v_next_schedule_id uuid;
  v_next_amount numeric(18,2);
  v_outstanding numeric(18,2);
  v_count integer;
begin
  v_state := public.get_sellertray_commercial_settlement_state(p_tenant_id,p_commercial_order_id);
  v_next_schedule_id := nullif(v_state->>'nextInstallmentScheduleId','')::uuid;
  v_next_amount := coalesce((v_state->>'nextPayableAmount')::numeric,0);
  v_outstanding := coalesce((v_state->>'outstandingAmount')::numeric,0);

  update public.billing_checkout_sessions s
  set status='superseded'
  where s.tenant_id=p_tenant_id
    and s.commercial_order_id=p_commercial_order_id
    and s.checkout_kind='installment'
    and s.status in ('preparing','initialized')
    and (
      v_outstanding < 0.005
      or v_next_schedule_id is null
      or s.installment_schedule_id <> v_next_schedule_id
      or abs(coalesce(s.amount,0)-v_next_amount) >= 0.005
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.supersede_sellertray_stale_installment_checkouts(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.supersede_sellertray_stale_installment_checkouts(uuid,uuid)
  to service_role;

-- Service-role-only append functions. Capability-aware Admin wrappers are wired
-- in the next OA2 surface slice; direct client mutation is intentionally absent.
create or replace function public.record_sellertray_commercial_adjustment_internal(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_command_id uuid,
  p_amount numeric,
  p_reason text,
  p_evidence jsonb,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row public.sellertray_commercial_adjustments%rowtype;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Commercial adjustment amount must be positive' using errcode='22023';
  end if;
  if nullif(btrim(p_reason),'') is null then
    raise exception 'Commercial adjustment reason is required' using errcode='22023';
  end if;

  select a.* into v_row
  from public.sellertray_commercial_adjustments a
  where a.tenant_id=p_tenant_id and a.command_id=p_command_id;

  if found then
    if v_row.commercial_order_id<>p_commercial_order_id or abs(v_row.amount-round(p_amount::numeric,2))>=0.005 then
      raise exception 'Commercial adjustment command id was already used with different input' using errcode='23505';
    end if;
  else
    insert into public.sellertray_commercial_adjustments(
      tenant_id,commercial_order_id,command_id,amount,currency,reason,evidence,actor_user_id
    )
    select p_tenant_id,p_commercial_order_id,p_command_id,round(p_amount::numeric,2),o.currency,
           btrim(p_reason),coalesce(p_evidence,'{}'::jsonb),p_actor_user_id
    from public.sellertray_commercial_orders o
    where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id
    returning * into strict v_row;
  end if;

  perform public.supersede_sellertray_stale_installment_checkouts(p_tenant_id,p_commercial_order_id);
  return public.get_sellertray_commercial_settlement_state(p_tenant_id,p_commercial_order_id);
end;
$$;

create or replace function public.record_sellertray_commercial_direct_payment_internal(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_command_id uuid,
  p_payment_reference text,
  p_payment_method text,
  p_amount numeric,
  p_paid_at timestamptz,
  p_reason text,
  p_evidence jsonb,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row public.sellertray_commercial_direct_payment_confirmations%rowtype;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Direct payment amount must be positive' using errcode='22023';
  end if;
  if nullif(btrim(p_payment_reference),'') is null or nullif(btrim(p_payment_method),'') is null then
    raise exception 'Direct payment reference and method are required' using errcode='22023';
  end if;
  if nullif(btrim(p_reason),'') is null then
    raise exception 'Direct payment reason is required' using errcode='22023';
  end if;

  select d.* into v_row
  from public.sellertray_commercial_direct_payment_confirmations d
  where d.tenant_id=p_tenant_id and d.command_id=p_command_id;

  if found then
    if v_row.commercial_order_id<>p_commercial_order_id
       or v_row.payment_reference<>btrim(p_payment_reference)
       or abs(v_row.amount-round(p_amount::numeric,2))>=0.005 then
      raise exception 'Direct payment command id was already used with different input' using errcode='23505';
    end if;
  else
    insert into public.sellertray_commercial_direct_payment_confirmations(
      tenant_id,commercial_order_id,command_id,payment_reference,payment_method,
      amount,currency,reason,evidence,actor_user_id,paid_at
    )
    select p_tenant_id,p_commercial_order_id,p_command_id,btrim(p_payment_reference),
           lower(btrim(p_payment_method)),round(p_amount::numeric,2),o.currency,btrim(p_reason),
           coalesce(p_evidence,'{}'::jsonb),p_actor_user_id,p_paid_at
    from public.sellertray_commercial_orders o
    where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id
    returning * into strict v_row;
  end if;

  perform public.supersede_sellertray_stale_installment_checkouts(p_tenant_id,p_commercial_order_id);
  return public.get_sellertray_commercial_settlement_state(p_tenant_id,p_commercial_order_id);
end;
$$;

revoke all on function public.record_sellertray_commercial_adjustment_internal(uuid,uuid,uuid,numeric,text,jsonb,uuid)
  from public,anon,authenticated;
revoke all on function public.record_sellertray_commercial_direct_payment_internal(uuid,uuid,uuid,text,text,numeric,timestamptz,text,jsonb,uuid)
  from public,anon,authenticated;
grant execute on function public.record_sellertray_commercial_adjustment_internal(uuid,uuid,uuid,numeric,text,jsonb,uuid)
  to service_role;
grant execute on function public.record_sellertray_commercial_direct_payment_internal(uuid,uuid,uuid,text,text,numeric,timestamptz,text,jsonb,uuid)
  to service_role;

-- New OA2 tables are not client-readable/writable by default. Read projections
-- and capability-gated mutation RPCs expose only governed data.
alter table public.sellertray_installment_schedule_templates enable row level security;
alter table public.sellertray_installment_schedule_template_lines enable row level security;
alter table public.sellertray_installment_policy_versions enable row level security;
alter table public.sellertray_installment_contract_snapshots enable row level security;
alter table public.sellertray_commercial_adjustments enable row level security;
alter table public.sellertray_commercial_direct_payment_confirmations enable row level security;

revoke all on public.sellertray_installment_schedule_templates from public,anon,authenticated;
revoke all on public.sellertray_installment_schedule_template_lines from public,anon,authenticated;
revoke all on public.sellertray_installment_policy_versions from public,anon,authenticated;
revoke all on public.sellertray_installment_contract_snapshots from public,anon,authenticated;
revoke all on public.sellertray_commercial_adjustments from public,anon,authenticated;
revoke all on public.sellertray_commercial_direct_payment_confirmations from public,anon,authenticated;

grant select,insert on public.sellertray_installment_schedule_templates to service_role;
grant select,insert on public.sellertray_installment_schedule_template_lines to service_role;
grant select,insert on public.sellertray_installment_policy_versions to service_role;
grant select,insert on public.sellertray_installment_contract_snapshots to service_role;
grant select,insert on public.sellertray_commercial_adjustments to service_role;
grant select,insert on public.sellertray_commercial_direct_payment_confirmations to service_role;
$oa4_source_0$;
    -- Source: 20261023163000_oa2_installment_checkout_convergence.sql
    execute $oa4_source_1$
-- SellerTray OA2 installment checkout convergence
--
-- New/unaccepted commerce follows current effective installment policy.
-- Accepted installment agreements remain governed contracts even when a later
-- global policy disables new installment offers. Every provider transition is
-- revalidated against the shared settlement projection so a stale checkout can
-- never be revived by initialization retries or delayed provider callbacks.

-- ---------------------------------------------------------------------------
-- Contract/policy projection
-- ---------------------------------------------------------------------------

create or replace function public.get_sellertray_installment_contract_checkout_policy(
  p_tenant_id uuid,
  p_installment_obligation_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_snapshot public.sellertray_installment_contract_snapshots%rowtype;
  v_plan_code text;
  v_billing_cycle text;
  v_accepted_at timestamptz;
  v_policy jsonb;
  v_policy_enabled boolean := false;
  v_policy_template_id uuid;
begin
  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.id=p_installment_obligation_id;

  select s.* into strict v_snapshot
  from public.sellertray_installment_contract_snapshots s
  where s.tenant_id=p_tenant_id and s.installment_obligation_id=v_obligation.id;

  select s.plan_code,s.billing_cycle
    into strict v_plan_code,v_billing_cycle
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=p_tenant_id
    and s.commercial_order_id=v_obligation.commercial_order_id
    and s.line_type='subscription';

  select ac.accepted_at into v_accepted_at
  from public.sellertray_commercial_agreements a
  join public.sellertray_commercial_agreement_acceptances ac
    on ac.tenant_id=a.tenant_id and ac.agreement_id=a.id
  where a.tenant_id=p_tenant_id
    and a.commercial_order_id=v_obligation.commercial_order_id
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

  v_policy := public.resolve_sellertray_installment_policy(
    p_tenant_id,v_obligation.commercial_order_id,v_plan_code,v_billing_cycle,p_as_of
  );
  v_policy_enabled := coalesce((v_policy->>'enabled')::boolean,false);
  v_policy_template_id := nullif(v_policy->>'defaultTemplateId','')::uuid;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'commercialOrderId',v_obligation.commercial_order_id,
    'installmentObligationId',v_obligation.id,
    'planCode',v_plan_code,
    'billingCycle',v_billing_cycle,
    'agreementAccepted',v_accepted_at is not null,
    'agreementAcceptedAt',v_accepted_at,
    'contractTemplateId',v_snapshot.template_id,
    'contractTemplateCode',v_snapshot.template_code,
    'contractTemplateVersion',v_snapshot.template_version,
    'currentPolicy',v_policy,
    'draftEligible',v_policy_enabled and v_policy_template_id=v_snapshot.template_id,
    'checkoutEligible',v_accepted_at is not null
  );
end;
$$;

revoke all on function public.get_sellertray_installment_contract_checkout_policy(uuid,uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_installment_contract_checkout_policy(uuid,uuid,timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- Server-owned obligation materialization from current effective policy
-- ---------------------------------------------------------------------------

create or replace function public.materialize_sellertray_installment_obligation_internal(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_existing public.sellertray_commercial_installment_obligations%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_plan_code text;
  v_billing_cycle text;
  v_policy jsonb;
  v_policy_id uuid;
  v_template_id uuid;
  v_template public.sellertray_installment_schedule_templates%rowtype;
  v_obligation_id uuid;
  v_line record;
  v_last_sequence integer;
  v_allocated numeric(18,2) := 0;
  v_amount numeric(18,2);
begin
  if p_tenant_id is null or p_commercial_order_id is null or p_actor_user_id is null then
    raise exception 'Business, commercial order and actor are required' using errcode='22023';
  end if;

  select o.* into v_existing
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.commercial_order_id=p_commercial_order_id;
  if found then
    return v_existing.id;
  end if;

  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id;

  select s.plan_code,s.billing_cycle
    into strict v_plan_code,v_billing_cycle
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=p_tenant_id
    and s.commercial_order_id=p_commercial_order_id
    and s.line_type='subscription';

  v_policy := public.resolve_sellertray_installment_policy(
    p_tenant_id,p_commercial_order_id,v_plan_code,v_billing_cycle,now()
  );
  if v_policy is null or not coalesce((v_policy->>'enabled')::boolean,false) then
    raise exception 'Installments are not enabled for this commercial order' using errcode='23514';
  end if;

  v_policy_id := nullif(v_policy->>'policyVersionId','')::uuid;
  v_template_id := nullif(v_policy->>'defaultTemplateId','')::uuid;
  if v_policy_id is null or v_template_id is null then
    raise exception 'Enabled installment policy has no governed schedule template' using errcode='23514';
  end if;

  select t.* into strict v_template
  from public.sellertray_installment_schedule_templates t
  where t.id=v_template_id
    and t.status='published'
    and t.effective_from<=now()
    and (t.effective_until is null or t.effective_until>now());

  if exists (
    select 1
    from public.sellertray_installment_schedule_template_lines l
    where l.template_id=v_template.id and l.percentage is null
  ) then
    raise exception 'Fixed-amount installment templates are not materializable until their order-allocation policy is approved'
      using errcode='0A000';
  end if;

  select max(l.sequence_no) into strict v_last_sequence
  from public.sellertray_installment_schedule_template_lines l
  where l.template_id=v_template.id;

  insert into public.sellertray_commercial_installment_obligations(
    tenant_id,commercial_order_id,structure_code,currency,obligated_amount,created_by_user_id
  ) values (
    p_tenant_id,p_commercial_order_id,v_template.template_code,v_order.currency,
    v_order.total_gross_amount,p_actor_user_id
  ) returning id into v_obligation_id;

  for v_line in
    select l.*
    from public.sellertray_installment_schedule_template_lines l
    where l.template_id=v_template.id
    order by l.sequence_no
  loop
    if v_line.sequence_no=v_last_sequence then
      v_amount := (v_order.total_gross_amount-v_allocated)::numeric(18,2);
    else
      v_amount := round((v_order.total_gross_amount*v_line.percentage/100)::numeric,2);
      v_allocated := (v_allocated+v_amount)::numeric(18,2);
    end if;

    insert into public.sellertray_commercial_installment_schedule(
      tenant_id,installment_obligation_id,sequence_no,percentage,amount_due,due_at
    ) values (
      p_tenant_id,v_obligation_id,v_line.sequence_no,v_line.percentage,v_amount,
      case
        when v_line.due_offset_days is null then null
        else v_order.ordered_at+make_interval(days=>v_line.due_offset_days)
      end
    );
  end loop;

  insert into public.sellertray_installment_contract_snapshots(
    tenant_id,commercial_order_id,installment_obligation_id,policy_version_id,
    template_id,template_code,template_version,provisional_entitlement_months,
    qualifying_settlement_sequence,snapshotted_at
  ) values (
    p_tenant_id,p_commercial_order_id,v_obligation_id,v_policy_id,
    v_template.id,v_template.template_code,v_template.version,
    v_template.provisional_entitlement_months,v_template.qualifying_settlement_sequence,now()
  );

  return v_obligation_id;
end;
$$;

revoke all on function public.materialize_sellertray_installment_obligation_internal(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.materialize_sellertray_installment_obligation_internal(uuid,uuid,uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Checkout insert guard: accepted contract + current settlement, no annual-only
-- or initial-purchase stereotype.
-- ---------------------------------------------------------------------------

create or replace function public.guard_sellertray_initial_purchase_installment_checkout()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_schedule public.sellertray_commercial_installment_schedule%rowtype;
  v_plan_code text;
  v_contract jsonb;
  v_settlement jsonb;
  v_next_schedule_id uuid;
  v_next_amount numeric(18,2);
  v_expected_reference text;
begin
  if new.checkout_kind is distinct from 'installment' then
    return new;
  end if;

  if new.tenant_id is null or new.command_id is null or new.commercial_order_id is null
     or new.installment_obligation_id is null or new.installment_schedule_id is null
     or new.amount is null or new.currency is null then
    raise exception 'Installment checkout requires governed commercial order, obligation, schedule and money identity'
      using errcode='23514';
  end if;
  if new.provider<>'paystack' or new.status<>'preparing'
     or new.authorization_url is not null
     or new.provider_customer_ref is not null
     or new.provider_subscription_ref is not null then
    raise exception 'Installment checkout must begin as an uninitialized Paystack reservation'
      using errcode='23514';
  end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=new.tenant_id and tm.user_id=new.requested_by_user_id and tm.role='owner'
  ) then
    raise exception 'Only the business Owner can create an installment checkout reservation'
      using errcode='42501';
  end if;

  v_expected_reference := 'sti-'||substr(replace(new.tenant_id::text,'-',''),1,8)
    ||'-'||replace(new.command_id::text,'-','');
  if new.reference<>v_expected_reference then
    raise exception 'Installment checkout reference must match the governed command identity'
      using errcode='23514';
  end if;

  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=new.tenant_id and o.id=new.commercial_order_id;
  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=new.tenant_id and o.id=new.installment_obligation_id
    and o.commercial_order_id=v_order.id;
  select s.* into strict v_schedule
  from public.sellertray_commercial_installment_schedule s
  where s.tenant_id=new.tenant_id and s.id=new.installment_schedule_id
    and s.installment_obligation_id=v_obligation.id;
  select s.plan_code into strict v_plan_code
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=new.tenant_id and s.commercial_order_id=v_order.id
    and s.line_type='subscription';

  v_contract := public.get_sellertray_installment_contract_checkout_policy(
    new.tenant_id,v_obligation.id,now()
  );
  if not coalesce((v_contract->>'agreementAccepted')::boolean,false) then
    raise exception 'The current installment agreement must be accepted before checkout'
      using errcode='23514';
  end if;

  v_settlement := public.get_sellertray_commercial_settlement_state(new.tenant_id,v_order.id);
  v_next_schedule_id := nullif(v_settlement->>'nextInstallmentScheduleId','')::uuid;
  v_next_amount := coalesce((v_settlement->>'nextPayableAmount')::numeric,0);

  if v_next_schedule_id is null or v_next_amount < 0.005 then
    raise exception 'Commercial order is already settled' using errcode='23514';
  end if;
  if new.installment_schedule_id<>v_next_schedule_id
     or new.plan_code is distinct from v_plan_code
     or new.currency is distinct from v_obligation.currency
     or abs(new.amount-v_next_amount)>=0.005 then
    raise exception 'Installment checkout must match the current authoritative payable schedule and amount'
      using errcode='23514';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_sellertray_initial_purchase_installment_checkout()
  from public,anon,authenticated;

-- Existing trigger keeps its name and now executes the converged function.

-- ---------------------------------------------------------------------------
-- Reservation authority
-- ---------------------------------------------------------------------------

create or replace function public.reserve_sellertray_installment_checkout(
  p_tenant_id uuid,
  p_installment_schedule_id uuid,
  p_command_id uuid,
  p_actor_user_id uuid,
  p_billing_email text
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_role text;
  v_email text := lower(btrim(coalesce(p_billing_email,'')));
  v_schedule public.sellertray_commercial_installment_schedule%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_plan_code text;
  v_contract jsonb;
  v_state jsonb;
  v_next_schedule_id uuid;
  v_next_amount numeric(18,2);
  v_existing public.billing_checkout_sessions%rowtype;
  v_reference text;
  v_session public.billing_checkout_sessions%rowtype;
begin
  if p_tenant_id is null or p_installment_schedule_id is null
     or p_command_id is null or p_actor_user_id is null then
    raise exception 'Business, installment, command and user are required' using errcode='22023';
  end if;
  if char_length(v_email) not between 3 and 320 or position('@' in v_email)=0 then
    raise exception 'A valid billing email is required' using errcode='22023';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if v_role is distinct from 'owner' then
    raise exception 'Only the business Owner can start installment billing' using errcode='42501';
  end if;

  select sch.* into strict v_schedule
  from public.sellertray_commercial_installment_schedule sch
  where sch.tenant_id=p_tenant_id and sch.id=p_installment_schedule_id;
  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.id=v_schedule.installment_obligation_id;
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=v_obligation.commercial_order_id;
  select s.plan_code into strict v_plan_code
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=p_tenant_id and s.commercial_order_id=v_order.id and s.line_type='subscription';

  v_contract := public.get_sellertray_installment_contract_checkout_policy(
    p_tenant_id,v_obligation.id,now()
  );
  if not coalesce((v_contract->>'agreementAccepted')::boolean,false) then
    raise exception 'The current installment agreement must be accepted before checkout'
      using errcode='23514';
  end if;

  perform public.supersede_sellertray_stale_installment_checkouts(p_tenant_id,v_order.id);
  v_state := public.get_sellertray_commercial_settlement_state(p_tenant_id,v_order.id);
  v_next_schedule_id := nullif(v_state->>'nextInstallmentScheduleId','')::uuid;
  v_next_amount := coalesce((v_state->>'nextPayableAmount')::numeric,0);

  if coalesce((v_state->>'outstandingAmount')::numeric,0)<0.005 then
    return jsonb_build_object(
      'status','paid','installmentScheduleId',p_installment_schedule_id,
      'amount',0,'currency',v_obligation.currency,'planCode',v_plan_code,
      'needsProviderInitialization',false
    );
  end if;
  if v_next_schedule_id is distinct from p_installment_schedule_id then
    raise exception 'Selected installment is not the current authoritative payable schedule'
      using errcode='23514';
  end if;

  select s.* into v_existing
  from public.billing_checkout_sessions s
  where s.tenant_id=p_tenant_id and s.checkout_kind='installment' and s.command_id=p_command_id;
  if found then
    if v_existing.installment_schedule_id<>v_schedule.id
       or v_existing.requested_by_user_id<>p_actor_user_id
       or lower(v_existing.billing_email)<>v_email then
      raise exception 'Installment checkout command is already used for different facts'
        using errcode='23505';
    end if;
    return jsonb_build_object(
      'sessionId',v_existing.id,'status',v_existing.status,'reference',v_existing.reference,
      'authorizationUrl',v_existing.authorization_url,
      'installmentScheduleId',v_existing.installment_schedule_id,'amount',v_existing.amount,
      'currency',v_existing.currency,'planCode',v_existing.plan_code,
      'needsProviderInitialization',v_existing.status='preparing' and v_existing.authorization_url is null
    );
  end if;

  select s.* into v_existing
  from public.billing_checkout_sessions s
  where s.tenant_id=p_tenant_id and s.checkout_kind='installment'
    and s.installment_schedule_id=v_schedule.id
    and s.status in ('preparing','initialized','paid')
  order by s.created_at desc
  limit 1;
  if found then
    return jsonb_build_object(
      'sessionId',v_existing.id,'status',v_existing.status,'reference',v_existing.reference,
      'authorizationUrl',v_existing.authorization_url,
      'installmentScheduleId',v_existing.installment_schedule_id,'amount',v_existing.amount,
      'currency',v_existing.currency,'planCode',v_existing.plan_code,
      'needsProviderInitialization',false
    );
  end if;

  v_reference := 'sti-'||substr(replace(p_tenant_id::text,'-',''),1,8)
    ||'-'||replace(p_command_id::text,'-','');

  insert into public.billing_checkout_sessions(
    tenant_id,plan_code,requested_by_user_id,billing_email,provider,reference,
    status,checkout_kind,command_id,commercial_order_id,installment_obligation_id,
    installment_schedule_id,amount,currency,created_at,updated_at
  ) values (
    p_tenant_id,v_plan_code,p_actor_user_id,v_email,'paystack',v_reference,
    'preparing','installment',p_command_id,v_order.id,v_obligation.id,
    v_schedule.id,v_next_amount,v_obligation.currency,now(),now()
  ) returning * into v_session;

  return jsonb_build_object(
    'sessionId',v_session.id,'status',v_session.status,'reference',v_session.reference,
    'authorizationUrl',v_session.authorization_url,
    'installmentScheduleId',v_session.installment_schedule_id,'amount',v_session.amount,
    'currency',v_session.currency,'planCode',v_session.plan_code,
    'needsProviderInitialization',true
  );
end;
$$;

revoke all on function public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Provider initialization transitions re-check settlement freshness.
-- ---------------------------------------------------------------------------

create or replace function public.begin_sellertray_installment_checkout_initialization(
  p_session_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_session public.billing_checkout_sessions%rowtype;
begin
  if p_session_id is null then
    raise exception 'Installment checkout session is required' using errcode='22023';
  end if;

  select s.* into strict v_session
  from public.billing_checkout_sessions s
  where s.id=p_session_id and s.checkout_kind='installment';
  perform public.supersede_sellertray_stale_installment_checkouts(v_session.tenant_id,v_session.commercial_order_id);

  select s.* into strict v_session
  from public.billing_checkout_sessions s
  where s.id=p_session_id and s.checkout_kind='installment'
  for update;

  if v_session.status='initialized' and v_session.authorization_url is not null then
    return jsonb_build_object('started',false,'status','initialized','reference',v_session.reference,
      'authorizationUrl',v_session.authorization_url,'startedAt',v_session.provider_initialization_started_at);
  end if;
  if v_session.status in ('failed','superseded') then
    return jsonb_build_object('started',false,'status',v_session.status,'reference',v_session.reference,
      'authorizationUrl',v_session.authorization_url,'startedAt',v_session.provider_initialization_started_at);
  end if;
  if v_session.status<>'preparing' then
    raise exception 'Installment checkout cannot begin provider initialization from its current state'
      using errcode='23514';
  end if;
  if v_session.authorization_url is not null then
    raise exception 'Preparing installment checkout cannot already have a provider authorization URL'
      using errcode='23505';
  end if;
  if v_session.provider_initialization_started_at is not null then
    return jsonb_build_object('started',false,'status','in_progress','reference',v_session.reference,
      'authorizationUrl',null,'startedAt',v_session.provider_initialization_started_at);
  end if;

  update public.billing_checkout_sessions
  set provider_initialization_started_at=now(),updated_at=now()
  where id=v_session.id
  returning * into v_session;

  return jsonb_build_object('started',true,'status','in_progress','reference',v_session.reference,
    'authorizationUrl',null,'startedAt',v_session.provider_initialization_started_at);
end;
$$;

revoke all on function public.begin_sellertray_installment_checkout_initialization(uuid)
  from public,anon,authenticated;
grant execute on function public.begin_sellertray_installment_checkout_initialization(uuid)
  to service_role;

create or replace function public.complete_sellertray_installment_checkout_initialization(
  p_session_id uuid,
  p_provider_reference text,
  p_authorization_url text
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_session public.billing_checkout_sessions%rowtype;
  v_reference text := btrim(coalesce(p_provider_reference,''));
  v_url text := btrim(coalesce(p_authorization_url,''));
begin
  select s.* into strict v_session
  from public.billing_checkout_sessions s
  where s.id=p_session_id and s.checkout_kind='installment';
  perform public.supersede_sellertray_stale_installment_checkouts(v_session.tenant_id,v_session.commercial_order_id);

  select s.* into strict v_session
  from public.billing_checkout_sessions s
  where s.id=p_session_id and s.checkout_kind='installment'
  for update;

  if v_session.status='superseded' then
    raise exception 'Installment checkout was superseded by newer commercial settlement facts'
      using errcode='23514';
  end if;
  if v_reference<>v_session.reference then
    raise exception 'Billing provider reference does not match reserved installment checkout'
      using errcode='23514';
  end if;
  if char_length(v_url) not between 1 and 4000 then
    raise exception 'Billing provider returned no checkout URL' using errcode='22023';
  end if;

  if v_session.status='initialized' then
    if v_session.authorization_url is distinct from v_url then
      raise exception 'Installment checkout was already initialized with different provider facts'
        using errcode='23505';
    end if;
  elsif v_session.status='preparing' then
    if v_session.provider_initialization_started_at is null then
      raise exception 'Installment checkout provider initialization was not begun'
        using errcode='23514';
    end if;
    update public.billing_checkout_sessions
    set authorization_url=v_url,status='initialized',updated_at=now()
    where id=v_session.id;
  else
    raise exception 'Installment checkout cannot be initialized from its current state'
      using errcode='23514';
  end if;

  return jsonb_build_object('sessionId',v_session.id,'reference',v_session.reference,
    'authorizationUrl',v_url,'status','initialized');
end;
$$;

revoke all on function public.complete_sellertray_installment_checkout_initialization(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.complete_sellertray_installment_checkout_initialization(uuid,text,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Provider confirmation: idempotent duplicates survive, stale new callbacks do
-- not. Amount may be the authoritative residual of a schedule line after an
-- approved adjustment/direct payment, not necessarily the original full line.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_sellertray_installment_payment_from_checkout(
  p_checkout_session_id uuid,
  p_provider_reference text,
  p_provider_transaction_ref text,
  p_amount numeric,
  p_currency text,
  p_paid_at timestamptz,
  p_provider_event_fingerprint text
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_session public.billing_checkout_sessions%rowtype;
  v_existing public.sellertray_commercial_installment_payment_confirmations%rowtype;
  v_state jsonb;
  v_next_schedule_id uuid;
  v_next_amount numeric(18,2);
  v_id uuid;
  v_provider_reference text := btrim(coalesce(p_provider_reference,''));
  v_transaction_ref text := nullif(btrim(coalesce(p_provider_transaction_ref,'')),'');
  v_currency text := upper(btrim(coalesce(p_currency,'')));
  v_fingerprint text := btrim(coalesce(p_provider_event_fingerprint,''));
begin
  if p_checkout_session_id is null or p_amount is null or p_paid_at is null then
    raise exception 'Installment checkout, amount and payment time are required' using errcode='22023';
  end if;

  select s.* into strict v_session
  from public.billing_checkout_sessions s
  where s.id=p_checkout_session_id and s.checkout_kind='installment'
  for update;

  if v_provider_reference<>v_session.reference
     or v_currency<>v_session.currency
     or abs(p_amount-v_session.amount)>=0.005 then
    raise exception 'Confirmed installment payment does not match the reserved amount, currency and reference'
      using errcode='23514';
  end if;
  if char_length(v_fingerprint) not between 16 and 256 then
    raise exception 'Verified provider event fingerprint is required' using errcode='22023';
  end if;

  select pc.* into v_existing
  from public.sellertray_commercial_installment_payment_confirmations pc
  where pc.billing_checkout_session_id=v_session.id;
  if found then
    if v_existing.provider_reference<>v_provider_reference
       or v_existing.provider_transaction_ref is distinct from v_transaction_ref
       or v_existing.provider_event_fingerprint<>v_fingerprint
       or abs(v_existing.amount-p_amount)>=0.005
       or v_existing.currency<>v_currency
       or v_existing.paid_at<>p_paid_at then
      raise exception 'Installment payment checkout is already confirmed with different provider facts'
        using errcode='23505';
    end if;
    return v_existing.id;
  end if;

  perform public.supersede_sellertray_stale_installment_checkouts(
    v_session.tenant_id,v_session.commercial_order_id
  );
  select s.* into strict v_session
  from public.billing_checkout_sessions s
  where s.id=p_checkout_session_id
  for update;

  if v_session.status not in ('preparing','initialized') then
    raise exception 'Installment checkout cannot be confirmed from its current state'
      using errcode='23514';
  end if;
  if v_session.provider_initialization_started_at is null then
    raise exception 'Installment checkout provider initialization was not begun'
      using errcode='23514';
  end if;

  v_state := public.get_sellertray_commercial_settlement_state(
    v_session.tenant_id,v_session.commercial_order_id
  );
  v_next_schedule_id := nullif(v_state->>'nextInstallmentScheduleId','')::uuid;
  v_next_amount := coalesce((v_state->>'nextPayableAmount')::numeric,0);
  if v_next_schedule_id is distinct from v_session.installment_schedule_id
     or abs(v_next_amount-v_session.amount)>=0.005 then
    update public.billing_checkout_sessions set status='superseded',updated_at=now()
    where id=v_session.id;
    raise exception 'Installment checkout was superseded by newer commercial settlement facts'
      using errcode='23514';
  end if;

  if exists (
    select 1 from public.sellertray_commercial_installment_payment_confirmations pc
    where pc.tenant_id=v_session.tenant_id
      and pc.installment_schedule_id=v_session.installment_schedule_id
  ) then
    raise exception 'SellerTray installment is already paid by another provider transaction'
      using errcode='23505';
  end if;

  insert into public.sellertray_commercial_installment_payment_confirmations(
    tenant_id,commercial_order_id,installment_obligation_id,installment_schedule_id,
    billing_checkout_session_id,provider,provider_reference,provider_transaction_ref,
    provider_event_fingerprint,amount,currency,paid_at,recorded_at
  ) values (
    v_session.tenant_id,v_session.commercial_order_id,v_session.installment_obligation_id,
    v_session.installment_schedule_id,v_session.id,v_session.provider,v_provider_reference,
    v_transaction_ref,v_fingerprint,p_amount,v_currency,p_paid_at,now()
  ) returning id into v_id;

  update public.billing_checkout_sessions
  set status='paid',updated_at=now()
  where id=v_session.id;

  return v_id;
end;
$$;

revoke all on function public.confirm_sellertray_installment_payment_from_checkout(uuid,text,text,numeric,text,timestamptz,text)
  from public,anon,authenticated;
grant execute on function public.confirm_sellertray_installment_payment_from_checkout(uuid,text,text,numeric,text,timestamptz,text)
  to service_role;
$oa4_source_1$;
    -- Source: 20261023170000_oa2_settlement_entitlement_convergence.sql
    execute $oa4_source_2$
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
$oa4_source_2$;
    -- Source: 20261023180000_oa2_commercial_settlement_surfaces.sql
    execute $oa4_source_3$
-- SellerTray OA2 commercial settlement surfaces
--
-- Separation of concerns is intentional:
-- - existing Billing & Commercial owns price publication, purchase creation,
--   agreements and Branch readiness;
-- - this slice owns settlement review, audited commercial credits/direct
--   payments and merchant/order installment-policy overrides;
-- - Merchant Billing is read-only over the same settlement truth and continues
--   to use billing-checkout for provider payment creation.

-- ---------------------------------------------------------------------------
-- 1. Scoped ProcessEdge Admin capabilities
-- ---------------------------------------------------------------------------

create table public.platform_admin_capability_grant_versions (
  id uuid primary key default gen_random_uuid(),
  grantee_user_id uuid not null references auth.users(id) on delete restrict,
  capability_code text not null,
  scope_kind text not null default 'platform',
  tenant_id uuid references public.tenants(id) on delete restrict,
  enabled boolean not null,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint platform_admin_capability_code_check
    check (capability_code in (
      'admin.pricing.manage',
      'admin.payments.reconcile',
      'admin.installments.manage'
    )),
  constraint platform_admin_capability_scope_check
    check (
      (scope_kind='platform' and tenant_id is null)
      or (scope_kind='tenant' and tenant_id is not null)
    ),
  constraint platform_admin_capability_effective_check
    check (effective_until is null or effective_until > effective_from),
  constraint platform_admin_capability_reason_check
    check (char_length(btrim(reason)) between 6 and 1000)
);

create index platform_admin_capability_resolution_idx
  on public.platform_admin_capability_grant_versions(
    grantee_user_id,capability_code,effective_from desc,created_at desc
  );
create index platform_admin_capability_tenant_idx
  on public.platform_admin_capability_grant_versions(
    tenant_id,grantee_user_id,capability_code,effective_from desc
  ) where tenant_id is not null;

create or replace function public.prevent_platform_admin_capability_history_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception 'Platform administrator capability history is append-only' using errcode='55000';
end;
$$;

revoke all on function public.prevent_platform_admin_capability_history_mutation()
  from public,anon,authenticated;

create trigger prevent_platform_admin_capability_history_mutation
before update or delete on public.platform_admin_capability_grant_versions
for each row execute function public.prevent_platform_admin_capability_history_mutation();

create or replace function public.platform_admin_has_capability(
  p_actor_user_id uuid,
  p_capability_code text,
  p_tenant_id uuid default null,
  p_as_of timestamptz default now()
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_enabled boolean;
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if v_role='admin' then
    return true;
  end if;
  if v_role is distinct from 'support' then
    return false;
  end if;

  select g.enabled into v_enabled
  from public.platform_admin_capability_grant_versions g
  where g.grantee_user_id=p_actor_user_id
    and g.capability_code=p_capability_code
    and g.effective_from<=p_as_of
    and (g.effective_until is null or g.effective_until>p_as_of)
    and (
      g.scope_kind='platform'
      or (g.scope_kind='tenant' and p_tenant_id is not null and g.tenant_id=p_tenant_id)
    )
  order by
    case g.scope_kind when 'tenant' then 200 else 100 end desc,
    g.effective_from desc,
    g.created_at desc
  limit 1;

  return coalesce(v_enabled,false);
end;
$$;

revoke all on function public.platform_admin_has_capability(uuid,text,uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.platform_admin_has_capability(uuid,text,uuid,timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. Idempotent policy-change command ledger
-- ---------------------------------------------------------------------------

create table public.sellertray_installment_policy_change_commands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  command_id uuid not null,
  policy_version_id uuid not null references public.sellertray_installment_policy_versions(id) on delete restrict,
  request_payload jsonb not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (tenant_id,command_id),
  constraint sellertray_installment_policy_change_payload_check
    check (jsonb_typeof(request_payload)='object')
);

create trigger prevent_sellertray_installment_policy_change_command_mutation
before update or delete on public.sellertray_installment_policy_change_commands
for each row execute function public.prevent_sellertray_commercial_history_mutation();

-- ---------------------------------------------------------------------------
-- 3. Shared settlement detail projection
-- ---------------------------------------------------------------------------

create or replace function public.get_sellertray_commercial_settlement_detail_internal(
  p_tenant_id uuid,
  p_commercial_order_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_plan_code text;
  v_billing_cycle text;
  v_obligation_id uuid;
  v_settlement jsonb;
  v_billing jsonb;
  v_policy jsonb;
  v_contract jsonb;
  v_adjustments jsonb;
  v_direct_payments jsonb;
  v_gateway_payments jsonb;
begin
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id;

  select s.plan_code,s.billing_cycle
    into v_plan_code,v_billing_cycle
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=p_tenant_id
    and s.commercial_order_id=p_commercial_order_id
    and s.line_type='subscription'
  order by s.line_no
  limit 1;

  select io.id into v_obligation_id
  from public.sellertray_commercial_installment_obligations io
  where io.tenant_id=p_tenant_id and io.commercial_order_id=p_commercial_order_id
  order by io.created_at,io.id
  limit 1;

  v_settlement := public.get_sellertray_commercial_settlement_state(
    p_tenant_id,p_commercial_order_id
  );

  if v_obligation_id is not null then
    v_billing := public.get_sellertray_installment_billing_state(
      p_tenant_id,v_obligation_id
    );
    select jsonb_build_object(
      'id',cs.id,
      'policyVersionId',cs.policy_version_id,
      'templateId',cs.template_id,
      'templateCode',cs.template_code,
      'templateVersion',cs.template_version,
      'templateDisplayName',t.display_name,
      'provisionalEntitlementMonths',cs.provisional_entitlement_months,
      'qualifyingSettlementSequence',cs.qualifying_settlement_sequence,
      'snapshottedAt',cs.snapshotted_at
    ) into v_contract
    from public.sellertray_installment_contract_snapshots cs
    join public.sellertray_installment_schedule_templates t on t.id=cs.template_id
    where cs.tenant_id=p_tenant_id and cs.installment_obligation_id=v_obligation_id;
  else
    v_billing := null;
    v_contract := null;
  end if;

  if v_plan_code is not null and v_billing_cycle is not null then
    v_policy := public.resolve_sellertray_installment_policy(
      p_tenant_id,p_commercial_order_id,v_plan_code,v_billing_cycle,now()
    );
  else
    v_policy := null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,
    'commandId',a.command_id,
    'type',a.adjustment_type,
    'amount',a.amount,
    'currency',a.currency,
    'reason',a.reason,
    'evidence',a.evidence,
    'actorUserId',a.actor_user_id,
    'approvedAt',a.approved_at,
    'recordedAt',a.recorded_at
  ) order by a.approved_at desc,a.recorded_at desc,a.id desc),'[]'::jsonb)
  into v_adjustments
  from public.sellertray_commercial_adjustments a
  where a.tenant_id=p_tenant_id and a.commercial_order_id=p_commercial_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,
    'commandId',d.command_id,
    'paymentReference',d.payment_reference,
    'paymentMethod',d.payment_method,
    'amount',d.amount,
    'currency',d.currency,
    'reason',d.reason,
    'evidence',d.evidence,
    'actorUserId',d.actor_user_id,
    'paidAt',d.paid_at,
    'recordedAt',d.recorded_at
  ) order by d.paid_at desc,d.recorded_at desc,d.id desc),'[]'::jsonb)
  into v_direct_payments
  from public.sellertray_commercial_direct_payment_confirmations d
  where d.tenant_id=p_tenant_id and d.commercial_order_id=p_commercial_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,
    'installmentScheduleId',p.installment_schedule_id,
    'provider',p.provider,
    'providerReference',p.provider_reference,
    'amount',p.amount,
    'currency',p.currency,
    'paidAt',p.paid_at,
    'recordedAt',p.recorded_at
  ) order by p.paid_at desc,p.recorded_at desc,p.id desc),'[]'::jsonb)
  into v_gateway_payments
  from public.sellertray_commercial_installment_payment_confirmations p
  where p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'commercialOrderId',v_order.id,
    'orderReference',v_order.order_reference,
    'orderedAt',v_order.ordered_at,
    'currency',v_order.currency,
    'grossAmount',v_order.total_gross_amount,
    'planCode',v_plan_code,
    'billingCycle',v_billing_cycle,
    'installmentObligationId',v_obligation_id,
    'settlement',v_settlement,
    'billingState',v_billing,
    'contractSnapshot',v_contract,
    'currentInstallmentPolicy',v_policy,
    'adjustments',v_adjustments,
    'directPayments',v_direct_payments,
    'gatewayPayments',v_gateway_payments
  );
end;
$$;

revoke all on function public.get_sellertray_commercial_settlement_detail_internal(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_commercial_settlement_detail_internal(uuid,uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Admin settlement center read authority
-- ---------------------------------------------------------------------------

create or replace function public.platform_admin_commercial_settlement_center(
  p_actor_user_id uuid,
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_orders jsonb;
  v_templates jsonb;
begin
  if p_actor_user_id is null or p_tenant_id is null then
    raise exception 'Administrator and Business are required' using errcode='22023';
  end if;

  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;
  if v_role not in ('admin','support') then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;
  if not exists (select 1 from public.tenants t where t.id=p_tenant_id) then
    raise exception 'SellerTray business not found' using errcode='P0002';
  end if;

  select coalesce(jsonb_agg(
    public.get_sellertray_commercial_settlement_detail_internal(p_tenant_id,o.id)
    order by o.ordered_at desc,o.id desc
  ),'[]'::jsonb)
  into v_orders
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,
    'code',t.template_code,
    'version',t.version,
    'displayName',t.display_name,
    'status',t.status,
    'provisionalEntitlementMonths',t.provisional_entitlement_months,
    'qualifyingSettlementSequence',t.qualifying_settlement_sequence,
    'effectiveFrom',t.effective_from,
    'effectiveUntil',t.effective_until,
    'lines',coalesce((
      select jsonb_agg(jsonb_build_object(
        'sequenceNo',l.sequence_no,
        'percentage',l.percentage,
        'fixedAmount',l.fixed_amount,
        'dueOffsetDays',l.due_offset_days
      ) order by l.sequence_no)
      from public.sellertray_installment_schedule_template_lines l
      where l.template_id=t.id
    ),'[]'::jsonb)
  ) order by t.template_code,t.version desc),'[]'::jsonb)
  into v_templates
  from public.sellertray_installment_schedule_templates t
  where t.status='published'
    and t.effective_from<=now()
    and (t.effective_until is null or t.effective_until>now());

  return jsonb_build_object(
    'actorRole',v_role,
    'tenantId',p_tenant_id,
    'capabilities',jsonb_build_object(
      'canAdjust',public.platform_admin_has_capability(
        p_actor_user_id,'admin.pricing.manage',p_tenant_id,now()
      ),
      'canConfirmDirectPayment',public.platform_admin_has_capability(
        p_actor_user_id,'admin.payments.reconcile',p_tenant_id,now()
      ),
      'canManageInstallments',public.platform_admin_has_capability(
        p_actor_user_id,'admin.installments.manage',p_tenant_id,now()
      )
    ),
    'templates',v_templates,
    'orders',v_orders,
    'generatedAt',now()
  );
end;
$$;

revoke all on function public.platform_admin_commercial_settlement_center(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.platform_admin_commercial_settlement_center(uuid,uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Merchant Billing read authority
-- ---------------------------------------------------------------------------

create or replace function public.get_sellertray_commercial_billing_center(
  p_tenant_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_orders jsonb;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    raise exception 'Business and user are required' using errcode='22023';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if v_role not in ('owner','manager') then
    raise exception 'Merchant billing access requires an Owner or Manager' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(
    public.get_sellertray_commercial_settlement_detail_internal(p_tenant_id,o.id)
    order by o.ordered_at desc,o.id desc
  ),'[]'::jsonb)
  into v_orders
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'actorRole',v_role,
    'canPay',v_role='owner',
    'orders',v_orders,
    'generatedAt',now()
  );
end;
$$;

revoke all on function public.get_sellertray_commercial_billing_center(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_commercial_billing_center(uuid,uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. Capability-gated Admin settlement mutations
-- ---------------------------------------------------------------------------

create or replace function public.platform_admin_record_commercial_adjustment(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_command_id uuid,
  p_amount numeric,
  p_reason text,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_obligation_id uuid;
  v_state jsonb;
begin
  if not public.platform_admin_has_capability(
    p_actor_user_id,'admin.pricing.manage',p_tenant_id,now()
  ) then
    raise exception 'Commercial pricing capability required' using errcode='42501';
  end if;
  if char_length(btrim(coalesce(p_reason,'')))<6 then
    raise exception 'Adjustment reason must be at least 6 characters' using errcode='22023';
  end if;
  if p_evidence is null or jsonb_typeof(p_evidence)<>'object' then
    raise exception 'Adjustment evidence must be an object' using errcode='22023';
  end if;

  v_state := public.record_sellertray_commercial_adjustment_internal(
    p_tenant_id,p_commercial_order_id,p_command_id,p_amount,p_reason,p_evidence,p_actor_user_id
  );

  select io.id into v_obligation_id
  from public.sellertray_commercial_installment_obligations io
  where io.tenant_id=p_tenant_id and io.commercial_order_id=p_commercial_order_id
  order by io.created_at,io.id limit 1;
  if v_obligation_id is not null then
    perform public.reconcile_sellertray_installment_entitlement(p_tenant_id,v_obligation_id);
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values (
    p_actor_user_id,p_tenant_id,'commercial_adjustment_recorded',
    jsonb_build_object(
      'commercialOrderId',p_commercial_order_id,
      'commandId',p_command_id,
      'amount',round(p_amount::numeric,2),
      'reason',btrim(p_reason)
    )
  );

  return public.get_sellertray_commercial_settlement_detail_internal(
    p_tenant_id,p_commercial_order_id
  );
end;
$$;

create or replace function public.platform_admin_record_commercial_direct_payment(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_command_id uuid,
  p_payment_reference text,
  p_payment_method text,
  p_amount numeric,
  p_paid_at timestamptz,
  p_reason text,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_obligation_id uuid;
  v_state jsonb;
begin
  if not public.platform_admin_has_capability(
    p_actor_user_id,'admin.payments.reconcile',p_tenant_id,now()
  ) then
    raise exception 'Payment reconciliation capability required' using errcode='42501';
  end if;
  if char_length(btrim(coalesce(p_reason,'')))<6 then
    raise exception 'Direct payment reason must be at least 6 characters' using errcode='22023';
  end if;
  if p_paid_at is null or p_paid_at>now()+interval '5 minutes' then
    raise exception 'Direct payment time is invalid' using errcode='22023';
  end if;
  if p_evidence is null or jsonb_typeof(p_evidence)<>'object' then
    raise exception 'Direct payment evidence must be an object' using errcode='22023';
  end if;

  v_state := public.record_sellertray_commercial_direct_payment_internal(
    p_tenant_id,p_commercial_order_id,p_command_id,p_payment_reference,p_payment_method,
    p_amount,p_paid_at,p_reason,p_evidence,p_actor_user_id
  );

  select io.id into v_obligation_id
  from public.sellertray_commercial_installment_obligations io
  where io.tenant_id=p_tenant_id and io.commercial_order_id=p_commercial_order_id
  order by io.created_at,io.id limit 1;
  if v_obligation_id is not null then
    perform public.reconcile_sellertray_installment_entitlement(p_tenant_id,v_obligation_id);
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values (
    p_actor_user_id,p_tenant_id,'commercial_direct_payment_confirmed',
    jsonb_build_object(
      'commercialOrderId',p_commercial_order_id,
      'commandId',p_command_id,
      'paymentReference',btrim(p_payment_reference),
      'paymentMethod',lower(btrim(p_payment_method)),
      'amount',round(p_amount::numeric,2),
      'paidAt',p_paid_at,
      'reason',btrim(p_reason)
    )
  );

  return public.get_sellertray_commercial_settlement_detail_internal(
    p_tenant_id,p_commercial_order_id
  );
end;
$$;

create or replace function public.platform_admin_publish_installment_policy_override(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_command_id uuid,
  p_scope_kind text,
  p_commercial_order_id uuid,
  p_billing_cycle text,
  p_enabled boolean,
  p_template_id uuid,
  p_effective_from timestamptz,
  p_effective_until timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_payload jsonb;
  v_existing public.sellertray_installment_policy_change_commands%rowtype;
  v_policy_id uuid;
begin
  if not public.platform_admin_has_capability(
    p_actor_user_id,'admin.installments.manage',p_tenant_id,now()
  ) then
    raise exception 'Installment management capability required' using errcode='42501';
  end if;
  if p_scope_kind not in ('tenant','commercial_order') then
    raise exception 'Settlement page supports only Business or commercial-order installment overrides'
      using errcode='22023';
  end if;
  if p_scope_kind='tenant' then
    if p_commercial_order_id is not null or p_billing_cycle not in ('monthly','yearly') then
      raise exception 'Business installment override requires monthly or yearly billing cycle and no order'
        using errcode='22023';
    end if;
  else
    if p_commercial_order_id is null or p_billing_cycle is not null then
      raise exception 'Commercial-order installment override requires an order and no billing cycle'
        using errcode='22023';
    end if;
    if not exists (
      select 1 from public.sellertray_commercial_orders o
      where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id
    ) then
      raise exception 'Commercial order not found for this Business' using errcode='P0002';
    end if;
  end if;
  if p_enabled and p_template_id is null then
    raise exception 'Enabled installment override requires a governed schedule template'
      using errcode='22023';
  end if;
  if p_template_id is not null and not exists (
    select 1 from public.sellertray_installment_schedule_templates t
    where t.id=p_template_id and t.status='published'
      and t.effective_from<=coalesce(p_effective_from,now())
      and (t.effective_until is null or t.effective_until>coalesce(p_effective_from,now()))
  ) then
    raise exception 'Installment schedule template is not active for the requested effective time'
      using errcode='23514';
  end if;
  if p_effective_from is null or (p_effective_until is not null and p_effective_until<=p_effective_from) then
    raise exception 'Installment override effective period is invalid' using errcode='22023';
  end if;
  if char_length(btrim(coalesce(p_reason,'')))<6 then
    raise exception 'Installment override reason must be at least 6 characters' using errcode='22023';
  end if;

  v_payload := jsonb_build_object(
    'scopeKind',p_scope_kind,
    'commercialOrderId',p_commercial_order_id,
    'billingCycle',p_billing_cycle,
    'enabled',p_enabled,
    'templateId',p_template_id,
    'effectiveFrom',p_effective_from,
    'effectiveUntil',p_effective_until,
    'reason',btrim(p_reason)
  );

  select c.* into v_existing
  from public.sellertray_installment_policy_change_commands c
  where c.tenant_id=p_tenant_id and c.command_id=p_command_id;
  if found then
    if v_existing.request_payload<>v_payload then
      raise exception 'Installment policy command id was already used with different input'
        using errcode='23505';
    end if;
    v_policy_id := v_existing.policy_version_id;
  else
    insert into public.sellertray_installment_policy_versions(
      scope_kind,tenant_id,commercial_order_id,plan_code,billing_cycle,
      enabled,default_template_id,effective_from,effective_until,
      created_by_user_id,change_reason
    ) values (
      p_scope_kind,p_tenant_id,p_commercial_order_id,null,p_billing_cycle,
      p_enabled,case when p_enabled then p_template_id else null end,
      p_effective_from,p_effective_until,p_actor_user_id,btrim(p_reason)
    ) returning id into v_policy_id;

    insert into public.sellertray_installment_policy_change_commands(
      tenant_id,command_id,policy_version_id,request_payload,actor_user_id
    ) values (
      p_tenant_id,p_command_id,v_policy_id,v_payload,p_actor_user_id
    );

    insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
    values (
      p_actor_user_id,p_tenant_id,'installment_policy_override_published',
      v_payload || jsonb_build_object('commandId',p_command_id,'policyVersionId',v_policy_id)
    );
  end if;

  return public.platform_admin_commercial_settlement_center(p_actor_user_id,p_tenant_id);
end;
$$;

revoke all on function public.platform_admin_record_commercial_adjustment(uuid,uuid,uuid,uuid,numeric,text,jsonb)
  from public,anon,authenticated;
revoke all on function public.platform_admin_record_commercial_direct_payment(uuid,uuid,uuid,uuid,text,text,numeric,timestamptz,text,jsonb)
  from public,anon,authenticated;
revoke all on function public.platform_admin_publish_installment_policy_override(uuid,uuid,uuid,text,uuid,text,boolean,uuid,timestamptz,timestamptz,text)
  from public,anon,authenticated;

grant execute on function public.platform_admin_record_commercial_adjustment(uuid,uuid,uuid,uuid,numeric,text,jsonb)
  to service_role;
grant execute on function public.platform_admin_record_commercial_direct_payment(uuid,uuid,uuid,uuid,text,text,numeric,timestamptz,text,jsonb)
  to service_role;
grant execute on function public.platform_admin_publish_installment_policy_override(uuid,uuid,uuid,text,uuid,text,boolean,uuid,timestamptz,timestamptz,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. Client boundaries
-- ---------------------------------------------------------------------------

alter table public.platform_admin_capability_grant_versions enable row level security;
alter table public.sellertray_installment_policy_change_commands enable row level security;

revoke all on public.platform_admin_capability_grant_versions from public,anon,authenticated;
revoke all on public.sellertray_installment_policy_change_commands from public,anon,authenticated;

grant select,insert on public.platform_admin_capability_grant_versions to service_role;
grant select,insert on public.sellertray_installment_policy_change_commands to service_role;
$oa4_source_3$;
  elsif to_regclass('public.sellertray_installment_schedule_templates') is null or to_regclass('public.platform_admin_capability_grant_versions') is null then
    raise exception 'Partially deployed onboarding foundation requires inspection before convergence';
  end if;
end;
$oa4_foundation$;

-- Source: 20261023180001_oa2_authority_repair.sql
-- Generated with Supabase CLI; version placed after the candidate's 18:00 migration.
-- Forward convergence only: preserve commercial history and runtime compatibility.

-- Locking is internal authority, not permission to update immutable orders.
create or replace function public.lock_sellertray_commercial_order(p_tenant_id uuid,p_commercial_order_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id for update;
  if not found then raise exception 'Commercial order not found for this Business' using errcode='P0002'; end if;
end;
$$;
revoke all on function public.lock_sellertray_commercial_order(uuid,uuid) from public,anon,authenticated;
grant execute on function public.lock_sellertray_commercial_order(uuid,uuid) to service_role;

create or replace function public.get_sellertray_commercial_billing_center(
  p_tenant_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_orders jsonb;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    raise exception 'Business and user are required' using errcode='22023';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if coalesce(v_role,'') not in ('owner','manager') then
    raise exception 'Merchant billing access requires an Owner or Manager' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(
    public.get_sellertray_commercial_settlement_detail_internal(p_tenant_id,o.id)
    order by o.ordered_at desc,o.id desc
  ),'[]'::jsonb)
  into v_orders
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'actorRole',v_role,
    'canPay',v_role='owner',
    'orders',v_orders,
    'generatedAt',now()
  );
end;
$$;

create or replace function public.platform_admin_commercial_settlement_center(
  p_actor_user_id uuid,
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_orders jsonb;
  v_templates jsonb;
begin
  if p_actor_user_id is null or p_tenant_id is null then
    raise exception 'Administrator and Business are required' using errcode='22023';
  end if;

  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;
  if coalesce(v_role,'') not in ('admin','support') then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;
  if not exists (select 1 from public.tenants t where t.id=p_tenant_id) then
    raise exception 'SellerTray business not found' using errcode='P0002';
  end if;

  select coalesce(jsonb_agg(
    public.get_sellertray_commercial_settlement_detail_internal(p_tenant_id,o.id)
    order by o.ordered_at desc,o.id desc
  ),'[]'::jsonb)
  into v_orders
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,
    'code',t.template_code,
    'version',t.version,
    'displayName',t.display_name,
    'status',t.status,
    'provisionalEntitlementMonths',t.provisional_entitlement_months,
    'qualifyingSettlementSequence',t.qualifying_settlement_sequence,
    'effectiveFrom',t.effective_from,
    'effectiveUntil',t.effective_until,
    'lines',coalesce((
      select jsonb_agg(jsonb_build_object(
        'sequenceNo',l.sequence_no,
        'percentage',l.percentage,
        'fixedAmount',l.fixed_amount,
        'dueOffsetDays',l.due_offset_days
      ) order by l.sequence_no)
      from public.sellertray_installment_schedule_template_lines l
      where l.template_id=t.id
    ),'[]'::jsonb)
  ) order by t.template_code,t.version desc),'[]'::jsonb)
  into v_templates
  from public.sellertray_installment_schedule_templates t
  where t.status='published'
    and t.effective_from<=now()
    and (t.effective_until is null or t.effective_until>now());

  return jsonb_build_object(
    'actorRole',v_role,
    'tenantId',p_tenant_id,
    'capabilities',jsonb_build_object(
      'canAdjust',public.platform_admin_has_capability(
        p_actor_user_id,'admin.pricing.manage',p_tenant_id,now()
      ),
      'canConfirmDirectPayment',public.platform_admin_has_capability(
        p_actor_user_id,'admin.payments.reconcile',p_tenant_id,now()
      ),
      'canManageInstallments',public.platform_admin_has_capability(
        p_actor_user_id,'admin.installments.manage',p_tenant_id,now()
      )
    ),
    'templates',v_templates,
    'orders',v_orders,
    'generatedAt',now()
  );
end;
$$;

create or replace function public.platform_admin_has_capability(
  p_actor_user_id uuid,
  p_capability_code text,
  p_tenant_id uuid default null,
  p_as_of timestamptz default now()
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_enabled boolean;
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if coalesce(v_role,'') not in ('admin','support') then
    return false;
  end if;

  select g.enabled into v_enabled
  from public.platform_admin_capability_grant_versions g
  where g.grantee_user_id=p_actor_user_id
    and g.capability_code=p_capability_code
    and g.effective_from<=p_as_of
    and (g.effective_until is null or g.effective_until>p_as_of)
    and (
      g.scope_kind='platform'
      or (g.scope_kind='tenant' and p_tenant_id is not null and g.tenant_id=p_tenant_id)
    )
  order by
    case g.scope_kind when 'tenant' then 200 else 100 end desc,
    g.effective_from desc,
    g.created_at desc
  limit 1;

  return coalesce(v_enabled,v_role='admin');
end;
$$;

create or replace function public.snapshot_sellertray_inserted_installment_contract()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_template public.sellertray_installment_schedule_templates%rowtype; v_policy jsonb; v_plan text; v_cycle text;
begin
  -- The old Admin bridge and trusted legacy import paths must establish the same
  -- immutable contract as the new materializer, including policy enforcement.
  select ps.plan_code,ps.billing_cycle into strict v_plan,v_cycle
  from public.sellertray_commercial_order_price_snapshots ps
  where ps.tenant_id=new.tenant_id and ps.commercial_order_id=new.commercial_order_id and ps.line_type='subscription';
  v_policy:=public.resolve_sellertray_installment_policy(new.tenant_id,new.commercial_order_id,v_plan,v_cycle,now());
  if not coalesce((v_policy->>'enabled')::boolean,false) then
    raise exception 'Installments are not enabled for this commercial order' using errcode='23514';
  end if;
  select t.* into strict v_template from public.sellertray_installment_schedule_templates t
  where t.template_code=new.structure_code and t.status='published'
    and t.effective_from<=now() and (t.effective_until is null or t.effective_until>now())
  order by (t.id=nullif(v_policy->>'defaultTemplateId','')::uuid) desc,t.version desc limit 1;
  insert into public.sellertray_installment_contract_snapshots(
    tenant_id,commercial_order_id,installment_obligation_id,policy_version_id,
    template_id,template_code,template_version,provisional_entitlement_months,qualifying_settlement_sequence,snapshotted_at
  ) values(new.tenant_id,new.commercial_order_id,new.id,nullif(v_policy->>'policyVersionId','')::uuid,
    v_template.id,v_template.template_code,v_template.version,v_template.provisional_entitlement_months,
    v_template.qualifying_settlement_sequence,new.created_at);
  return new;
end;
$$;
revoke all on function public.snapshot_sellertray_inserted_installment_contract() from public,anon,authenticated;
drop trigger if exists snapshot_sellertray_inserted_installment_contract on public.sellertray_commercial_installment_obligations;
create trigger snapshot_sellertray_inserted_installment_contract after insert on public.sellertray_commercial_installment_obligations
for each row execute function public.snapshot_sellertray_inserted_installment_contract();

create or replace function public.materialize_sellertray_installment_obligation_internal(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_existing public.sellertray_commercial_installment_obligations%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_plan_code text;
  v_billing_cycle text;
  v_policy jsonb;
  v_policy_id uuid;
  v_template_id uuid;
  v_template public.sellertray_installment_schedule_templates%rowtype;
  v_obligation_id uuid;
  v_line record;
  v_last_sequence integer;
  v_allocated numeric(18,2) := 0;
  v_amount numeric(18,2);
begin
  if p_tenant_id is null or p_commercial_order_id is null or p_actor_user_id is null then
    raise exception 'Business, commercial order and actor are required' using errcode='22023';
  end if;

  select o.* into v_existing
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.commercial_order_id=p_commercial_order_id;
  if found then
    return v_existing.id;
  end if;

  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id;

  select s.plan_code,s.billing_cycle
    into strict v_plan_code,v_billing_cycle
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=p_tenant_id
    and s.commercial_order_id=p_commercial_order_id
    and s.line_type='subscription';

  v_policy := public.resolve_sellertray_installment_policy(
    p_tenant_id,p_commercial_order_id,v_plan_code,v_billing_cycle,now()
  );
  if v_policy is null or not coalesce((v_policy->>'enabled')::boolean,false) then
    raise exception 'Installments are not enabled for this commercial order' using errcode='23514';
  end if;

  v_policy_id := nullif(v_policy->>'policyVersionId','')::uuid;
  v_template_id := nullif(v_policy->>'defaultTemplateId','')::uuid;
  if v_policy_id is null or v_template_id is null then
    raise exception 'Enabled installment policy has no governed schedule template' using errcode='23514';
  end if;

  select t.* into strict v_template
  from public.sellertray_installment_schedule_templates t
  where t.id=v_template_id
    and t.status='published'
    and t.effective_from<=now()
    and (t.effective_until is null or t.effective_until>now());

  if exists (
    select 1
    from public.sellertray_installment_schedule_template_lines l
    where l.template_id=v_template.id and l.percentage is null
  ) then
    raise exception 'Fixed-amount installment templates are not materializable until their order-allocation policy is approved'
      using errcode='0A000';
  end if;

  select max(l.sequence_no) into strict v_last_sequence
  from public.sellertray_installment_schedule_template_lines l
  where l.template_id=v_template.id;

  insert into public.sellertray_commercial_installment_obligations(
    tenant_id,commercial_order_id,structure_code,currency,obligated_amount,created_by_user_id
  ) values (
    p_tenant_id,p_commercial_order_id,v_template.template_code,v_order.currency,
    v_order.total_gross_amount,p_actor_user_id
  ) returning id into v_obligation_id;

  for v_line in
    select l.*
    from public.sellertray_installment_schedule_template_lines l
    where l.template_id=v_template.id
    order by l.sequence_no
  loop
    if v_line.sequence_no=v_last_sequence then
      v_amount := (v_order.total_gross_amount-v_allocated)::numeric(18,2);
    else
      v_amount := round((v_order.total_gross_amount*v_line.percentage/100)::numeric,2);
      v_allocated := (v_allocated+v_amount)::numeric(18,2);
    end if;

    insert into public.sellertray_commercial_installment_schedule(
      tenant_id,installment_obligation_id,sequence_no,percentage,amount_due,due_at
    ) values (
      p_tenant_id,v_obligation_id,v_line.sequence_no,v_line.percentage,v_amount,
      case
        when v_line.due_offset_days is null then null
        else v_order.ordered_at+make_interval(days=>v_line.due_offset_days)
      end
    );
  end loop;

  insert into public.sellertray_installment_contract_snapshots(
    tenant_id,commercial_order_id,installment_obligation_id,policy_version_id,
    template_id,template_code,template_version,provisional_entitlement_months,
    qualifying_settlement_sequence,snapshotted_at
  ) values (
    p_tenant_id,p_commercial_order_id,v_obligation_id,v_policy_id,
    v_template.id,v_template.template_code,v_template.version,
    v_template.provisional_entitlement_months,v_template.qualifying_settlement_sequence,now()
  ) on conflict (installment_obligation_id) do nothing;

  return v_obligation_id;
end;
$$;

create or replace function public.get_sellertray_commercial_settlement_state(
  p_tenant_id uuid,
  p_commercial_order_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_adjustments numeric(18,2) := 0;
  v_gateway numeric(18,2) := 0;
  v_direct numeric(18,2) := 0;
  v_net_due numeric(18,2) := 0;
  v_total_paid numeric(18,2) := 0;
  v_outstanding numeric(18,2) := 0;
  v_credit numeric(18,2) := 0;
  v_schedule jsonb := '[]'::jsonb;
  v_next_schedule_id uuid;
  v_next_payable numeric(18,2);
  v_status text;
begin
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id;

  select coalesce(sum(a.amount),0)::numeric(18,2) into v_adjustments
  from public.sellertray_commercial_adjustments a
  where a.tenant_id=p_tenant_id and a.commercial_order_id=p_commercial_order_id;

  select coalesce(sum(p.amount),0)::numeric(18,2) into v_gateway
  from public.sellertray_commercial_installment_payment_confirmations p
  where p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id;

  select coalesce(sum(p.amount),0)::numeric(18,2) into v_direct
  from public.sellertray_commercial_direct_payment_confirmations p
  where p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id;

  v_net_due := greatest(v_order.total_gross_amount-v_adjustments,0)::numeric(18,2);
  v_total_paid := (v_gateway+v_direct)::numeric(18,2);
  v_outstanding := greatest(v_net_due-v_total_paid,0)::numeric(18,2);
  v_credit := least(v_total_paid,v_net_due)::numeric(18,2);

  select o.* into v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.commercial_order_id=p_commercial_order_id;

  if found then
    with raw_lines as (
      select s.*,max(s.sequence_no) over () last_sequence,
             round(v_net_due*s.percentage/100,2)::numeric(18,2) rounded_due
      from public.sellertray_commercial_installment_schedule s
      where s.tenant_id=p_tenant_id and s.installment_obligation_id=v_obligation.id
    ), payable_lines as (
      select r.id,r.sequence_no,r.percentage,r.due_at,
        case when r.sequence_no=r.last_sequence then
          v_net_due-coalesce(sum(r.rounded_due) over (order by r.sequence_no rows between unbounded preceding and 1 preceding),0)
        else r.rounded_due end::numeric(18,2) amount_due
      from raw_lines r
    ), lines as (
      select p.*,coalesce(sum(p.amount_due) over (order by p.sequence_no rows between unbounded preceding and 1 preceding),0)::numeric(18,2) prior_due
      from payable_lines p
    ), allocated as (
      select l.*,
             least(l.amount_due,greatest(v_credit-l.prior_due,0))::numeric(18,2) as settled_amount,
             greatest(l.amount_due-least(l.amount_due,greatest(v_credit-l.prior_due,0)),0)::numeric(18,2) as remaining_amount
      from lines l
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'scheduleId',a.id,
             'sequenceNo',a.sequence_no,
             'percentage',a.percentage,
             'amountDue',a.amount_due,
             'settledAmount',a.settled_amount,
             'remainingAmount',a.remaining_amount,
             'dueAt',a.due_at,
             'settled',a.remaining_amount < 0.005
           ) order by a.sequence_no),'[]'::jsonb),
           (array_agg(a.id order by a.sequence_no) filter (where a.remaining_amount >= 0.005))[1],
           (array_agg(least(a.remaining_amount,v_outstanding)::numeric(18,2) order by a.sequence_no)
              filter (where a.remaining_amount >= 0.005))[1]
      into v_schedule,v_next_schedule_id,v_next_payable
    from allocated a;
  end if;

  if v_outstanding < 0.005 then
    v_status := 'settled';
    v_next_schedule_id := null;
    v_next_payable := 0;
  elsif v_total_paid > 0 or v_adjustments > 0 then
    v_status := 'partially_settled';
  else
    v_status := 'unsettled';
  end if;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'commercialOrderId',p_commercial_order_id,
    'currency',v_order.currency,
    'grossAmount',v_order.total_gross_amount,
    'approvedAdjustmentAmount',v_adjustments,
    'gatewayPaymentAmount',v_gateway,
    'directPaymentAmount',v_direct,
    'totalConfirmedPaymentAmount',v_total_paid,
    'netAmountDue',v_net_due,
    'outstandingAmount',v_outstanding,
    'overpaymentAmount',greatest(v_total_paid-v_net_due,0)::numeric(18,2),
    'settlementStatus',v_status,
    'installmentObligationId',v_obligation.id,
    'schedule',v_schedule,
    'nextInstallmentScheduleId',v_next_schedule_id,
    'nextPayableAmount',coalesce(v_next_payable,v_outstanding)
  );
end;
$$;

create or replace function public.prepare_sellertray_commercial_credit_fact()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_adjustments numeric(18,2);
  v_gateway numeric(18,2);
  v_direct numeric(18,2);
begin
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=new.tenant_id and o.id=new.commercial_order_id for update;

  new.currency := v_order.currency;
  new.reason := btrim(new.reason);

  select coalesce(sum(a.amount),0)::numeric(18,2) into v_adjustments
  from public.sellertray_commercial_adjustments a
  where a.tenant_id=new.tenant_id and a.commercial_order_id=new.commercial_order_id;

  select coalesce(sum(p.amount),0)::numeric(18,2) into v_gateway
  from public.sellertray_commercial_installment_payment_confirmations p
  where p.tenant_id=new.tenant_id and p.commercial_order_id=new.commercial_order_id;

  select coalesce(sum(p.amount),0)::numeric(18,2) into v_direct
  from public.sellertray_commercial_direct_payment_confirmations p
  where p.tenant_id=new.tenant_id and p.commercial_order_id=new.commercial_order_id;

  if v_adjustments+v_gateway+v_direct+new.amount > v_order.total_gross_amount + 0.004 then
    raise exception 'Commercial credits cannot exceed immutable order gross' using errcode='23514';
  end if;
  return new;
end;
$$;

create or replace function public.record_sellertray_commercial_adjustment_internal(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_command_id uuid,
  p_amount numeric,
  p_reason text,
  p_evidence jsonb,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row public.sellertray_commercial_adjustments%rowtype;
begin
  perform public.lock_sellertray_commercial_order(p_tenant_id,p_commercial_order_id);
  if p_amount is null or p_amount <= 0 then
    raise exception 'Commercial adjustment amount must be positive' using errcode='22023';
  end if;
  if nullif(btrim(p_reason),'') is null then
    raise exception 'Commercial adjustment reason is required' using errcode='22023';
  end if;

  select a.* into v_row
  from public.sellertray_commercial_adjustments a
  where a.tenant_id=p_tenant_id and a.command_id=p_command_id;

  if found then
    if v_row.commercial_order_id<>p_commercial_order_id or abs(v_row.amount-round(p_amount::numeric,2))>=0.005
       or v_row.actor_user_id is distinct from p_actor_user_id
       or v_row.reason is distinct from btrim(p_reason)
       or v_row.evidence is distinct from coalesce(p_evidence,'{}'::jsonb) then
      raise exception 'Commercial adjustment command id was already used with different input' using errcode='23505';
    end if;
  else
    insert into public.sellertray_commercial_adjustments(
      tenant_id,commercial_order_id,command_id,amount,currency,reason,evidence,actor_user_id
    )
    select p_tenant_id,p_commercial_order_id,p_command_id,round(p_amount::numeric,2),o.currency,
           btrim(p_reason),coalesce(p_evidence,'{}'::jsonb),p_actor_user_id
    from public.sellertray_commercial_orders o
    where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id
    returning * into strict v_row;
  end if;

  perform public.supersede_sellertray_stale_installment_checkouts(p_tenant_id,p_commercial_order_id);
  return public.get_sellertray_commercial_settlement_state(p_tenant_id,p_commercial_order_id);
end;
$$;

create or replace function public.record_sellertray_commercial_direct_payment_internal(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_command_id uuid,
  p_payment_reference text,
  p_payment_method text,
  p_amount numeric,
  p_paid_at timestamptz,
  p_reason text,
  p_evidence jsonb,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row public.sellertray_commercial_direct_payment_confirmations%rowtype;
begin
  perform public.lock_sellertray_commercial_order(p_tenant_id,p_commercial_order_id);
  if p_amount is null or p_amount <= 0 then
    raise exception 'Direct payment amount must be positive' using errcode='22023';
  end if;
  if nullif(btrim(p_payment_reference),'') is null or nullif(btrim(p_payment_method),'') is null then
    raise exception 'Direct payment reference and method are required' using errcode='22023';
  end if;
  if nullif(btrim(p_reason),'') is null then
    raise exception 'Direct payment reason is required' using errcode='22023';
  end if;

  select d.* into v_row
  from public.sellertray_commercial_direct_payment_confirmations d
  where d.tenant_id=p_tenant_id and d.command_id=p_command_id;

  if found then
    if v_row.commercial_order_id<>p_commercial_order_id
       or v_row.payment_reference<>btrim(p_payment_reference)
       or abs(v_row.amount-round(p_amount::numeric,2))>=0.005
       or v_row.actor_user_id is distinct from p_actor_user_id
       or v_row.reason is distinct from btrim(p_reason)
       or v_row.evidence is distinct from coalesce(p_evidence,'{}'::jsonb)
       or v_row.payment_method is distinct from lower(btrim(p_payment_method))
       or v_row.paid_at is distinct from p_paid_at then
      raise exception 'Direct payment command id was already used with different input' using errcode='23505';
    end if;
  else
    insert into public.sellertray_commercial_direct_payment_confirmations(
      tenant_id,commercial_order_id,command_id,payment_reference,payment_method,
      amount,currency,reason,evidence,actor_user_id,paid_at
    )
    select p_tenant_id,p_commercial_order_id,p_command_id,btrim(p_payment_reference),
           lower(btrim(p_payment_method)),round(p_amount::numeric,2),o.currency,btrim(p_reason),
           coalesce(p_evidence,'{}'::jsonb),p_actor_user_id,p_paid_at
    from public.sellertray_commercial_orders o
    where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id
    returning * into strict v_row;
  end if;

  perform public.supersede_sellertray_stale_installment_checkouts(p_tenant_id,p_commercial_order_id);
  return public.get_sellertray_commercial_settlement_state(p_tenant_id,p_commercial_order_id);
end;
$$;

create or replace function public.sellertray_commercial_agreement_terms_current(p_agreement_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select coalesce((a.commercial_snapshot->'settlementTerms'->>'approvedAdjustmentAmount')::numeric,0)
       = coalesce((select sum(d.amount) from public.sellertray_commercial_adjustments d
                   where d.tenant_id=a.tenant_id and d.commercial_order_id=a.commercial_order_id),0)
  from public.sellertray_commercial_agreements a where a.id=p_agreement_id;
$$;
revoke all on function public.sellertray_commercial_agreement_terms_current(uuid) from public,anon,authenticated;
grant execute on function public.sellertray_commercial_agreement_terms_current(uuid) to service_role;

create or replace function public.build_sellertray_commercial_agreement_snapshot(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_installment_obligation_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_tenant public.tenants%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_lines jsonb;
  v_schedule jsonb;
  v_settlement jsonb;
begin
  select t.* into strict v_tenant
  from public.tenants t
  where t.id=p_tenant_id;

  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'line_no',s.line_no,
    'line_type',s.line_type,
    'source_price_version_id',s.source_price_version_id,
    'plan_code',s.plan_code,
    'branch_id',s.branch_id,
    'billing_cycle',s.billing_cycle,
    'description',s.description_snapshot,
    'quantity',s.quantity,
    'currency',s.currency,
    'unit_gross_amount',s.unit_gross_amount,
    'gross_amount',s.gross_amount,
    'net_amount',s.net_amount,
    'tax_rate_percent',s.tax_rate_percent,
    'tax_amount',s.tax_amount
  ) order by s.line_no),'[]'::jsonb)
  into v_lines
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=p_tenant_id and s.commercial_order_id=p_commercial_order_id;

  if p_installment_obligation_id is not null then
    select o.* into strict v_obligation
    from public.sellertray_commercial_installment_obligations o
    where o.tenant_id=p_tenant_id
      and o.commercial_order_id=p_commercial_order_id
      and o.id=p_installment_obligation_id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'sequence_no',s.sequence_no,
      'percentage',s.percentage,
      'amount_due',s.amount_due,
      'due_at',s.due_at
    ) order by s.sequence_no),'[]'::jsonb)
    into v_schedule
    from public.sellertray_commercial_installment_schedule s
    where s.tenant_id=p_tenant_id
      and s.installment_obligation_id=p_installment_obligation_id;
  else
    v_schedule := null;
  end if;

  v_settlement:=public.get_sellertray_commercial_settlement_state(p_tenant_id,p_commercial_order_id);
  if p_installment_obligation_id is not null then
    select jsonb_agg(jsonb_build_object('sequence_no',x->'sequenceNo','percentage',x->'percentage','amount_due',x->'amountDue','due_at',x->'dueAt') order by (x->>'sequenceNo')::integer)
      into v_schedule from jsonb_array_elements(v_settlement->'schedule') x;
  end if;
  return jsonb_build_object(
    'settlementTerms',jsonb_build_object('approvedAdjustmentAmount',v_settlement->'approvedAdjustmentAmount','netAmountDue',v_settlement->'netAmountDue'),
    'merchant',jsonb_build_object(
      'tenant_id',v_tenant.id,
      'merchant_code',v_tenant.merchant_code,
      'business_name',v_tenant.name,
      'business_email',v_tenant.business_email,
      'business_phone',v_tenant.business_phone,
      'business_type',v_tenant.business_type
    ),
    'commercial_order_id',v_order.id,
    'order_reference',v_order.order_reference,
    'currency',v_order.currency,
    'total_gross_amount',v_order.total_gross_amount,
    'ordered_at',v_order.ordered_at,
    'price_snapshots',v_lines,
    'installment',case when p_installment_obligation_id is null then null else jsonb_build_object(
      'installment_obligation_id',v_obligation.id,
      'structure_code',v_obligation.structure_code,
      'currency',v_obligation.currency,
      'obligated_amount',v_obligation.obligated_amount,
      'schedule',v_schedule
    ) end
  );
end;
$$;

create or replace function public.accept_sellertray_commercial_agreement(
  p_tenant_id uuid,
  p_agreement_id uuid,
  p_accepted_legal_name text,
  p_request_evidence jsonb,
  p_command_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_role text;
  v_agreement public.sellertray_commercial_agreements%rowtype;
  v_existing public.sellertray_commercial_agreement_acceptances%rowtype;
  v_id uuid;
  v_name text := btrim(coalesce(p_accepted_legal_name,''));
  v_evidence jsonb := coalesce(p_request_evidence,'{}'::jsonb);
begin
  if p_tenant_id is null or p_agreement_id is null or p_actor_user_id is null or p_command_id is null then
    raise exception 'Business, agreement, accepting user and command are required' using errcode='22023';
  end if;
  if jsonb_typeof(v_evidence)<>'object' then
    raise exception 'Agreement acceptance evidence must be an object' using errcode='22023';
  end if;
  if char_length(v_name) not between 1 and 200 then
    raise exception 'Enter the authorised representative legal name' using errcode='22023';
  end if;

  -- A committed command is immutable historical evidence. Returning an exact
  -- replay is not a new signing act, so later capability revocation or document
  -- supersession must not turn the committed command into a failure.
  select a.* into v_existing
  from public.sellertray_commercial_agreement_acceptances a
  where a.tenant_id=p_tenant_id and a.command_id=p_command_id;

  if found then
    if v_existing.agreement_id<>p_agreement_id
       or v_existing.accepted_by_user_id<>p_actor_user_id
       or v_existing.accepted_legal_name<>v_name
       or v_existing.acceptance_method<>'merchant_web_authenticated'
       or v_existing.request_evidence->>'channel' is distinct from v_evidence->>'channel'
       or v_existing.request_evidence->>'authority_confirmed' is distinct from v_evidence->>'authority_confirmed' then
      raise exception 'Agreement acceptance command is already used for different facts' using errcode='23505';
    end if;
    return v_existing.id;
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;

  if v_role='owner' then
    null;
  elsif v_role='manager' and public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_accept_commercial_agreements'
  ) then
    null;
  else
    raise exception 'You are not authorised to accept SellerTray commercial agreements' using errcode='42501';
  end if;

  select a.* into strict v_agreement
  from public.sellertray_commercial_agreements a
  where a.tenant_id=p_tenant_id and a.id=p_agreement_id;

  perform public.lock_sellertray_commercial_order(p_tenant_id,v_agreement.commercial_order_id);
  if not coalesce(public.sellertray_commercial_agreement_terms_current(v_agreement.id),false) then
    raise exception 'Commercial terms changed. Ask ProcessEdge to issue a replacement agreement before accepting.' using errcode='23514';
  end if;
  if exists (
    select 1 from public.sellertray_commercial_agreements r
    where r.tenant_id=p_tenant_id and r.supersedes_agreement_id=v_agreement.id
  ) then
    raise exception 'This SellerTray agreement has been replaced and cannot be accepted' using errcode='23514';
  end if;

  insert into public.sellertray_commercial_agreement_acceptances(
    tenant_id,agreement_id,template_version_id,template_version_code,
    template_content_sha256,agreement_content_sha256,accepted_by_user_id,
    accepted_legal_name,accepted_role,acceptance_method,request_evidence,
    command_id,accepted_at,created_at
  ) values (
    p_tenant_id,v_agreement.id,v_agreement.template_version_id,v_agreement.template_version_code,
    v_agreement.template_content_sha256,v_agreement.content_sha256,p_actor_user_id,
    v_name,v_role,'merchant_web_authenticated',v_evidence,p_command_id,now(),now()
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  -- Concurrent reuse of the same command is valid only for the same stable
  -- acceptance facts. The first recorded transport evidence remains immutable.
  select a.* into v_existing
  from public.sellertray_commercial_agreement_acceptances a
  where a.tenant_id=p_tenant_id and a.command_id=p_command_id;

  if found then
    if v_existing.agreement_id<>v_agreement.id
       or v_existing.template_version_id<>v_agreement.template_version_id
       or v_existing.template_content_sha256<>v_agreement.template_content_sha256
       or v_existing.agreement_content_sha256<>v_agreement.content_sha256
       or v_existing.accepted_by_user_id<>p_actor_user_id
       or v_existing.accepted_legal_name<>v_name
       or v_existing.accepted_role<>v_role
       or v_existing.acceptance_method<>'merchant_web_authenticated'
       or v_existing.request_evidence->>'channel' is distinct from v_evidence->>'channel'
       or v_existing.request_evidence->>'authority_confirmed' is distinct from v_evidence->>'authority_confirmed' then
      raise exception 'Agreement acceptance command is already used for different facts' using errcode='23505';
    end if;
    return v_existing.id;
  end if;

  -- A client may lose the successful response and reload, losing its in-memory
  -- command ID. Because an agreement version can be accepted only once, a new
  -- command may recover that result only while the signer is still authorised
  -- and every immutable signer/document/stable-acceptance fact is identical.
  select a.* into strict v_existing
  from public.sellertray_commercial_agreement_acceptances a
  where a.tenant_id=p_tenant_id and a.agreement_id=v_agreement.id;

  if v_existing.template_version_id<>v_agreement.template_version_id
     or v_existing.template_content_sha256<>v_agreement.template_content_sha256
     or v_existing.agreement_content_sha256<>v_agreement.content_sha256
     or v_existing.accepted_by_user_id<>p_actor_user_id
     or v_existing.accepted_legal_name<>v_name
     or v_existing.accepted_role<>v_role
     or v_existing.acceptance_method<>'merchant_web_authenticated'
     or v_existing.request_evidence->>'channel' is distinct from v_evidence->>'channel'
     or v_existing.request_evidence->>'authority_confirmed' is distinct from v_evidence->>'authority_confirmed' then
    raise exception 'SellerTray agreement is already accepted with different acceptance facts'
      using errcode='23505';
  end if;

  return v_existing.id;
end;
$$;

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
      and public.sellertray_commercial_agreement_terms_current(a.id)
      and not exists (
        select 1
        from public.sellertray_commercial_agreements replacement
        where replacement.tenant_id=a.tenant_id
          and replacement.supersedes_agreement_id=a.id
      )
  );
$$;

create or replace function public.get_sellertray_installment_contract_checkout_policy(
  p_tenant_id uuid,
  p_installment_obligation_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_snapshot public.sellertray_installment_contract_snapshots%rowtype;
  v_plan_code text;
  v_billing_cycle text;
  v_accepted_at timestamptz;
  v_policy jsonb;
  v_policy_enabled boolean := false;
  v_policy_template_id uuid;
begin
  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.id=p_installment_obligation_id;

  select s.* into strict v_snapshot
  from public.sellertray_installment_contract_snapshots s
  where s.tenant_id=p_tenant_id and s.installment_obligation_id=v_obligation.id;

  select s.plan_code,s.billing_cycle
    into strict v_plan_code,v_billing_cycle
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=p_tenant_id
    and s.commercial_order_id=v_obligation.commercial_order_id
    and s.line_type='subscription';

  select ac.accepted_at into v_accepted_at
  from public.sellertray_commercial_agreements a
  join public.sellertray_commercial_agreement_acceptances ac
    on ac.tenant_id=a.tenant_id and ac.agreement_id=a.id
  where a.tenant_id=p_tenant_id
    and a.commercial_order_id=v_obligation.commercial_order_id
    and a.installment_obligation_id=v_obligation.id
    and a.agreement_family='installment_agreement'
    and public.sellertray_commercial_agreement_terms_current(a.id)
    and not exists (
      select 1
      from public.sellertray_commercial_agreements replacement
      where replacement.tenant_id=a.tenant_id
        and replacement.supersedes_agreement_id=a.id
    )
  order by ac.accepted_at desc
  limit 1;

  v_policy := public.resolve_sellertray_installment_policy(
    p_tenant_id,v_obligation.commercial_order_id,v_plan_code,v_billing_cycle,p_as_of
  );
  v_policy_enabled := coalesce((v_policy->>'enabled')::boolean,false);
  v_policy_template_id := nullif(v_policy->>'defaultTemplateId','')::uuid;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'commercialOrderId',v_obligation.commercial_order_id,
    'installmentObligationId',v_obligation.id,
    'planCode',v_plan_code,
    'billingCycle',v_billing_cycle,
    'agreementAccepted',v_accepted_at is not null,
    'agreementAcceptedAt',v_accepted_at,
    'contractTemplateId',v_snapshot.template_id,
    'contractTemplateCode',v_snapshot.template_code,
    'contractTemplateVersion',v_snapshot.template_version,
    'currentPolicy',v_policy,
    'draftEligible',v_policy_enabled and v_policy_template_id=v_snapshot.template_id,
    'checkoutEligible',v_accepted_at is not null
  );
end;
$$;

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
    and public.sellertray_commercial_agreement_terms_current(a.id)
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
           'amountDue',(select (x->>'amountDue')::numeric from jsonb_array_elements(v_settlement->'schedule') x where (x->>'scheduleId')::uuid=sch.id),
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
  elsif v_setup_required=0 or v_setup_ready<v_setup_required then
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
    'setupReady',v_setup_required>0 and v_setup_ready=v_setup_required,
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
  perform public.lock_sellertray_commercial_order(io.tenant_id,io.commercial_order_id)
  from public.sellertray_commercial_installment_obligations io where io.tenant_id=p_tenant_id and io.id=p_installment_obligation_id;
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
    and public.sellertray_commercial_agreement_terms_current(a.id)
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
     or v_setup_required=0 or v_setup_ready<v_setup_required
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
  v_settlement jsonb;
  v_billing jsonb;
  v_direct_payment_amount numeric(18,2):=0;
  v_policy jsonb;
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
        and public.sellertray_commercial_agreement_terms_current(a.id)
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

    v_settlement:=public.get_sellertray_commercial_settlement_state(p_tenant_id,v_order.id);
    v_policy:=public.resolve_sellertray_installment_policy(p_tenant_id,v_order.id,v_plan_code,v_billing_cycle,now());
    v_approved_adjustment_amount:=(v_settlement->>'approvedAdjustmentAmount')::numeric;
    v_direct_payment_amount:=(v_settlement->>'directPaymentAmount')::numeric;
    v_confirmed_payment_amount:=(v_settlement->>'totalConfirmedPaymentAmount')::numeric;
    v_outstanding_amount:=(v_settlement->>'outstandingAmount')::numeric;
    v_fully_settled:=v_outstanding_amount<0.005;
    if v_obligation.id is not null then
      v_billing:=public.get_sellertray_installment_billing_state(p_tenant_id,v_obligation.id);
      v_qualifying_settlement:=coalesce((v_billing->>'qualifyingSettlementSatisfied')::boolean,false);
      v_paid_schedule_count:=(v_billing->>'paidInstallmentCount')::integer;
      v_first_installment_amount:=(v_settlement->'schedule'->0->>'amountDue')::numeric;
      v_first_paid_at:=(v_billing->>'firstPaidAt')::timestamptz;
    else
      v_qualifying_settlement:=v_fully_settled;
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
      'gatewayPaymentAmount',coalesce((v_settlement->>'gatewayPaymentAmount')::numeric,0),
      'directPaymentAmount',v_direct_payment_amount,
      'confirmedPaymentAmount',v_confirmed_payment_amount,
      'outstandingAmount',v_outstanding_amount,
      'qualifyingSettlementSatisfied',v_qualifying_settlement,
      'fullySettled',v_fully_settled,
      'installmentCount',v_schedule_count,
      'paidInstallmentCount',v_paid_schedule_count,
      'firstInstallmentAmount',v_first_installment_amount,
      'firstPaidAt',v_first_paid_at
    ),
    'installmentPolicy',v_policy,
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

create or replace function public.platform_admin_record_commercial_adjustment(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_command_id uuid,
  p_amount numeric,
  p_reason text,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_obligation_id uuid;
  v_state jsonb;
begin
  if not public.platform_admin_has_capability(
    p_actor_user_id,'admin.pricing.manage',p_tenant_id,now()
  ) then
    raise exception 'Commercial pricing capability required' using errcode='42501';
  end if;
  if char_length(btrim(coalesce(p_reason,'')))<6 then
    raise exception 'Adjustment reason must be at least 6 characters' using errcode='22023';
  end if;
  if p_evidence is null or jsonb_typeof(p_evidence)<>'object' then
    raise exception 'Adjustment evidence must be an object' using errcode='22023';
  end if;

  v_state := public.record_sellertray_commercial_adjustment_internal(
    p_tenant_id,p_commercial_order_id,p_command_id,p_amount,p_reason,p_evidence,p_actor_user_id
  );

  select io.id into v_obligation_id
  from public.sellertray_commercial_installment_obligations io
  where io.tenant_id=p_tenant_id and io.commercial_order_id=p_commercial_order_id
  order by io.created_at,io.id limit 1;
  if v_obligation_id is not null then
    begin
      perform public.reconcile_sellertray_installment_entitlement(p_tenant_id,v_obligation_id);
    exception when others then
      insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
      values(p_actor_user_id,p_tenant_id,'commercial_reconciliation_pending',jsonb_build_object('commercialOrderId',p_commercial_order_id,'commandId',p_command_id,'error',sqlerrm));
    end;
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values (
    p_actor_user_id,p_tenant_id,'commercial_adjustment_recorded',
    jsonb_build_object(
      'commercialOrderId',p_commercial_order_id,
      'commandId',p_command_id,
      'amount',round(p_amount::numeric,2),
      'reason',btrim(p_reason)
    )
  );

  return public.get_sellertray_commercial_settlement_detail_internal(
    p_tenant_id,p_commercial_order_id
  );
end;
$$;

create or replace function public.platform_admin_record_commercial_direct_payment(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_command_id uuid,
  p_payment_reference text,
  p_payment_method text,
  p_amount numeric,
  p_paid_at timestamptz,
  p_reason text,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_obligation_id uuid;
  v_state jsonb;
begin
  if not public.platform_admin_has_capability(
    p_actor_user_id,'admin.payments.reconcile',p_tenant_id,now()
  ) then
    raise exception 'Payment reconciliation capability required' using errcode='42501';
  end if;
  if char_length(btrim(coalesce(p_reason,'')))<6 then
    raise exception 'Direct payment reason must be at least 6 characters' using errcode='22023';
  end if;
  if p_paid_at is null or p_paid_at>now()+interval '5 minutes' then
    raise exception 'Direct payment time is invalid' using errcode='22023';
  end if;
  if p_evidence is null or jsonb_typeof(p_evidence)<>'object' then
    raise exception 'Direct payment evidence must be an object' using errcode='22023';
  end if;

  v_state := public.record_sellertray_commercial_direct_payment_internal(
    p_tenant_id,p_commercial_order_id,p_command_id,p_payment_reference,p_payment_method,
    p_amount,p_paid_at,p_reason,p_evidence,p_actor_user_id
  );

  select io.id into v_obligation_id
  from public.sellertray_commercial_installment_obligations io
  where io.tenant_id=p_tenant_id and io.commercial_order_id=p_commercial_order_id
  order by io.created_at,io.id limit 1;
  if v_obligation_id is not null then
    begin
      perform public.reconcile_sellertray_installment_entitlement(p_tenant_id,v_obligation_id);
    exception when others then
      insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
      values(p_actor_user_id,p_tenant_id,'commercial_reconciliation_pending',jsonb_build_object('commercialOrderId',p_commercial_order_id,'commandId',p_command_id,'error',sqlerrm));
    end;
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values (
    p_actor_user_id,p_tenant_id,'commercial_direct_payment_confirmed',
    jsonb_build_object(
      'commercialOrderId',p_commercial_order_id,
      'commandId',p_command_id,
      'paymentReference',btrim(p_payment_reference),
      'paymentMethod',lower(btrim(p_payment_method)),
      'amount',round(p_amount::numeric,2),
      'paidAt',p_paid_at,
      'reason',btrim(p_reason)
    )
  );

  return public.get_sellertray_commercial_settlement_detail_internal(
    p_tenant_id,p_commercial_order_id
  );
end;
$$;

create or replace function public.supersede_sellertray_stale_installment_checkouts(
  p_tenant_id uuid,
  p_commercial_order_id uuid
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_state jsonb;
  v_next_schedule_id uuid;
  v_next_amount numeric(18,2);
  v_outstanding numeric(18,2);
  v_count integer;
begin
  perform public.lock_sellertray_commercial_order(p_tenant_id,p_commercial_order_id);
  v_state := public.get_sellertray_commercial_settlement_state(p_tenant_id,p_commercial_order_id);
  v_next_schedule_id := nullif(v_state->>'nextInstallmentScheduleId','')::uuid;
  v_next_amount := coalesce((v_state->>'nextPayableAmount')::numeric,0);
  v_outstanding := coalesce((v_state->>'outstandingAmount')::numeric,0);

  update public.billing_checkout_sessions s
  set status='superseded'
  where s.tenant_id=p_tenant_id
    and s.commercial_order_id=p_commercial_order_id
    and s.checkout_kind='installment'
    and s.status in ('preparing','initialized')
    and (
      v_outstanding < 0.005
      or v_next_schedule_id is null
      or s.installment_schedule_id <> v_next_schedule_id
      or abs(coalesce(s.amount,0)-v_next_amount) >= 0.005
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.reserve_sellertray_installment_checkout(
  p_tenant_id uuid,
  p_installment_schedule_id uuid,
  p_command_id uuid,
  p_actor_user_id uuid,
  p_billing_email text
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_role text;
  v_email text := lower(btrim(coalesce(p_billing_email,'')));
  v_schedule public.sellertray_commercial_installment_schedule%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_plan_code text;
  v_contract jsonb;
  v_state jsonb;
  v_next_schedule_id uuid;
  v_next_amount numeric(18,2);
  v_existing public.billing_checkout_sessions%rowtype;
  v_reference text;
  v_session public.billing_checkout_sessions%rowtype;
begin
  if p_tenant_id is null or p_installment_schedule_id is null
     or p_command_id is null or p_actor_user_id is null then
    raise exception 'Business, installment, command and user are required' using errcode='22023';
  end if;
  if char_length(v_email) not between 3 and 320 or position('@' in v_email)=0 then
    raise exception 'A valid billing email is required' using errcode='22023';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if v_role is distinct from 'owner' then
    raise exception 'Only the business Owner can start installment billing' using errcode='42501';
  end if;

  select sch.* into strict v_schedule
  from public.sellertray_commercial_installment_schedule sch
  where sch.tenant_id=p_tenant_id and sch.id=p_installment_schedule_id;
  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.id=v_schedule.installment_obligation_id;
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=v_obligation.commercial_order_id;
  select s.plan_code into strict v_plan_code
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=p_tenant_id and s.commercial_order_id=v_order.id and s.line_type='subscription';

  perform public.lock_sellertray_commercial_order(p_tenant_id,v_order.id);
  v_contract := public.get_sellertray_installment_contract_checkout_policy(
    p_tenant_id,v_obligation.id,now()
  );
  if not coalesce((v_contract->>'agreementAccepted')::boolean,false) then
    raise exception 'The current installment agreement must be accepted before checkout'
      using errcode='23514';
  end if;

  perform public.supersede_sellertray_stale_installment_checkouts(p_tenant_id,v_order.id);
  v_state := public.get_sellertray_commercial_settlement_state(p_tenant_id,v_order.id);
  v_next_schedule_id := nullif(v_state->>'nextInstallmentScheduleId','')::uuid;
  v_next_amount := coalesce((v_state->>'nextPayableAmount')::numeric,0);

  if coalesce((v_state->>'outstandingAmount')::numeric,0)<0.005 then
    return jsonb_build_object(
      'status','paid','installmentScheduleId',p_installment_schedule_id,
      'amount',0,'currency',v_obligation.currency,'planCode',v_plan_code,
      'needsProviderInitialization',false
    );
  end if;

  select s.* into v_existing
  from public.billing_checkout_sessions s
  where s.tenant_id=p_tenant_id and s.checkout_kind='installment' and s.command_id=p_command_id;
  if found then
    if v_existing.installment_schedule_id<>v_schedule.id
       or v_existing.requested_by_user_id<>p_actor_user_id
       or lower(v_existing.billing_email)<>v_email then
      raise exception 'Installment checkout command is already used for different facts'
        using errcode='23505';
    end if;
    return jsonb_build_object(
      'sessionId',v_existing.id,'status',v_existing.status,'reference',v_existing.reference,
      'authorizationUrl',v_existing.authorization_url,
      'installmentScheduleId',v_existing.installment_schedule_id,'amount',v_existing.amount,
      'currency',v_existing.currency,'planCode',v_existing.plan_code,
      'needsProviderInitialization',v_existing.status='preparing' and v_existing.authorization_url is null
    );
  end if;

  if v_next_schedule_id is distinct from p_installment_schedule_id then
    raise exception 'Selected installment is not the current authoritative payable schedule'
      using errcode='23514';
  end if;

  select s.* into v_existing
  from public.billing_checkout_sessions s
  where s.tenant_id=p_tenant_id and s.checkout_kind='installment'
    and s.installment_schedule_id=v_schedule.id
    and s.status in ('preparing','initialized','paid')
  order by s.created_at desc
  limit 1;
  if found then
    return jsonb_build_object(
      'sessionId',v_existing.id,'status',v_existing.status,'reference',v_existing.reference,
      'authorizationUrl',v_existing.authorization_url,
      'installmentScheduleId',v_existing.installment_schedule_id,'amount',v_existing.amount,
      'currency',v_existing.currency,'planCode',v_existing.plan_code,
      'needsProviderInitialization',false
    );
  end if;

  v_reference := 'sti-'||substr(replace(p_tenant_id::text,'-',''),1,8)
    ||'-'||replace(p_command_id::text,'-','');

  insert into public.billing_checkout_sessions(
    tenant_id,plan_code,requested_by_user_id,billing_email,provider,reference,
    status,checkout_kind,command_id,commercial_order_id,installment_obligation_id,
    installment_schedule_id,amount,currency,created_at,updated_at
  ) values (
    p_tenant_id,v_plan_code,p_actor_user_id,v_email,'paystack',v_reference,
    'preparing','installment',p_command_id,v_order.id,v_obligation.id,
    v_schedule.id,v_next_amount,v_obligation.currency,now(),now()
  ) returning * into v_session;

  return jsonb_build_object(
    'sessionId',v_session.id,'status',v_session.status,'reference',v_session.reference,
    'authorizationUrl',v_session.authorization_url,
    'installmentScheduleId',v_session.installment_schedule_id,'amount',v_session.amount,
    'currency',v_session.currency,'planCode',v_session.plan_code,
    'needsProviderInitialization',true
  );
end;
$$;

create or replace function public.begin_sellertray_installment_checkout_initialization(
  p_session_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_session public.billing_checkout_sessions%rowtype;
begin
  if p_session_id is null then
    raise exception 'Installment checkout session is required' using errcode='22023';
  end if;

  perform public.lock_sellertray_commercial_order(b.tenant_id,b.commercial_order_id) from public.billing_checkout_sessions b where b.id=p_session_id;
  select s.* into strict v_session
  from public.billing_checkout_sessions s
  where s.id=p_session_id and s.checkout_kind='installment';
  perform public.supersede_sellertray_stale_installment_checkouts(v_session.tenant_id,v_session.commercial_order_id);

  select s.* into strict v_session
  from public.billing_checkout_sessions s
  where s.id=p_session_id and s.checkout_kind='installment'
  for update;

  if v_session.status='initialized' and v_session.authorization_url is not null then
    return jsonb_build_object('started',false,'status','initialized','reference',v_session.reference,
      'authorizationUrl',v_session.authorization_url,'startedAt',v_session.provider_initialization_started_at);
  end if;
  if v_session.status in ('failed','superseded') then
    return jsonb_build_object('started',false,'status',v_session.status,'reference',v_session.reference,
      'authorizationUrl',v_session.authorization_url,'startedAt',v_session.provider_initialization_started_at);
  end if;
  if v_session.status<>'preparing' then
    raise exception 'Installment checkout cannot begin provider initialization from its current state'
      using errcode='23514';
  end if;
  if v_session.authorization_url is not null then
    raise exception 'Preparing installment checkout cannot already have a provider authorization URL'
      using errcode='23505';
  end if;
  if v_session.provider_initialization_started_at is not null then
    return jsonb_build_object('started',false,'status','in_progress','reference',v_session.reference,
      'authorizationUrl',null,'startedAt',v_session.provider_initialization_started_at);
  end if;

  update public.billing_checkout_sessions
  set provider_initialization_started_at=now(),updated_at=now()
  where id=v_session.id
  returning * into v_session;

  return jsonb_build_object('started',true,'status','in_progress','reference',v_session.reference,
    'authorizationUrl',null,'startedAt',v_session.provider_initialization_started_at);
end;
$$;

create or replace function public.complete_sellertray_installment_checkout_initialization(
  p_session_id uuid,
  p_provider_reference text,
  p_authorization_url text
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_session public.billing_checkout_sessions%rowtype;
  v_reference text := btrim(coalesce(p_provider_reference,''));
  v_url text := btrim(coalesce(p_authorization_url,''));
begin
  perform public.lock_sellertray_commercial_order(b.tenant_id,b.commercial_order_id) from public.billing_checkout_sessions b where b.id=p_session_id;
  select s.* into strict v_session
  from public.billing_checkout_sessions s
  where s.id=p_session_id and s.checkout_kind='installment';
  perform public.supersede_sellertray_stale_installment_checkouts(v_session.tenant_id,v_session.commercial_order_id);

  select s.* into strict v_session
  from public.billing_checkout_sessions s
  where s.id=p_session_id and s.checkout_kind='installment'
  for update;

  if v_session.status='superseded' then
    raise exception 'Installment checkout was superseded by newer commercial settlement facts'
      using errcode='23514';
  end if;
  if v_reference<>v_session.reference then
    raise exception 'Billing provider reference does not match reserved installment checkout'
      using errcode='23514';
  end if;
  if char_length(v_url) not between 1 and 4000 then
    raise exception 'Billing provider returned no checkout URL' using errcode='22023';
  end if;

  if v_session.status='initialized' then
    if v_session.authorization_url is distinct from v_url then
      raise exception 'Installment checkout was already initialized with different provider facts'
        using errcode='23505';
    end if;
  elsif v_session.status='preparing' then
    if v_session.provider_initialization_started_at is null then
      raise exception 'Installment checkout provider initialization was not begun'
        using errcode='23514';
    end if;
    update public.billing_checkout_sessions
    set authorization_url=v_url,status='initialized',updated_at=now()
    where id=v_session.id;
  else
    raise exception 'Installment checkout cannot be initialized from its current state'
      using errcode='23514';
  end if;

  return jsonb_build_object('sessionId',v_session.id,'reference',v_session.reference,
    'authorizationUrl',v_url,'status','initialized');
end;
$$;

create or replace function public.confirm_sellertray_installment_payment_from_checkout(
  p_checkout_session_id uuid,
  p_provider_reference text,
  p_provider_transaction_ref text,
  p_amount numeric,
  p_currency text,
  p_paid_at timestamptz,
  p_provider_event_fingerprint text
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_session public.billing_checkout_sessions%rowtype;
  v_existing public.sellertray_commercial_installment_payment_confirmations%rowtype;
  v_state jsonb;
  v_next_schedule_id uuid;
  v_next_amount numeric(18,2);
  v_id uuid;
  v_provider_reference text := btrim(coalesce(p_provider_reference,''));
  v_transaction_ref text := nullif(btrim(coalesce(p_provider_transaction_ref,'')),'');
  v_currency text := upper(btrim(coalesce(p_currency,'')));
  v_fingerprint text := btrim(coalesce(p_provider_event_fingerprint,''));
begin
  if p_checkout_session_id is null or p_amount is null or p_paid_at is null then
    raise exception 'Installment checkout, amount and payment time are required' using errcode='22023';
  end if;

  perform public.lock_sellertray_commercial_order(b.tenant_id,b.commercial_order_id) from public.billing_checkout_sessions b where b.id=p_checkout_session_id;
  select s.* into strict v_session
  from public.billing_checkout_sessions s
  where s.id=p_checkout_session_id and s.checkout_kind='installment'
  for update;

  if v_provider_reference<>v_session.reference
     or v_currency<>v_session.currency
     or abs(p_amount-v_session.amount)>=0.005 then
    raise exception 'Confirmed installment payment does not match the reserved amount, currency and reference'
      using errcode='23514';
  end if;
  if char_length(v_fingerprint) not between 16 and 256 then
    raise exception 'Verified provider event fingerprint is required' using errcode='22023';
  end if;

  select pc.* into v_existing
  from public.sellertray_commercial_installment_payment_confirmations pc
  where pc.billing_checkout_session_id=v_session.id;
  if found then
    if v_existing.provider_reference<>v_provider_reference
       or v_existing.provider_transaction_ref is distinct from v_transaction_ref
       or v_existing.provider_event_fingerprint<>v_fingerprint
       or abs(v_existing.amount-p_amount)>=0.005
       or v_existing.currency<>v_currency
       or v_existing.paid_at<>p_paid_at then
      raise exception 'Installment payment checkout is already confirmed with different provider facts'
        using errcode='23505';
    end if;
    return v_existing.id;
  end if;

  perform public.supersede_sellertray_stale_installment_checkouts(
    v_session.tenant_id,v_session.commercial_order_id
  );
  select s.* into strict v_session
  from public.billing_checkout_sessions s
  where s.id=p_checkout_session_id
  for update;

  if v_session.status not in ('preparing','initialized') then
    raise exception 'Installment checkout cannot be confirmed from its current state'
      using errcode='23514';
  end if;
  if v_session.provider_initialization_started_at is null then
    raise exception 'Installment checkout provider initialization was not begun'
      using errcode='23514';
  end if;

  v_state := public.get_sellertray_commercial_settlement_state(
    v_session.tenant_id,v_session.commercial_order_id
  );
  v_next_schedule_id := nullif(v_state->>'nextInstallmentScheduleId','')::uuid;
  v_next_amount := coalesce((v_state->>'nextPayableAmount')::numeric,0);
  if v_next_schedule_id is distinct from v_session.installment_schedule_id
     or abs(v_next_amount-v_session.amount)>=0.005 then
    update public.billing_checkout_sessions set status='superseded',updated_at=now()
    where id=v_session.id;
    raise exception 'Installment checkout was superseded by newer commercial settlement facts'
      using errcode='23514';
  end if;

  if exists (
    select 1 from public.sellertray_commercial_installment_payment_confirmations pc
    where pc.tenant_id=v_session.tenant_id
      and pc.installment_schedule_id=v_session.installment_schedule_id
  ) then
    raise exception 'SellerTray installment is already paid by another provider transaction'
      using errcode='23505';
  end if;

  insert into public.sellertray_commercial_installment_payment_confirmations(
    tenant_id,commercial_order_id,installment_obligation_id,installment_schedule_id,
    billing_checkout_session_id,provider,provider_reference,provider_transaction_ref,
    provider_event_fingerprint,amount,currency,paid_at,recorded_at
  ) values (
    v_session.tenant_id,v_session.commercial_order_id,v_session.installment_obligation_id,
    v_session.installment_schedule_id,v_session.id,v_session.provider,v_provider_reference,
    v_transaction_ref,v_fingerprint,p_amount,v_currency,p_paid_at,now()
  ) returning id into v_id;

  update public.billing_checkout_sessions
  set status='paid',updated_at=now()
  where id=v_session.id;

  return v_id;
end;
$$;

create or replace function public.get_sellertray_commercial_agreement_center(
  p_tenant_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_role text;
  v_can_accept boolean;
  v_agreements jsonb;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    raise exception 'Business and user are required' using errcode='22023';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;

  if coalesce(v_role,'') not in ('owner','manager') then
    raise exception 'Merchant agreement access requires an Owner or Manager' using errcode='42501';
  end if;

  v_can_accept := public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_accept_commercial_agreements'
  );

  select coalesce(jsonb_agg(row_value order by is_current desc,issued_at desc,agreement_id),'[]'::jsonb)
  into v_agreements
  from (
    select
      a.id as agreement_id,
      a.issued_at,
      not exists (
        select 1
        from public.sellertray_commercial_agreements replacement
        where replacement.tenant_id=a.tenant_id
          and replacement.supersedes_agreement_id=a.id
      ) as is_current,
      jsonb_build_object(
        'id',a.id,
        'reference',a.agreement_reference,
        'family',a.agreement_family,
        'title',t.title,
        'templateVersion',a.template_version_code,
        'templateContentSha256',a.template_content_sha256,
        'contentSha256',a.content_sha256,
        'renderedContent',a.rendered_content,
        'commercialSnapshot',a.commercial_snapshot,
        'commercialOrderId',a.commercial_order_id,
        'installmentObligationId',a.installment_obligation_id,
        'supersedesAgreementId',a.supersedes_agreement_id,
        'isCurrent',not exists (
          select 1
          from public.sellertray_commercial_agreements replacement
          where replacement.tenant_id=a.tenant_id
            and replacement.supersedes_agreement_id=a.id
        ),
        'termsCurrent',public.sellertray_commercial_agreement_terms_current(a.id),
        'issuedAt',a.issued_at,
        'acceptance',case when ac.id is null then null else jsonb_build_object(
          'id',ac.id,
          'acceptedAt',ac.accepted_at,
          'acceptedLegalName',ac.accepted_legal_name,
          'acceptedRole',ac.accepted_role,
          'acceptedByCurrentUser',ac.accepted_by_user_id=p_actor_user_id,
          'agreementContentSha256',ac.agreement_content_sha256,
          'templateContentSha256',ac.template_content_sha256
        ) end
      ) as row_value
    from public.sellertray_commercial_agreements a
    join public.sellertray_commercial_agreement_template_versions t
      on t.id=a.template_version_id
    left join public.sellertray_commercial_agreement_acceptances ac
      on ac.tenant_id=a.tenant_id and ac.agreement_id=a.id
    where a.tenant_id=p_tenant_id
  ) projected;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'actorRole',v_role,
    'canAccept',v_can_accept,
    'agreements',v_agreements
  );
end;
$$;

create or replace function public.get_sellertray_commercial_agreement_admin(
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
  v_templates jsonb;
  v_orders jsonb;
  v_agreements jsonb;
begin
  if p_actor_user_id is null then
    raise exception 'Administrator user is required' using errcode='22023';
  end if;

  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if coalesce(v_role,'') not in ('admin','support') then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;

  if p_tenant_id is not null and not exists (
    select 1 from public.tenants t where t.id=p_tenant_id
  ) then
    raise exception 'SellerTray business not found' using errcode='P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,
    'family',t.agreement_family,
    'versionCode',t.version_code,
    'title',t.title,
    'contentBody',t.content_body,
    'contentSha256',t.content_sha256,
    'effectiveFrom',t.effective_from,
    'publishedAt',t.published_at,
    'publishedByUserId',t.published_by_user_id
  ) order by t.agreement_family,t.effective_from desc,t.created_at desc),'[]'::jsonb)
  into v_templates
  from public.sellertray_commercial_agreement_template_versions t;

  if p_tenant_id is null then
    v_orders := '[]'::jsonb;
    v_agreements := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(order_value order by ordered_at desc,order_id),'[]'::jsonb)
    into v_orders
    from (
      select
        o.id as order_id,
        o.ordered_at,
        jsonb_build_object(
          'id',o.id,
          'reference',o.order_reference,
          'currency',o.currency,
          'totalGrossAmount',o.total_gross_amount,
          'orderedAt',o.ordered_at,
          'priceSnapshots',coalesce((
            select jsonb_agg(jsonb_build_object(
              'id',s.id,
              'lineNo',s.line_no,
              'lineType',s.line_type,
              'sourcePriceVersionId',s.source_price_version_id,
              'planCode',s.plan_code,
              'branchId',s.branch_id,
              'billingCycle',s.billing_cycle,
              'description',s.description_snapshot,
              'quantity',s.quantity,
              'currency',s.currency,
              'unitGrossAmount',s.unit_gross_amount,
              'grossAmount',s.gross_amount,
              'netAmount',s.net_amount,
              'taxRatePercent',s.tax_rate_percent,
              'taxAmount',s.tax_amount
            ) order by s.line_no)
            from public.sellertray_commercial_order_price_snapshots s
            where s.tenant_id=o.tenant_id and s.commercial_order_id=o.id
          ),'[]'::jsonb),
          'installmentObligations',coalesce((
            select jsonb_agg(jsonb_build_object(
              'id',io.id,
              'structureCode',io.structure_code,
              'currency',io.currency,
              'obligatedAmount',io.obligated_amount,
              'createdAt',io.created_at,
              'schedule',coalesce((
                select jsonb_agg(jsonb_build_object(
                  'sequenceNo',sch.sequence_no,
                  'percentage',sch.percentage,
                  'amountDue',sch.amount_due,
                  'dueAt',sch.due_at
                ) order by sch.sequence_no)
                from public.sellertray_commercial_installment_schedule sch
                where sch.tenant_id=io.tenant_id
                  and sch.installment_obligation_id=io.id
              ),'[]'::jsonb)
            ) order by io.created_at,io.id)
            from public.sellertray_commercial_installment_obligations io
            where io.tenant_id=o.tenant_id and io.commercial_order_id=o.id
          ),'[]'::jsonb)
        ) as order_value
      from public.sellertray_commercial_orders o
      where o.tenant_id=p_tenant_id
    ) projected_orders;

    select coalesce(jsonb_agg(agreement_value order by is_current desc,issued_at desc,agreement_id),'[]'::jsonb)
    into v_agreements
    from (
      select
        a.id as agreement_id,
        a.issued_at,
        not exists (
          select 1 from public.sellertray_commercial_agreements replacement
          where replacement.tenant_id=a.tenant_id
            and replacement.supersedes_agreement_id=a.id
        ) as is_current,
        jsonb_build_object(
          'id',a.id,
          'reference',a.agreement_reference,
          'family',a.agreement_family,
          'title',t.title,
          'templateVersionId',a.template_version_id,
          'templateVersion',a.template_version_code,
          'templateContentSha256',a.template_content_sha256,
          'contentSha256',a.content_sha256,
          'renderedContent',a.rendered_content,
          'commercialSnapshot',a.commercial_snapshot,
          'commercialOrderId',a.commercial_order_id,
          'installmentObligationId',a.installment_obligation_id,
          'supersedesAgreementId',a.supersedes_agreement_id,
          'isCurrent',not exists (
            select 1 from public.sellertray_commercial_agreements replacement
            where replacement.tenant_id=a.tenant_id
              and replacement.supersedes_agreement_id=a.id
          ),
          'termsCurrent',public.sellertray_commercial_agreement_terms_current(a.id),
        'issuedAt',a.issued_at,
          'issuedByUserId',a.issued_by_user_id,
          'acceptance',case when ac.id is null then null else jsonb_build_object(
            'id',ac.id,
            'acceptedAt',ac.accepted_at,
            'acceptedLegalName',ac.accepted_legal_name,
            'acceptedRole',ac.accepted_role,
            'acceptedByUserId',ac.accepted_by_user_id,
            'agreementContentSha256',ac.agreement_content_sha256,
            'templateContentSha256',ac.template_content_sha256
          ) end
        ) as agreement_value
      from public.sellertray_commercial_agreements a
      join public.sellertray_commercial_agreement_template_versions t
        on t.id=a.template_version_id
      left join public.sellertray_commercial_agreement_acceptances ac
        on ac.tenant_id=a.tenant_id and ac.agreement_id=a.id
      where a.tenant_id=p_tenant_id
    ) projected_agreements;
  end if;

  return jsonb_build_object(
    'actorRole',v_role,
    'canManage',v_role='admin',
    'tenantId',p_tenant_id,
    'templates',v_templates,
    'commercialOrders',v_orders,
    'agreements',v_agreements
  );
end;
$$;

-- Source: 20261024090000_oa3_setup_scheduling.sql
-- SellerTray OA3 — governed setup scheduling.
--
-- Scheduling is attached to the existing commercial Branch-setup obligation and
-- existing immutable readiness fact. It does not create a parallel onboarding or
-- activation state machine. Appointment completion records the existing setup
-- readiness fact and then invokes the existing entitlement reconciliation.

create table if not exists public.sellertray_setup_service_areas (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sellertray_setup_service_areas_code_check check (char_length(btrim(code)) between 2 and 64),
  constraint sellertray_setup_service_areas_name_check check (char_length(btrim(name)) between 2 and 160)
);

create table if not exists public.sellertray_setup_workers (
  id uuid primary key default gen_random_uuid(),
  worker_code text not null unique,
  display_name text not null,
  active boolean not null default true,
  max_concurrent_setups integer not null default 1,
  travel_buffer_minutes integer not null default 30,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sellertray_setup_workers_code_check check (char_length(btrim(worker_code)) between 2 and 64),
  constraint sellertray_setup_workers_name_check check (char_length(btrim(display_name)) between 2 and 160),
  constraint sellertray_setup_workers_capacity_check check (max_concurrent_setups between 1 and 20),
  constraint sellertray_setup_workers_buffer_check check (travel_buffer_minutes between 0 and 480)
);

create table if not exists public.sellertray_setup_worker_service_areas (
  worker_id uuid not null references public.sellertray_setup_workers(id),
  service_area_id uuid not null references public.sellertray_setup_service_areas(id),
  created_at timestamptz not null default now(),
  primary key (worker_id,service_area_id)
);

create table if not exists public.sellertray_setup_branch_service_areas (
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  service_area_id uuid not null references public.sellertray_setup_service_areas(id),
  assigned_by_user_id uuid not null references auth.users(id),
  assigned_at timestamptz not null default now(),
  primary key (tenant_id,branch_id)
);

create table if not exists public.sellertray_commercial_setup_appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  commercial_order_id uuid not null references public.sellertray_commercial_orders(id),
  branch_id uuid not null references public.branches(id),
  worker_id uuid not null references public.sellertray_setup_workers(id),
  service_area_id uuid not null references public.sellertray_setup_service_areas(id),
  scheduled_start_at timestamptz not null,
  scheduled_end_at timestamptz not null,
  travel_buffer_minutes_snapshot integer not null,
  status text not null default 'scheduled',
  merchant_note text,
  internal_note text,
  created_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  constraint sellertray_setup_appointment_window_check check (scheduled_end_at>scheduled_start_at),
  constraint sellertray_setup_appointment_duration_check check (scheduled_end_at<=scheduled_start_at+interval '16 hours'),
  constraint sellertray_setup_appointment_buffer_check check (travel_buffer_minutes_snapshot between 0 and 480),
  constraint sellertray_setup_appointment_status_check check (status in ('scheduled','in_progress','completed','cancelled','no_show')),
  constraint sellertray_setup_appointment_merchant_note_check check (merchant_note is null or char_length(merchant_note)<=2000),
  constraint sellertray_setup_appointment_internal_note_check check (internal_note is null or char_length(internal_note)<=4000)
);

create unique index if not exists sellertray_setup_one_active_subject_idx
  on public.sellertray_commercial_setup_appointments(tenant_id,commercial_order_id,branch_id)
  where status in ('scheduled','in_progress');
create index if not exists sellertray_setup_worker_schedule_idx
  on public.sellertray_commercial_setup_appointments(worker_id,scheduled_start_at,scheduled_end_at)
  where status in ('scheduled','in_progress');
create index if not exists sellertray_setup_tenant_schedule_idx
  on public.sellertray_commercial_setup_appointments(tenant_id,scheduled_start_at desc);

create table if not exists public.sellertray_commercial_setup_appointment_events (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.sellertray_commercial_setup_appointments(id),
  tenant_id uuid not null references public.tenants(id),
  commercial_order_id uuid not null references public.sellertray_commercial_orders(id),
  branch_id uuid not null references public.branches(id),
  command_id uuid not null unique,
  event_type text not null,
  actor_user_id uuid not null references auth.users(id),
  actor_kind text not null default 'platform',
  reason text not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint sellertray_setup_event_type_check check (event_type in ('scheduled','rescheduled','reassigned','started','completed','cancelled','no_show')),
  constraint sellertray_setup_event_actor_kind_check check (actor_kind in ('platform','merchant')),
  constraint sellertray_setup_event_reason_check check (char_length(btrim(reason)) between 6 and 1000),
  constraint sellertray_setup_event_details_check check (jsonb_typeof(details)='object')
);

create index if not exists sellertray_setup_events_appointment_idx
  on public.sellertray_commercial_setup_appointment_events(appointment_id,occurred_at,id);

create table if not exists public.sellertray_setup_reschedule_requests (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.sellertray_commercial_setup_appointments(id),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  command_id uuid not null unique,
  requested_by_user_id uuid not null references auth.users(id),
  requested_start_at timestamptz,
  requested_end_at timestamptz,
  merchant_note text not null,
  status text not null default 'pending',
  resolved_by_user_id uuid references auth.users(id),
  resolution_note text,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint sellertray_setup_reschedule_window_check check (
    (requested_start_at is null and requested_end_at is null)
    or (requested_start_at is not null and requested_end_at is not null and requested_end_at>requested_start_at)
  ),
  constraint sellertray_setup_reschedule_note_check check (char_length(btrim(merchant_note)) between 6 and 2000),
  constraint sellertray_setup_reschedule_status_check check (status in ('pending','accepted','declined','withdrawn'))
);
create index if not exists sellertray_setup_reschedule_pending_idx
  on public.sellertray_setup_reschedule_requests(tenant_id,status,requested_at)
  where status='pending';

alter table public.sellertray_setup_service_areas enable row level security;
alter table public.sellertray_setup_workers enable row level security;
alter table public.sellertray_setup_worker_service_areas enable row level security;
alter table public.sellertray_setup_branch_service_areas enable row level security;
alter table public.sellertray_commercial_setup_appointments enable row level security;
alter table public.sellertray_commercial_setup_appointment_events enable row level security;
alter table public.sellertray_setup_reschedule_requests enable row level security;

revoke all on table public.sellertray_setup_service_areas from public,anon,authenticated;
revoke all on table public.sellertray_setup_workers from public,anon,authenticated;
revoke all on table public.sellertray_setup_worker_service_areas from public,anon,authenticated;
revoke all on table public.sellertray_setup_branch_service_areas from public,anon,authenticated;
revoke all on table public.sellertray_commercial_setup_appointments from public,anon,authenticated;
revoke all on table public.sellertray_commercial_setup_appointment_events from public,anon,authenticated;
revoke all on table public.sellertray_setup_reschedule_requests from public,anon,authenticated;
grant all on table public.sellertray_setup_service_areas to service_role;
grant all on table public.sellertray_setup_workers to service_role;
grant all on table public.sellertray_setup_worker_service_areas to service_role;
grant all on table public.sellertray_setup_branch_service_areas to service_role;
grant all on table public.sellertray_commercial_setup_appointments to service_role;
grant all on table public.sellertray_commercial_setup_appointment_events to service_role;
grant all on table public.sellertray_setup_reschedule_requests to service_role;

create or replace function public.prevent_sellertray_setup_event_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception 'SellerTray setup history is immutable' using errcode='55000';
end;
$$;

drop trigger if exists sellertray_setup_events_immutable on public.sellertray_commercial_setup_appointment_events;
create trigger sellertray_setup_events_immutable
before update or delete on public.sellertray_commercial_setup_appointment_events
for each row execute function public.prevent_sellertray_setup_event_mutation();

create or replace function public.assert_sellertray_setup_subject(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_branch_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if not exists (
    select 1
    from public.sellertray_commercial_order_price_snapshots s
    join public.branches b on b.id=s.branch_id and b.tenant_id=s.tenant_id
    where s.tenant_id=p_tenant_id
      and s.commercial_order_id=p_commercial_order_id
      and s.line_type='branch_setup'
      and s.branch_id=p_branch_id
      and b.is_active
  ) then
    raise exception 'Branch is not part of this governed active SellerTray setup purchase' using errcode='23514';
  end if;
end;
$$;
revoke all on function public.assert_sellertray_setup_subject(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.assert_sellertray_setup_subject(uuid,uuid,uuid) to service_role;

create or replace function public.assert_sellertray_setup_capacity(
  p_worker_id uuid,
  p_service_area_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_exclude_appointment_id uuid default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_worker public.sellertray_setup_workers%rowtype;
  v_conflicts integer;
begin
  if p_start_at is null or p_end_at is null or p_end_at<=p_start_at then
    raise exception 'A valid setup appointment window is required' using errcode='22023';
  end if;
  if p_start_at<now()-interval '5 minutes' then
    raise exception 'A setup appointment cannot be scheduled in the past' using errcode='22023';
  end if;

  select w.* into strict v_worker
  from public.sellertray_setup_workers w
  where w.id=p_worker_id
  for update;

  if not v_worker.active then
    raise exception 'Selected setup worker is inactive' using errcode='23514';
  end if;
  if not exists (
    select 1 from public.sellertray_setup_worker_service_areas c
    where c.worker_id=v_worker.id and c.service_area_id=p_service_area_id
  ) then
    raise exception 'Selected setup worker does not cover this service area' using errcode='23514';
  end if;

  select count(*)::integer into v_conflicts
  from public.sellertray_commercial_setup_appointments a
  where a.worker_id=v_worker.id
    and a.status in ('scheduled','in_progress')
    and (p_exclude_appointment_id is null or a.id<>p_exclude_appointment_id)
    and a.scheduled_start_at < p_end_at + make_interval(mins=>greatest(v_worker.travel_buffer_minutes,a.travel_buffer_minutes_snapshot))
    and a.scheduled_end_at > p_start_at - make_interval(mins=>greatest(v_worker.travel_buffer_minutes,a.travel_buffer_minutes_snapshot));

  if v_conflicts>=v_worker.max_concurrent_setups then
    raise exception 'Selected setup worker has reached capacity for this time including travel buffer' using errcode='23514';
  end if;
end;
$$;
revoke all on function public.assert_sellertray_setup_capacity(uuid,uuid,timestamptz,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.assert_sellertray_setup_capacity(uuid,uuid,timestamptz,timestamptz,uuid) to service_role;

-- Converge the older readiness mutation on the named branch-setup capability.
create or replace function public.mark_sellertray_commercial_branch_setup_ready(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_branch_id uuid,
  p_command_id uuid,
  p_evidence jsonb,
  p_reason text,
  p_ready_at timestamptz,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_evidence jsonb := coalesce(p_evidence,'{}'::jsonb);
  v_reason text := btrim(coalesce(p_reason,''));
  v_existing public.sellertray_commercial_branch_setup_readiness%rowtype;
  v_id uuid;
begin
  if p_tenant_id is null or p_commercial_order_id is null or p_branch_id is null
     or p_command_id is null or p_ready_at is null or p_actor_user_id is null then
    raise exception 'Business, commercial order, Branch, command, setup time and actor are required' using errcode='22023';
  end if;
  if jsonb_typeof(v_evidence)<>'object' then
    raise exception 'Setup readiness evidence must be an object' using errcode='22023';
  end if;
  if char_length(v_reason) not between 1 and 1000 then
    raise exception 'Setup readiness reason is required' using errcode='22023';
  end if;
  if p_ready_at>now()+interval '5 minutes' then
    raise exception 'Setup readiness time cannot be in the future' using errcode='22023';
  end if;
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then
    raise exception 'Branch setup management capability required' using errcode='42501';
  end if;

  perform public.assert_sellertray_setup_subject(p_tenant_id,p_commercial_order_id,p_branch_id);

  insert into public.sellertray_commercial_branch_setup_readiness(
    tenant_id,commercial_order_id,branch_id,command_id,evidence,
    actor_user_id,reason,ready_at,recorded_at
  ) values (
    p_tenant_id,p_commercial_order_id,p_branch_id,p_command_id,v_evidence,
    p_actor_user_id,v_reason,p_ready_at,now()
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is not null then return v_id; end if;

  select r.* into v_existing
  from public.sellertray_commercial_branch_setup_readiness r
  where r.tenant_id=p_tenant_id and r.command_id=p_command_id;

  if not found then
    select r.* into strict v_existing
    from public.sellertray_commercial_branch_setup_readiness r
    where r.tenant_id=p_tenant_id and r.commercial_order_id=p_commercial_order_id and r.branch_id=p_branch_id;
  end if;

  if v_existing.commercial_order_id<>p_commercial_order_id
     or v_existing.branch_id<>p_branch_id
     or v_existing.evidence is distinct from v_evidence
     or v_existing.actor_user_id<>p_actor_user_id
     or v_existing.reason<>v_reason
     or v_existing.ready_at<>p_ready_at then
    raise exception 'SellerTray setup readiness is already recorded with different facts' using errcode='23505';
  end if;
  return v_existing.id;
end;
$$;
revoke all on function public.mark_sellertray_commercial_branch_setup_ready(uuid,uuid,uuid,uuid,jsonb,text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.mark_sellertray_commercial_branch_setup_ready(uuid,uuid,uuid,uuid,jsonb,text,timestamptz,uuid) to service_role;

create or replace function public.platform_admin_upsert_setup_service_area(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_service_area_id uuid,
  p_code text,
  p_name text,
  p_active boolean,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
  v_code text:=lower(btrim(coalesce(p_code,'')));
  v_name text:=btrim(coalesce(p_name,''));
  v_reason text:=btrim(coalesce(p_reason,''));
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then
    raise exception 'Branch setup management capability required' using errcode='42501';
  end if;
  if char_length(v_code) not between 2 and 64 or char_length(v_name) not between 2 and 160 or char_length(v_reason)<6 then
    raise exception 'Service area code, name and reason are required' using errcode='22023';
  end if;

  if p_service_area_id is null then
    insert into public.sellertray_setup_service_areas(code,name,active)
    values(v_code,v_name,coalesce(p_active,true)) returning id into v_id;
  else
    update public.sellertray_setup_service_areas
    set code=v_code,name=v_name,active=coalesce(p_active,true),updated_at=now()
    where id=p_service_area_id returning id into v_id;
    if v_id is null then raise exception 'Setup service area not found' using errcode='P0002'; end if;
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'setup_service_area_saved',jsonb_build_object('serviceAreaId',v_id,'reason',v_reason));
  return v_id;
end;
$$;

create or replace function public.platform_admin_upsert_setup_worker(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_worker_id uuid,
  p_worker_code text,
  p_display_name text,
  p_active boolean,
  p_max_concurrent_setups integer,
  p_travel_buffer_minutes integer,
  p_service_area_ids uuid[],
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
  v_code text:=lower(btrim(coalesce(p_worker_code,'')));
  v_name text:=btrim(coalesce(p_display_name,''));
  v_reason text:=btrim(coalesce(p_reason,''));
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then
    raise exception 'Branch setup management capability required' using errcode='42501';
  end if;
  if char_length(v_code) not between 2 and 64 or char_length(v_name) not between 2 and 160 or char_length(v_reason)<6
     or coalesce(p_max_concurrent_setups,0) not between 1 and 20
     or coalesce(p_travel_buffer_minutes,-1) not between 0 and 480 then
    raise exception 'Valid worker identity, capacity, travel buffer and reason are required' using errcode='22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_service_area_ids,'{}'::uuid[])) x(id) where not exists (select 1 from public.sellertray_setup_service_areas a where a.id=x.id and a.active)) then
    raise exception 'Worker coverage contains an inactive or unknown service area' using errcode='23514';
  end if;

  if p_worker_id is null then
    insert into public.sellertray_setup_workers(worker_code,display_name,active,max_concurrent_setups,travel_buffer_minutes)
    values(v_code,v_name,coalesce(p_active,true),p_max_concurrent_setups,p_travel_buffer_minutes) returning id into v_id;
  else
    update public.sellertray_setup_workers
    set worker_code=v_code,display_name=v_name,active=coalesce(p_active,true),
        max_concurrent_setups=p_max_concurrent_setups,travel_buffer_minutes=p_travel_buffer_minutes,updated_at=now()
    where id=p_worker_id returning id into v_id;
    if v_id is null then raise exception 'Setup worker not found' using errcode='P0002'; end if;
  end if;

  delete from public.sellertray_setup_worker_service_areas where worker_id=v_id;
  insert into public.sellertray_setup_worker_service_areas(worker_id,service_area_id)
  select v_id,x.id from unnest(coalesce(p_service_area_ids,'{}'::uuid[])) x(id) on conflict do nothing;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'setup_worker_saved',jsonb_build_object('workerId',v_id,'reason',v_reason,'serviceAreaIds',coalesce(to_jsonb(p_service_area_ids),'[]'::jsonb)));
  return v_id;
end;
$$;

create or replace function public.platform_admin_assign_branch_setup_service_area(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_branch_id uuid,
  p_service_area_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare v_reason text:=btrim(coalesce(p_reason,''));
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then
    raise exception 'Branch setup management capability required' using errcode='42501';
  end if;
  if char_length(v_reason)<6 then raise exception 'Assignment reason is required' using errcode='22023'; end if;
  if not exists(select 1 from public.branches b where b.id=p_branch_id and b.tenant_id=p_tenant_id) then
    raise exception 'Branch not found for this Business' using errcode='P0002';
  end if;
  if not exists(select 1 from public.sellertray_setup_service_areas a where a.id=p_service_area_id and a.active) then
    raise exception 'Active setup service area required' using errcode='23514';
  end if;

  insert into public.sellertray_setup_branch_service_areas(tenant_id,branch_id,service_area_id,assigned_by_user_id,assigned_at)
  values(p_tenant_id,p_branch_id,p_service_area_id,p_actor_user_id,now())
  on conflict (tenant_id,branch_id) do update
    set service_area_id=excluded.service_area_id,assigned_by_user_id=excluded.assigned_by_user_id,assigned_at=excluded.assigned_at;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'setup_branch_service_area_assigned',jsonb_build_object('branchId',p_branch_id,'serviceAreaId',p_service_area_id,'reason',v_reason));
end;
$$;

create or replace function public.platform_admin_schedule_branch_setup(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_branch_id uuid,
  p_worker_id uuid,
  p_service_area_id uuid,
  p_scheduled_start_at timestamptz,
  p_scheduled_end_at timestamptz,
  p_merchant_note text,
  p_internal_note text,
  p_command_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_worker public.sellertray_setup_workers%rowtype;
  v_existing_event public.sellertray_commercial_setup_appointment_events%rowtype;
  v_appointment_id uuid;
  v_reason text:=btrim(coalesce(p_reason,''));
  v_merchant_note text:=nullif(btrim(coalesce(p_merchant_note,'')),'');
  v_internal_note text:=nullif(btrim(coalesce(p_internal_note,'')),'');
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then
    raise exception 'Branch setup management capability required' using errcode='42501';
  end if;
  if p_command_id is null or char_length(v_reason)<6 then raise exception 'Scheduling command and reason are required' using errcode='22023'; end if;
  perform public.assert_sellertray_setup_subject(p_tenant_id,p_commercial_order_id,p_branch_id);
  if exists(select 1 from public.sellertray_commercial_branch_setup_readiness r where r.tenant_id=p_tenant_id and r.commercial_order_id=p_commercial_order_id and r.branch_id=p_branch_id) then
    raise exception 'Completed Branch setup cannot be scheduled again' using errcode='23514';
  end if;
  if not exists(select 1 from public.sellertray_setup_branch_service_areas a where a.tenant_id=p_tenant_id and a.branch_id=p_branch_id and a.service_area_id=p_service_area_id) then
    raise exception 'Branch is not assigned to the selected setup service area' using errcode='23514';
  end if;

  select e.* into v_existing_event from public.sellertray_commercial_setup_appointment_events e where e.command_id=p_command_id;
  if found then
    if v_existing_event.event_type<>'scheduled' or v_existing_event.tenant_id<>p_tenant_id or v_existing_event.commercial_order_id<>p_commercial_order_id or v_existing_event.branch_id<>p_branch_id then
      raise exception 'Setup scheduling command is already used for different facts' using errcode='23505';
    end if;
    return v_existing_event.appointment_id;
  end if;

  if exists(select 1 from public.sellertray_commercial_setup_appointments a where a.tenant_id=p_tenant_id and a.commercial_order_id=p_commercial_order_id and a.branch_id=p_branch_id and a.status in ('scheduled','in_progress')) then
    raise exception 'Branch setup already has an active appointment' using errcode='23505';
  end if;

  perform public.assert_sellertray_setup_capacity(p_worker_id,p_service_area_id,p_scheduled_start_at,p_scheduled_end_at,null);
  select w.* into strict v_worker from public.sellertray_setup_workers w where w.id=p_worker_id;

  insert into public.sellertray_commercial_setup_appointments(
    tenant_id,commercial_order_id,branch_id,worker_id,service_area_id,scheduled_start_at,scheduled_end_at,
    travel_buffer_minutes_snapshot,status,merchant_note,internal_note,created_by_user_id
  ) values (
    p_tenant_id,p_commercial_order_id,p_branch_id,p_worker_id,p_service_area_id,p_scheduled_start_at,p_scheduled_end_at,
    v_worker.travel_buffer_minutes,'scheduled',v_merchant_note,v_internal_note,p_actor_user_id
  ) returning id into v_appointment_id;

  insert into public.sellertray_commercial_setup_appointment_events(
    appointment_id,tenant_id,commercial_order_id,branch_id,command_id,event_type,actor_user_id,actor_kind,reason,details
  ) values (
    v_appointment_id,p_tenant_id,p_commercial_order_id,p_branch_id,p_command_id,'scheduled',p_actor_user_id,'platform',v_reason,
    jsonb_build_object('workerId',p_worker_id,'serviceAreaId',p_service_area_id,'scheduledStartAt',p_scheduled_start_at,'scheduledEndAt',p_scheduled_end_at,'merchantNote',v_merchant_note)
  );

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'branch_setup_scheduled',jsonb_build_object('appointmentId',v_appointment_id,'commercialOrderId',p_commercial_order_id,'branchId',p_branch_id,'commandId',p_command_id));
  return v_appointment_id;
end;
$$;

create or replace function public.platform_admin_reschedule_branch_setup(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_worker_id uuid,
  p_service_area_id uuid,
  p_scheduled_start_at timestamptz,
  p_scheduled_end_at timestamptz,
  p_merchant_note text,
  p_internal_note text,
  p_reschedule_request_id uuid,
  p_command_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_appointment public.sellertray_commercial_setup_appointments%rowtype;
  v_worker public.sellertray_setup_workers%rowtype;
  v_existing_event public.sellertray_commercial_setup_appointment_events%rowtype;
  v_reason text:=btrim(coalesce(p_reason,''));
  v_event_type text;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then raise exception 'Branch setup management capability required' using errcode='42501'; end if;
  if p_command_id is null or char_length(v_reason)<6 then raise exception 'Reschedule command and reason are required' using errcode='22023'; end if;
  select e.* into v_existing_event from public.sellertray_commercial_setup_appointment_events e where e.command_id=p_command_id;
  if found then
    if v_existing_event.appointment_id<>p_appointment_id or v_existing_event.event_type not in ('rescheduled','reassigned') then raise exception 'Setup reschedule command is already used for different facts' using errcode='23505'; end if;
    return p_appointment_id;
  end if;

  select a.* into strict v_appointment from public.sellertray_commercial_setup_appointments a where a.id=p_appointment_id and a.tenant_id=p_tenant_id for update;
  if v_appointment.status<>'scheduled' then raise exception 'Only scheduled setup appointments can be rescheduled' using errcode='23514'; end if;
  if not exists(select 1 from public.sellertray_setup_branch_service_areas a where a.tenant_id=p_tenant_id and a.branch_id=v_appointment.branch_id and a.service_area_id=p_service_area_id) then raise exception 'Branch is not assigned to the selected setup service area' using errcode='23514'; end if;

  perform public.assert_sellertray_setup_capacity(p_worker_id,p_service_area_id,p_scheduled_start_at,p_scheduled_end_at,p_appointment_id);
  select w.* into strict v_worker from public.sellertray_setup_workers w where w.id=p_worker_id;
  v_event_type:=case when v_appointment.worker_id<>p_worker_id then 'reassigned' else 'rescheduled' end;

  update public.sellertray_commercial_setup_appointments
  set worker_id=p_worker_id,service_area_id=p_service_area_id,scheduled_start_at=p_scheduled_start_at,scheduled_end_at=p_scheduled_end_at,
      travel_buffer_minutes_snapshot=v_worker.travel_buffer_minutes,
      merchant_note=nullif(btrim(coalesce(p_merchant_note,'')),''),internal_note=nullif(btrim(coalesce(p_internal_note,'')),''),updated_at=now()
  where id=p_appointment_id;

  insert into public.sellertray_commercial_setup_appointment_events(
    appointment_id,tenant_id,commercial_order_id,branch_id,command_id,event_type,actor_user_id,actor_kind,reason,details
  ) values (
    p_appointment_id,p_tenant_id,v_appointment.commercial_order_id,v_appointment.branch_id,p_command_id,v_event_type,p_actor_user_id,'platform',v_reason,
    jsonb_build_object('from',jsonb_build_object('workerId',v_appointment.worker_id,'serviceAreaId',v_appointment.service_area_id,'scheduledStartAt',v_appointment.scheduled_start_at,'scheduledEndAt',v_appointment.scheduled_end_at),'to',jsonb_build_object('workerId',p_worker_id,'serviceAreaId',p_service_area_id,'scheduledStartAt',p_scheduled_start_at,'scheduledEndAt',p_scheduled_end_at))
  );

  if p_reschedule_request_id is not null then
    update public.sellertray_setup_reschedule_requests
    set status='accepted',resolved_by_user_id=p_actor_user_id,resolution_note=v_reason,resolved_at=now()
    where id=p_reschedule_request_id and appointment_id=p_appointment_id and tenant_id=p_tenant_id and status='pending';
  end if;
  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'branch_setup_rescheduled',jsonb_build_object('appointmentId',p_appointment_id,'commandId',p_command_id,'reason',v_reason));
  return p_appointment_id;
end;
$$;

create or replace function public.platform_admin_transition_branch_setup(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_target_status text,
  p_command_id uuid,
  p_reason text,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_appointment public.sellertray_commercial_setup_appointments%rowtype;
  v_existing_event public.sellertray_commercial_setup_appointment_events%rowtype;
  v_target text:=lower(btrim(coalesce(p_target_status,'')));
  v_expected_event_type text:=case when lower(btrim(coalesce(p_target_status,'')))='in_progress' then 'started' else lower(btrim(coalesce(p_target_status,''))) end;
  v_reason text:=btrim(coalesce(p_reason,''));
  v_readiness_id uuid;
  v_obligation_id uuid;
  v_state jsonb;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then raise exception 'Branch setup management capability required' using errcode='42501'; end if;
  if p_command_id is null or char_length(v_reason)<6 or jsonb_typeof(coalesce(p_evidence,'{}'::jsonb))<>'object' then raise exception 'Transition command, reason and evidence are required' using errcode='22023'; end if;
  if v_target not in ('in_progress','completed','cancelled','no_show') then raise exception 'Unsupported setup appointment transition' using errcode='22023'; end if;

  select e.* into v_existing_event from public.sellertray_commercial_setup_appointment_events e where e.command_id=p_command_id;
  if found then
    if v_existing_event.appointment_id<>p_appointment_id or v_existing_event.event_type<>v_expected_event_type then raise exception 'Setup transition command is already used for different facts' using errcode='23505'; end if;
    select jsonb_build_object('appointmentId',a.id,'status',a.status,'readinessId',r.id)
      into v_state
    from public.sellertray_commercial_setup_appointments a
    left join public.sellertray_commercial_branch_setup_readiness r on r.tenant_id=a.tenant_id and r.commercial_order_id=a.commercial_order_id and r.branch_id=a.branch_id
    where a.id=p_appointment_id;
    return v_state;
  end if;

  select a.* into strict v_appointment from public.sellertray_commercial_setup_appointments a where a.id=p_appointment_id and a.tenant_id=p_tenant_id for update;
  if v_target='in_progress' and v_appointment.status<>'scheduled' then raise exception 'Only a scheduled setup can start' using errcode='23514'; end if;
  if v_target in ('completed','no_show') and v_appointment.status not in ('scheduled','in_progress') then raise exception 'Only an active setup appointment can finish' using errcode='23514'; end if;
  if v_target='cancelled' and v_appointment.status<>'scheduled' then raise exception 'Only a scheduled setup appointment can be cancelled' using errcode='23514'; end if;

  update public.sellertray_commercial_setup_appointments
  set status=v_target,updated_at=now(),completed_at=case when v_target='completed' then now() else completed_at end,cancelled_at=case when v_target='cancelled' then now() else cancelled_at end
  where id=p_appointment_id;

  insert into public.sellertray_commercial_setup_appointment_events(
    appointment_id,tenant_id,commercial_order_id,branch_id,command_id,event_type,actor_user_id,actor_kind,reason,details
  ) values (
    p_appointment_id,p_tenant_id,v_appointment.commercial_order_id,v_appointment.branch_id,p_command_id,
    v_expected_event_type,p_actor_user_id,'platform',v_reason,
    jsonb_build_object('fromStatus',v_appointment.status,'toStatus',v_target,'evidence',coalesce(p_evidence,'{}'::jsonb))
  );

  if v_target='completed' then
    v_readiness_id:=public.mark_sellertray_commercial_branch_setup_ready(
      p_tenant_id,v_appointment.commercial_order_id,v_appointment.branch_id,p_command_id,
      coalesce(p_evidence,'{}'::jsonb)||jsonb_build_object('source','oa3_setup_appointment','appointmentId',p_appointment_id),
      v_reason,now(),p_actor_user_id
    );
    select io.id into v_obligation_id from public.sellertray_commercial_installment_obligations io
    where io.tenant_id=p_tenant_id and io.commercial_order_id=v_appointment.commercial_order_id order by io.created_at,io.id limit 1;
    if v_obligation_id is not null then perform public.reconcile_sellertray_installment_entitlement(p_tenant_id,v_obligation_id); end if;
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'branch_setup_'||v_target,jsonb_build_object('appointmentId',p_appointment_id,'commercialOrderId',v_appointment.commercial_order_id,'branchId',v_appointment.branch_id,'commandId',p_command_id));

  return jsonb_build_object('appointmentId',p_appointment_id,'status',v_target,'readinessId',v_readiness_id);
end;
$$;

create or replace function public.platform_admin_resolve_setup_reschedule_request(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_request_id uuid,
  p_decision text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare v_decision text:=lower(btrim(coalesce(p_decision,''))); v_reason text:=btrim(coalesce(p_reason,''));
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then raise exception 'Branch setup management capability required' using errcode='42501'; end if;
  if v_decision not in ('declined','withdrawn') or char_length(v_reason)<6 then raise exception 'A valid reschedule-request decision and reason are required' using errcode='22023'; end if;
  update public.sellertray_setup_reschedule_requests
  set status=v_decision,resolved_by_user_id=p_actor_user_id,resolution_note=v_reason,resolved_at=now()
  where id=p_request_id and tenant_id=p_tenant_id and status='pending';
  if not found then raise exception 'Pending setup reschedule request not found' using errcode='P0002'; end if;
  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'setup_reschedule_request_'||v_decision,jsonb_build_object('requestId',p_request_id,'reason',v_reason));
end;
$$;

create or replace function public.platform_admin_setup_scheduling_center(
  p_actor_user_id uuid,
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_result jsonb;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then raise exception 'Branch setup management capability required' using errcode='42501'; end if;
  select jsonb_build_object(
    'canManage',true,
    'serviceAreas',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'code',a.code,'name',a.name,'active',a.active) order by a.name) from public.sellertray_setup_service_areas a),'[]'::jsonb),
    'workers',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'code',w.worker_code,'name',w.display_name,'active',w.active,'maxConcurrentSetups',w.max_concurrent_setups,'travelBufferMinutes',w.travel_buffer_minutes,'serviceAreaIds',coalesce((select jsonb_agg(c.service_area_id order by c.service_area_id) from public.sellertray_setup_worker_service_areas c where c.worker_id=w.id),'[]'::jsonb)) order by w.display_name) from public.sellertray_setup_workers w),'[]'::jsonb),
    'branchAreas',coalesce((select jsonb_agg(jsonb_build_object('branchId',b.id,'branchCode',b.code,'branchName',b.name,'serviceAreaId',ba.service_area_id) order by b.name) from public.branches b left join public.sellertray_setup_branch_service_areas ba on ba.tenant_id=b.tenant_id and ba.branch_id=b.id where b.tenant_id=p_tenant_id and b.is_active),'[]'::jsonb),
    'appointments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'commercialOrderId',a.commercial_order_id,'branchId',a.branch_id,'branchName',b.name,'workerId',a.worker_id,'workerName',w.display_name,'serviceAreaId',a.service_area_id,'serviceAreaName',sa.name,'scheduledStartAt',a.scheduled_start_at,'scheduledEndAt',a.scheduled_end_at,'status',a.status,'merchantNote',a.merchant_note,'internalNote',a.internal_note,'createdAt',a.created_at,'completedAt',a.completed_at) order by a.scheduled_start_at desc) from public.sellertray_commercial_setup_appointments a join public.branches b on b.id=a.branch_id join public.sellertray_setup_workers w on w.id=a.worker_id join public.sellertray_setup_service_areas sa on sa.id=a.service_area_id where a.tenant_id=p_tenant_id),'[]'::jsonb),
    'pendingRequests',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'appointmentId',r.appointment_id,'branchId',r.branch_id,'requestedStartAt',r.requested_start_at,'requestedEndAt',r.requested_end_at,'merchantNote',r.merchant_note,'requestedAt',r.requested_at,'requestedByUserId',r.requested_by_user_id) order by r.requested_at) from public.sellertray_setup_reschedule_requests r where r.tenant_id=p_tenant_id and r.status='pending'),'[]'::jsonb),
    'setupSubjects',coalesce((select jsonb_agg(jsonb_build_object('commercialOrderId',s.commercial_order_id,'branchId',s.branch_id,'branchCode',b.code,'branchName',b.name,'ready',rr.id is not null,'readyAt',rr.ready_at,'serviceAreaId',ba.service_area_id) order by s.line_no) from public.sellertray_commercial_order_price_snapshots s join public.branches b on b.id=s.branch_id and b.tenant_id=s.tenant_id left join public.sellertray_commercial_branch_setup_readiness rr on rr.tenant_id=s.tenant_id and rr.commercial_order_id=s.commercial_order_id and rr.branch_id=s.branch_id left join public.sellertray_setup_branch_service_areas ba on ba.tenant_id=s.tenant_id and ba.branch_id=s.branch_id where s.tenant_id=p_tenant_id and s.line_type='branch_setup'),'[]'::jsonb),
    'generatedAt',now()
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.get_sellertray_setup_schedule(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_user_id uuid:=(select auth.uid()); v_role text; v_state jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select tm.role into v_role from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role is null or v_role not in ('owner','manager') then raise exception 'Setup scheduling requires an Owner or Manager' using errcode='42501'; end if;
  select jsonb_build_object(
    'tenantId',p_tenant_id,
    'appointments',coalesce(jsonb_agg(jsonb_build_object('id',a.id,'commercialOrderId',a.commercial_order_id,'branchId',a.branch_id,'branchName',b.name,'scheduledStartAt',a.scheduled_start_at,'scheduledEndAt',a.scheduled_end_at,'status',a.status,'merchantNote',a.merchant_note,'serviceAreaName',sa.name,'ready',r.id is not null,'readyAt',r.ready_at,'pendingRescheduleRequest',exists(select 1 from public.sellertray_setup_reschedule_requests rq where rq.appointment_id=a.id and rq.status='pending')) order by a.scheduled_start_at),'[]'::jsonb),
    'generatedAt',now()
  ) into v_state
  from public.sellertray_commercial_setup_appointments a
  join public.branches b on b.id=a.branch_id and b.tenant_id=a.tenant_id
  join public.sellertray_setup_service_areas sa on sa.id=a.service_area_id
  left join public.sellertray_commercial_branch_setup_readiness r on r.tenant_id=a.tenant_id and r.commercial_order_id=a.commercial_order_id and r.branch_id=a.branch_id
  where a.tenant_id=p_tenant_id;
  return coalesce(v_state,jsonb_build_object('tenantId',p_tenant_id,'appointments','[]'::jsonb,'generatedAt',now()));
end;
$$;

create or replace function public.request_sellertray_setup_reschedule(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_requested_start_at timestamptz,
  p_requested_end_at timestamptz,
  p_merchant_note text,
  p_command_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=(select auth.uid());
  v_role text;
  v_appointment public.sellertray_commercial_setup_appointments%rowtype;
  v_existing public.sellertray_setup_reschedule_requests%rowtype;
  v_id uuid;
  v_note text:=btrim(coalesce(p_merchant_note,''));
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select tm.role into v_role from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role is null or v_role not in ('owner','manager') then raise exception 'Setup reschedule requests require an Owner or Manager' using errcode='42501'; end if;
  if p_command_id is null or char_length(v_note) not between 6 and 2000 then raise exception 'Reschedule command and note are required' using errcode='22023'; end if;
  if (p_requested_start_at is null)<>(p_requested_end_at is null) or (p_requested_start_at is not null and p_requested_end_at<=p_requested_start_at) then raise exception 'Requested setup window must be complete and valid' using errcode='22023'; end if;

  select a.* into strict v_appointment from public.sellertray_commercial_setup_appointments a where a.id=p_appointment_id and a.tenant_id=p_tenant_id;
  if v_appointment.status<>'scheduled' then raise exception 'Only a scheduled setup can be changed' using errcode='23514'; end if;

  select r.* into v_existing from public.sellertray_setup_reschedule_requests r where r.command_id=p_command_id;
  if found then
    if v_existing.tenant_id<>p_tenant_id or v_existing.appointment_id<>p_appointment_id or v_existing.requested_by_user_id<>v_user_id or v_existing.requested_start_at is distinct from p_requested_start_at or v_existing.requested_end_at is distinct from p_requested_end_at or v_existing.merchant_note<>v_note then raise exception 'Setup reschedule command is already used for different facts' using errcode='23505'; end if;
    return v_existing.id;
  end if;
  if exists(select 1 from public.sellertray_setup_reschedule_requests r where r.appointment_id=p_appointment_id and r.status='pending') then raise exception 'A setup reschedule request is already pending' using errcode='23505'; end if;

  insert into public.sellertray_setup_reschedule_requests(appointment_id,tenant_id,branch_id,command_id,requested_by_user_id,requested_start_at,requested_end_at,merchant_note)
  values(p_appointment_id,p_tenant_id,v_appointment.branch_id,p_command_id,v_user_id,p_requested_start_at,p_requested_end_at,v_note)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.platform_admin_upsert_setup_service_area(uuid,uuid,uuid,text,text,boolean,text) from public,anon,authenticated;
revoke all on function public.platform_admin_upsert_setup_worker(uuid,uuid,uuid,text,text,boolean,integer,integer,uuid[],text) from public,anon,authenticated;
revoke all on function public.platform_admin_assign_branch_setup_service_area(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.platform_admin_schedule_branch_setup(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.platform_admin_reschedule_branch_setup(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,text,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.platform_admin_transition_branch_setup(uuid,uuid,uuid,text,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.platform_admin_resolve_setup_reschedule_request(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.platform_admin_setup_scheduling_center(uuid,uuid) from public,anon,authenticated;

grant execute on function public.platform_admin_upsert_setup_service_area(uuid,uuid,uuid,text,text,boolean,text) to service_role;
grant execute on function public.platform_admin_upsert_setup_worker(uuid,uuid,uuid,text,text,boolean,integer,integer,uuid[],text) to service_role;
grant execute on function public.platform_admin_assign_branch_setup_service_area(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function public.platform_admin_schedule_branch_setup(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,text,uuid,text) to service_role;
grant execute on function public.platform_admin_reschedule_branch_setup(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,text,uuid,uuid,text) to service_role;
grant execute on function public.platform_admin_transition_branch_setup(uuid,uuid,uuid,text,uuid,text,jsonb) to service_role;
grant execute on function public.platform_admin_resolve_setup_reschedule_request(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.platform_admin_setup_scheduling_center(uuid,uuid) to service_role;

revoke all on function public.get_sellertray_setup_schedule(uuid) from public,anon,authenticated;
grant execute on function public.get_sellertray_setup_schedule(uuid) to authenticated;
revoke all on function public.request_sellertray_setup_reschedule(uuid,uuid,timestamptz,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.request_sellertray_setup_reschedule(uuid,uuid,timestamptz,timestamptz,text,uuid) to authenticated;

comment on table public.sellertray_commercial_setup_appointments is 'OA3 current Branch setup appointment state. Completion feeds existing immutable Branch setup readiness authority.';
comment on table public.sellertray_commercial_setup_appointment_events is 'OA3 immutable appointment lifecycle history; current appointment state is never the activation authority.';
comment on function public.platform_admin_setup_scheduling_center(uuid,uuid) is 'AAL2 transport calls this named-capability-protected OA3 Admin scheduling projection.';
comment on function public.get_sellertray_setup_schedule(uuid) is 'Merchant Owner/Manager view of setup appointments; ProcessEdge internal notes and workforce details are intentionally excluded.';

-- Source: 20261024090500_oa3_setup_scheduling_authority_repair.sql
-- OA3 authority repair.
-- Purchased Branch setup remains the readiness subject even when the Branch is
-- not yet active. Scheduling itself is the new setup-completion authority, so a
-- new readiness fact must be backed by the immutable completed appointment event.
-- Database-owner sessions retain only the break-glass/migration authority they
-- already possess through direct schema access; SellerTray runtime roles,
-- including service_role, remain subject to the completed-appointment guard.

create or replace function public.assert_sellertray_setup_subject(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_branch_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if not exists (
    select 1
    from public.sellertray_commercial_order_price_snapshots s
    join public.branches b on b.id=s.branch_id and b.tenant_id=s.tenant_id
    where s.tenant_id=p_tenant_id
      and s.commercial_order_id=p_commercial_order_id
      and s.line_type='branch_setup'
      and s.branch_id=p_branch_id
  ) then
    raise exception 'Branch is not part of this governed SellerTray setup purchase' using errcode='23514';
  end if;
end;
$$;

revoke all on function public.assert_sellertray_setup_subject(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.assert_sellertray_setup_subject(uuid,uuid,uuid) to service_role;

create or replace function public.mark_sellertray_commercial_branch_setup_ready(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_branch_id uuid,
  p_command_id uuid,
  p_evidence jsonb,
  p_reason text,
  p_ready_at timestamptz,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_evidence jsonb := coalesce(p_evidence,'{}'::jsonb);
  v_reason text := btrim(coalesce(p_reason,''));
  v_existing public.sellertray_commercial_branch_setup_readiness%rowtype;
  v_id uuid;
  v_database_owner_session boolean := session_user in ('postgres','supabase_admin');
begin
  if p_tenant_id is null or p_commercial_order_id is null or p_branch_id is null
     or p_command_id is null or p_ready_at is null or p_actor_user_id is null then
    raise exception 'Business, commercial order, Branch, command, setup time and actor are required' using errcode='22023';
  end if;
  if jsonb_typeof(v_evidence)<>'object' then
    raise exception 'Setup readiness evidence must be an object' using errcode='22023';
  end if;
  if char_length(v_reason) not between 1 and 1000 then
    raise exception 'Setup readiness reason is required' using errcode='22023';
  end if;
  if p_ready_at>now()+interval '5 minutes' then
    raise exception 'Setup readiness time cannot be in the future' using errcode='22023';
  end if;
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then
    raise exception 'Branch setup management capability required' using errcode='42501';
  end if;

  perform public.assert_sellertray_setup_subject(p_tenant_id,p_commercial_order_id,p_branch_id);

  -- Preserve idempotent replay of readiness facts that already existed before
  -- OA3. Only creation of a new readiness fact requires appointment completion.
  select r.* into v_existing
  from public.sellertray_commercial_branch_setup_readiness r
  where r.tenant_id=p_tenant_id and r.command_id=p_command_id;

  if not found then
    select r.* into v_existing
    from public.sellertray_commercial_branch_setup_readiness r
    where r.tenant_id=p_tenant_id
      and r.commercial_order_id=p_commercial_order_id
      and r.branch_id=p_branch_id;
  end if;

  if found then
    if v_existing.commercial_order_id<>p_commercial_order_id
       or v_existing.branch_id<>p_branch_id
       or v_existing.evidence is distinct from v_evidence
       or v_existing.actor_user_id<>p_actor_user_id
       or v_existing.reason<>v_reason
       or v_existing.ready_at<>p_ready_at then
      raise exception 'SellerTray setup readiness is already recorded with different facts' using errcode='23505';
    end if;
    return v_existing.id;
  end if;

  if not v_database_owner_session and not exists (
    select 1
    from public.sellertray_commercial_setup_appointment_events e
    join public.sellertray_commercial_setup_appointments a
      on a.id=e.appointment_id
     and a.tenant_id=e.tenant_id
     and a.commercial_order_id=e.commercial_order_id
     and a.branch_id=e.branch_id
    where e.tenant_id=p_tenant_id
      and e.commercial_order_id=p_commercial_order_id
      and e.branch_id=p_branch_id
      and e.command_id=p_command_id
      and e.event_type='completed'
      and e.actor_user_id=p_actor_user_id
      and a.status='completed'
  ) then
    raise exception 'Branch setup readiness must come from a completed governed setup appointment' using errcode='23514';
  end if;

  insert into public.sellertray_commercial_branch_setup_readiness(
    tenant_id,commercial_order_id,branch_id,command_id,evidence,
    actor_user_id,reason,ready_at,recorded_at
  ) values (
    p_tenant_id,p_commercial_order_id,p_branch_id,p_command_id,v_evidence,
    p_actor_user_id,v_reason,p_ready_at,now()
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is not null then return v_id; end if;

  select r.* into v_existing
  from public.sellertray_commercial_branch_setup_readiness r
  where r.tenant_id=p_tenant_id and r.command_id=p_command_id;

  if not found then
    select r.* into strict v_existing
    from public.sellertray_commercial_branch_setup_readiness r
    where r.tenant_id=p_tenant_id and r.commercial_order_id=p_commercial_order_id and r.branch_id=p_branch_id;
  end if;

  if v_existing.commercial_order_id<>p_commercial_order_id
     or v_existing.branch_id<>p_branch_id
     or v_existing.evidence is distinct from v_evidence
     or v_existing.actor_user_id<>p_actor_user_id
     or v_existing.reason<>v_reason
     or v_existing.ready_at<>p_ready_at then
    raise exception 'SellerTray setup readiness is already recorded with different facts' using errcode='23505';
  end if;
  return v_existing.id;
end;
$$;

revoke all on function public.mark_sellertray_commercial_branch_setup_ready(uuid,uuid,uuid,uuid,jsonb,text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.mark_sellertray_commercial_branch_setup_ready(uuid,uuid,uuid,uuid,jsonb,text,timestamptz,uuid) to service_role;

comment on function public.mark_sellertray_commercial_branch_setup_ready(uuid,uuid,uuid,uuid,jsonb,text,timestamptz,uuid)
  is 'OA3 readiness fact writer. Existing facts replay idempotently; every new SellerTray runtime fact must be backed by the matching immutable completed setup appointment event. Database-owner sessions retain break-glass/migration authority only.';

-- Source: 20261024091000_oa3_setup_scheduling_scope_repair.sql
-- OA3 scope repair.
-- Workers and service areas are ProcessEdge-global because worker capacity must
-- serialize across every merchant. Editing those masters therefore requires a
-- platform-scoped branch-setup capability. Tenant-scoped grants remain valid for
-- scheduling, Branch coverage assignment and appointment lifecycle commands for
-- their governed Business scope.

create or replace function public.platform_admin_upsert_setup_service_area(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_service_area_id uuid,
  p_code text,
  p_name text,
  p_active boolean,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
  v_code text:=lower(btrim(coalesce(p_code,'')));
  v_name text:=btrim(coalesce(p_name,''));
  v_reason text:=btrim(coalesce(p_reason,''));
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',null,now()) then
    raise exception 'Platform-scoped Branch setup management capability required for service-area masters' using errcode='42501';
  end if;
  if char_length(v_code) not between 2 and 64 or char_length(v_name) not between 2 and 160 or char_length(v_reason)<6 then
    raise exception 'Service area code, name and reason are required' using errcode='22023';
  end if;

  if p_service_area_id is null then
    insert into public.sellertray_setup_service_areas(code,name,active)
    values(v_code,v_name,coalesce(p_active,true)) returning id into v_id;
  else
    update public.sellertray_setup_service_areas
    set code=v_code,name=v_name,active=coalesce(p_active,true),updated_at=now()
    where id=p_service_area_id returning id into v_id;
    if v_id is null then raise exception 'Setup service area not found' using errcode='P0002'; end if;
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(
    p_actor_user_id,p_tenant_id,'setup_service_area_saved',
    jsonb_build_object('serviceAreaId',v_id,'reason',v_reason,'authorityScope','platform')
  );
  return v_id;
end;
$$;

create or replace function public.platform_admin_upsert_setup_worker(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_worker_id uuid,
  p_worker_code text,
  p_display_name text,
  p_active boolean,
  p_max_concurrent_setups integer,
  p_travel_buffer_minutes integer,
  p_service_area_ids uuid[],
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
  v_code text:=lower(btrim(coalesce(p_worker_code,'')));
  v_name text:=btrim(coalesce(p_display_name,''));
  v_reason text:=btrim(coalesce(p_reason,''));
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',null,now()) then
    raise exception 'Platform-scoped Branch setup management capability required for workforce masters' using errcode='42501';
  end if;
  if char_length(v_code) not between 2 and 64 or char_length(v_name) not between 2 and 160 or char_length(v_reason)<6
     or coalesce(p_max_concurrent_setups,0) not between 1 and 20
     or coalesce(p_travel_buffer_minutes,-1) not between 0 and 480 then
    raise exception 'Valid worker identity, capacity, travel buffer and reason are required' using errcode='22023';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_service_area_ids,'{}'::uuid[])) x(id)
    where not exists (
      select 1 from public.sellertray_setup_service_areas a where a.id=x.id and a.active
    )
  ) then
    raise exception 'Worker coverage contains an inactive or unknown service area' using errcode='23514';
  end if;

  if p_worker_id is null then
    insert into public.sellertray_setup_workers(
      worker_code,display_name,active,max_concurrent_setups,travel_buffer_minutes
    ) values(
      v_code,v_name,coalesce(p_active,true),p_max_concurrent_setups,p_travel_buffer_minutes
    ) returning id into v_id;
  else
    update public.sellertray_setup_workers
    set worker_code=v_code,
        display_name=v_name,
        active=coalesce(p_active,true),
        max_concurrent_setups=p_max_concurrent_setups,
        travel_buffer_minutes=p_travel_buffer_minutes,
        updated_at=now()
    where id=p_worker_id returning id into v_id;
    if v_id is null then raise exception 'Setup worker not found' using errcode='P0002'; end if;
  end if;

  delete from public.sellertray_setup_worker_service_areas where worker_id=v_id;
  insert into public.sellertray_setup_worker_service_areas(worker_id,service_area_id)
  select v_id,x.id from unnest(coalesce(p_service_area_ids,'{}'::uuid[])) x(id)
  on conflict do nothing;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(
    p_actor_user_id,p_tenant_id,'setup_worker_saved',
    jsonb_build_object(
      'workerId',v_id,
      'reason',v_reason,
      'serviceAreaIds',coalesce(to_jsonb(p_service_area_ids),'[]'::jsonb),
      'authorityScope','platform'
    )
  );
  return v_id;
end;
$$;

-- Merchant requested windows are advisory but must still be prospective.
create or replace function public.request_sellertray_setup_reschedule(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_requested_start_at timestamptz,
  p_requested_end_at timestamptz,
  p_merchant_note text,
  p_command_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=(select auth.uid());
  v_role text;
  v_appointment public.sellertray_commercial_setup_appointments%rowtype;
  v_existing public.sellertray_setup_reschedule_requests%rowtype;
  v_id uuid;
  v_note text:=btrim(coalesce(p_merchant_note,''));
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role is null or v_role not in ('owner','manager') then
    raise exception 'Setup reschedule requests require an Owner or Manager' using errcode='42501';
  end if;
  if p_command_id is null or char_length(v_note) not between 6 and 2000 then
    raise exception 'Reschedule command and note are required' using errcode='22023';
  end if;
  if (p_requested_start_at is null)<>(p_requested_end_at is null)
     or (p_requested_start_at is not null and p_requested_end_at<=p_requested_start_at) then
    raise exception 'Requested setup window must be complete and valid' using errcode='22023';
  end if;
  if p_requested_start_at is not null and p_requested_start_at<now()-interval '5 minutes' then
    raise exception 'Requested setup window cannot start in the past' using errcode='22023';
  end if;

  select a.* into strict v_appointment
  from public.sellertray_commercial_setup_appointments a
  where a.id=p_appointment_id and a.tenant_id=p_tenant_id;
  if v_appointment.status<>'scheduled' then
    raise exception 'Only a scheduled setup can be changed' using errcode='23514';
  end if;

  select r.* into v_existing
  from public.sellertray_setup_reschedule_requests r
  where r.command_id=p_command_id;
  if found then
    if v_existing.tenant_id<>p_tenant_id
       or v_existing.appointment_id<>p_appointment_id
       or v_existing.requested_by_user_id<>v_user_id
       or v_existing.requested_start_at is distinct from p_requested_start_at
       or v_existing.requested_end_at is distinct from p_requested_end_at
       or v_existing.merchant_note<>v_note then
      raise exception 'Setup reschedule command is already used for different facts' using errcode='23505';
    end if;
    return v_existing.id;
  end if;
  if exists(
    select 1 from public.sellertray_setup_reschedule_requests r
    where r.appointment_id=p_appointment_id and r.status='pending'
  ) then
    raise exception 'A setup reschedule request is already pending' using errcode='23505';
  end if;

  insert into public.sellertray_setup_reschedule_requests(
    appointment_id,tenant_id,branch_id,command_id,requested_by_user_id,
    requested_start_at,requested_end_at,merchant_note
  ) values(
    p_appointment_id,p_tenant_id,v_appointment.branch_id,p_command_id,v_user_id,
    p_requested_start_at,p_requested_end_at,v_note
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.platform_admin_upsert_setup_service_area(uuid,uuid,uuid,text,text,boolean,text) from public,anon,authenticated;
revoke all on function public.platform_admin_upsert_setup_worker(uuid,uuid,uuid,text,text,boolean,integer,integer,uuid[],text) from public,anon,authenticated;
revoke all on function public.request_sellertray_setup_reschedule(uuid,uuid,timestamptz,timestamptz,text,uuid) from public,anon,authenticated;

grant execute on function public.platform_admin_upsert_setup_service_area(uuid,uuid,uuid,text,text,boolean,text) to service_role;
grant execute on function public.platform_admin_upsert_setup_worker(uuid,uuid,uuid,text,text,boolean,integer,integer,uuid[],text) to service_role;
grant execute on function public.request_sellertray_setup_reschedule(uuid,uuid,timestamptz,timestamptz,text,uuid) to authenticated;

comment on function public.platform_admin_upsert_setup_worker(uuid,uuid,uuid,text,text,boolean,integer,integer,uuid[],text)
  is 'OA3 ProcessEdge-global workforce master mutation. Requires platform-scoped admin.branch_setup.manage; appointment scheduling remains tenant-scoped.';
comment on function public.platform_admin_upsert_setup_service_area(uuid,uuid,uuid,text,text,boolean,text)
  is 'OA3 ProcessEdge-global service-area master mutation. Requires platform-scoped admin.branch_setup.manage; Branch area assignment remains tenant-scoped.';

-- Source: 20261024091500_oa3_setup_scheduling_master_visibility.sql
create or replace function public.platform_admin_setup_scheduling_center(
  p_actor_user_id uuid,
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_result jsonb;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then
    raise exception 'Branch setup management capability required' using errcode='42501';
  end if;

  select jsonb_build_object(
    'canManage',true,
    'canManagePlatformMasters',public.platform_admin_has_capability(
      p_actor_user_id,'admin.branch_setup.manage',null,now()
    ),
    'serviceAreas',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'code',a.code,'name',a.name,'active',a.active
      ) order by a.name)
      from public.sellertray_setup_service_areas a
    ),'[]'::jsonb),
    'workers',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',w.id,
        'code',w.worker_code,
        'name',w.display_name,
        'active',w.active,
        'maxConcurrentSetups',w.max_concurrent_setups,
        'travelBufferMinutes',w.travel_buffer_minutes,
        'serviceAreaIds',coalesce((
          select jsonb_agg(c.service_area_id order by c.service_area_id)
          from public.sellertray_setup_worker_service_areas c
          where c.worker_id=w.id
        ),'[]'::jsonb)
      ) order by w.display_name)
      from public.sellertray_setup_workers w
    ),'[]'::jsonb),
    'branchAreas',coalesce((
      select jsonb_agg(jsonb_build_object(
        'branchId',b.id,
        'branchCode',b.code,
        'branchName',b.name,
        'serviceAreaId',ba.service_area_id
      ) order by b.name)
      from public.branches b
      left join public.sellertray_setup_branch_service_areas ba
        on ba.tenant_id=b.tenant_id and ba.branch_id=b.id
      where b.tenant_id=p_tenant_id and b.is_active
    ),'[]'::jsonb),
    'appointments',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,
        'commercialOrderId',a.commercial_order_id,
        'branchId',a.branch_id,
        'branchName',b.name,
        'workerId',a.worker_id,
        'workerName',w.display_name,
        'serviceAreaId',a.service_area_id,
        'serviceAreaName',sa.name,
        'scheduledStartAt',a.scheduled_start_at,
        'scheduledEndAt',a.scheduled_end_at,
        'status',a.status,
        'merchantNote',a.merchant_note,
        'internalNote',a.internal_note,
        'createdAt',a.created_at,
        'completedAt',a.completed_at
      ) order by a.scheduled_start_at desc)
      from public.sellertray_commercial_setup_appointments a
      join public.branches b on b.id=a.branch_id
      join public.sellertray_setup_workers w on w.id=a.worker_id
      join public.sellertray_setup_service_areas sa on sa.id=a.service_area_id
      where a.tenant_id=p_tenant_id
    ),'[]'::jsonb),
    'pendingRequests',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',r.id,
        'appointmentId',r.appointment_id,
        'branchId',r.branch_id,
        'requestedStartAt',r.requested_start_at,
        'requestedEndAt',r.requested_end_at,
        'merchantNote',r.merchant_note,
        'requestedAt',r.requested_at,
        'requestedByUserId',r.requested_by_user_id
      ) order by r.requested_at)
      from public.sellertray_setup_reschedule_requests r
      where r.tenant_id=p_tenant_id and r.status='pending'
    ),'[]'::jsonb),
    'setupSubjects',coalesce((
      select jsonb_agg(jsonb_build_object(
        'commercialOrderId',s.commercial_order_id,
        'branchId',s.branch_id,
        'branchCode',b.code,
        'branchName',b.name,
        'ready',rr.id is not null,
        'readyAt',rr.ready_at,
        'serviceAreaId',ba.service_area_id
      ) order by s.line_no)
      from public.sellertray_commercial_order_price_snapshots s
      join public.branches b on b.id=s.branch_id and b.tenant_id=s.tenant_id
      left join public.sellertray_commercial_branch_setup_readiness rr
        on rr.tenant_id=s.tenant_id
       and rr.commercial_order_id=s.commercial_order_id
       and rr.branch_id=s.branch_id
      left join public.sellertray_setup_branch_service_areas ba
        on ba.tenant_id=s.tenant_id and ba.branch_id=s.branch_id
      where s.tenant_id=p_tenant_id and s.line_type='branch_setup'
    ),'[]'::jsonb),
    'generatedAt',now()
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.platform_admin_setup_scheduling_center(uuid,uuid) from public,anon,authenticated;
grant execute on function public.platform_admin_setup_scheduling_center(uuid,uuid) to service_role;

comment on function public.platform_admin_setup_scheduling_center(uuid,uuid)
  is 'OA3 Admin scheduling projection. Tenant-scoped setup managers can schedule their Business; canManagePlatformMasters separately indicates ProcessEdge-global workforce/service-area edit authority.';

-- Source: 20261024174609_oa4_setup_readiness_activation.sql
-- OA3 uses this named capability, but the grant vocabulary previously omitted
-- it. Permit explicit scoped assignments without changing default Support power.
alter table public.platform_admin_capability_grant_versions drop constraint platform_admin_capability_code_check;
alter table public.platform_admin_capability_grant_versions add constraint platform_admin_capability_code_check
  check (capability_code in ('admin.pricing.manage','admin.payments.reconcile','admin.installments.manage','admin.branch_setup.manage'));

-- OA4 extends immutable appointment evidence and the existing entitlement authority.
-- No new setup/activation status is persisted. Historical readiness is preserved.
create or replace function public.assert_sellertray_setup_completion_evidence(p_evidence jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare v_item jsonb; v_key text;
begin
  if jsonb_typeof(p_evidence) is distinct from 'object' or p_evidence->'schemaVersion' is distinct from '1'::jsonb then
    raise exception 'Structured setup completion evidence version 1 is required' using errcode='22023';
  end if;
  foreach v_key in array array['branchConfigured','merchantWalkthrough'] loop
    if p_evidence->'checklist'->v_key is distinct from 'true'::jsonb then
      raise exception 'Complete every required setup checklist item' using errcode='22023';
    end if;
  end loop;
  foreach v_key in array array['receivedBy','acknowledgement'] loop
    if jsonb_typeof(p_evidence->v_key) is distinct from 'string' or char_length(btrim(p_evidence->>v_key)) not between 2 and 2000 then
      raise exception 'Merchant representative and acknowledgement evidence are required' using errcode='22023';
    end if;
  end loop;
  if jsonb_typeof(p_evidence->'equipment') is distinct from 'array' then
    raise exception 'Bluetooth printer handover evidence is required' using errcode='22023';
  end if;
  if jsonb_array_length(p_evidence->'equipment') not between 1 and 20 or not exists (
    select 1 from jsonb_array_elements(p_evidence->'equipment') e where e->>'kind'='bluetooth_printer'
  ) then raise exception 'Bluetooth printer handover evidence is required' using errcode='22023'; end if;
  for v_item in select value from jsonb_array_elements(p_evidence->'equipment') loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or coalesce(v_item->>'provisioning','') not in ('supplied','configured')
       or v_item->'pairingTestResult' is distinct from '"passed"'::jsonb
       or v_item->'testReceiptPrinted' is distinct from 'true'::jsonb then
      raise exception 'Each supplied/configured device must pass pairing and a test print' using errcode='22023';
    end if;
    foreach v_key in array array['kind','identifier','handoverCondition'] loop
      if jsonb_typeof(v_item->v_key) is distinct from 'string' or char_length(btrim(v_item->>v_key)) not between 2 and 500 then
        raise exception 'Equipment identity and handover condition are required' using errcode='22023';
      end if;
    end loop;
  end loop;
end;
$$;
revoke all on function public.assert_sellertray_setup_completion_evidence(jsonb) from public,anon,authenticated;
grant execute on function public.assert_sellertray_setup_completion_evidence(jsonb) to service_role;

create or replace function public.platform_admin_transition_branch_setup(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_target_status text,
  p_command_id uuid,
  p_reason text,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_appointment public.sellertray_commercial_setup_appointments%rowtype;
  v_existing_event public.sellertray_commercial_setup_appointment_events%rowtype;
  v_target text:=lower(btrim(coalesce(p_target_status,'')));
  v_expected_event_type text:=case when lower(btrim(coalesce(p_target_status,'')))='in_progress' then 'started' else lower(btrim(coalesce(p_target_status,''))) end;
  v_reason text:=btrim(coalesce(p_reason,''));
  v_readiness_id uuid;
  v_obligation_id uuid;
  v_state jsonb;
  v_reconciliation jsonb := null;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then raise exception 'Branch setup management capability required' using errcode='42501'; end if;
  if p_command_id is null or char_length(v_reason)<6 or jsonb_typeof(coalesce(p_evidence,'{}'::jsonb))<>'object' then raise exception 'Transition command, reason and evidence are required' using errcode='22023'; end if;
  if v_target not in ('in_progress','completed','cancelled','no_show') then raise exception 'Unsupported setup appointment transition' using errcode='22023'; end if;

  -- Serialize command retries, including concurrent requests.
  perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,0));
  select e.* into v_existing_event from public.sellertray_commercial_setup_appointment_events e where e.command_id=p_command_id;
  if found then
    if v_existing_event.tenant_id<>p_tenant_id or v_existing_event.appointment_id<>p_appointment_id or v_existing_event.event_type<>v_expected_event_type
      or v_existing_event.actor_user_id<>p_actor_user_id or v_existing_event.reason<>v_reason
      or v_existing_event.details->'evidence' is distinct from coalesce(p_evidence,'{}'::jsonb) then raise exception 'Setup transition command is already used for different facts' using errcode='23505'; end if;
    select jsonb_build_object('appointmentId',a.id,'status',a.status,'readinessId',r.id)
      into v_state
    from public.sellertray_commercial_setup_appointments a
    left join public.sellertray_commercial_branch_setup_readiness r on r.tenant_id=a.tenant_id and r.commercial_order_id=a.commercial_order_id and r.branch_id=a.branch_id
    where a.id=p_appointment_id;
    return v_state;
  end if;

  -- Same order lock as settlement/reconciliation, before appointment row locks.
  perform public.lock_sellertray_commercial_order(a.tenant_id,a.commercial_order_id)
  from public.sellertray_commercial_setup_appointments a where a.id=p_appointment_id and a.tenant_id=p_tenant_id;
  select a.* into strict v_appointment from public.sellertray_commercial_setup_appointments a where a.id=p_appointment_id and a.tenant_id=p_tenant_id for update;
  if v_target='in_progress' and v_appointment.status<>'scheduled' then raise exception 'Only a scheduled setup can start' using errcode='23514'; end if;
  if v_target in ('completed','no_show') and v_appointment.status not in ('scheduled','in_progress') then raise exception 'Only an active setup appointment can finish' using errcode='23514'; end if;
  if v_target='cancelled' and v_appointment.status<>'scheduled' then raise exception 'Only a scheduled setup appointment can be cancelled' using errcode='23514'; end if;

  if v_target='completed' then
    perform public.assert_sellertray_setup_completion_evidence(p_evidence);
  end if;

  update public.sellertray_commercial_setup_appointments
  set status=v_target,updated_at=now(),completed_at=case when v_target='completed' then now() else completed_at end,cancelled_at=case when v_target='cancelled' then now() else cancelled_at end
  where id=p_appointment_id;

  insert into public.sellertray_commercial_setup_appointment_events(
    appointment_id,tenant_id,commercial_order_id,branch_id,command_id,event_type,actor_user_id,actor_kind,reason,details
  ) values (
    p_appointment_id,p_tenant_id,v_appointment.commercial_order_id,v_appointment.branch_id,p_command_id,
    v_expected_event_type,p_actor_user_id,'platform',v_reason,
    jsonb_build_object('fromStatus',v_appointment.status,'toStatus',v_target,'evidence',coalesce(p_evidence,'{}'::jsonb),'workerId',v_appointment.worker_id,'completedAt',case when v_target='completed' then now() else null end,'actorUserId',p_actor_user_id)
  );

  if v_target='completed' then
    v_readiness_id:=public.mark_sellertray_commercial_branch_setup_ready(
      p_tenant_id,v_appointment.commercial_order_id,v_appointment.branch_id,p_command_id,
      coalesce(p_evidence,'{}'::jsonb)||jsonb_build_object('source','oa3_setup_appointment','appointmentId',p_appointment_id),
      v_reason,now(),p_actor_user_id
    );
    select io.id into v_obligation_id from public.sellertray_commercial_installment_obligations io
    where io.tenant_id=p_tenant_id and io.commercial_order_id=v_appointment.commercial_order_id order by io.created_at,io.id limit 1;
    if v_obligation_id is not null then
      -- A failed entitlement attempt must not erase valid completion/readiness.
      begin
        v_reconciliation:=public.reconcile_sellertray_installment_entitlement(p_tenant_id,v_obligation_id);
      exception when others then
        v_reconciliation:=jsonb_build_object('retryRequired',true);
        insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
        values(p_actor_user_id,p_tenant_id,'setup_activation_reconciliation_failed',jsonb_build_object('appointmentId',p_appointment_id,'obligationId',v_obligation_id,'sqlstate',sqlstate));
      end;
    end if;
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'branch_setup_'||v_target,jsonb_build_object('appointmentId',p_appointment_id,'commercialOrderId',v_appointment.commercial_order_id,'branchId',v_appointment.branch_id,'commandId',p_command_id));

  return jsonb_build_object('appointmentId',p_appointment_id,'status',v_target,'readinessId',v_readiness_id,'reconciliation',v_reconciliation);
end;
$$;

create or replace function public.mark_sellertray_commercial_branch_setup_ready(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_branch_id uuid,
  p_command_id uuid,
  p_evidence jsonb,
  p_reason text,
  p_ready_at timestamptz,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_evidence jsonb := coalesce(p_evidence,'{}'::jsonb);
  v_reason text := btrim(coalesce(p_reason,''));
  v_existing public.sellertray_commercial_branch_setup_readiness%rowtype;
  v_id uuid;
  v_database_owner_session boolean := session_user in ('postgres','supabase_admin');
begin
  if p_tenant_id is null or p_commercial_order_id is null or p_branch_id is null
     or p_command_id is null or p_ready_at is null or p_actor_user_id is null then
    raise exception 'Business, commercial order, Branch, command, setup time and actor are required' using errcode='22023';
  end if;
  if jsonb_typeof(v_evidence)<>'object' then
    raise exception 'Setup readiness evidence must be an object' using errcode='22023';
  end if;
  if char_length(v_reason) not between 1 and 1000 then
    raise exception 'Setup readiness reason is required' using errcode='22023';
  end if;
  if p_ready_at>now()+interval '5 minutes' then
    raise exception 'Setup readiness time cannot be in the future' using errcode='22023';
  end if;
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then
    raise exception 'Branch setup management capability required' using errcode='42501';
  end if;

  perform public.assert_sellertray_setup_subject(p_tenant_id,p_commercial_order_id,p_branch_id);

  -- Preserve idempotent replay of readiness facts that already existed before
  -- OA3. Only creation of a new readiness fact requires appointment completion.
  select r.* into v_existing
  from public.sellertray_commercial_branch_setup_readiness r
  where r.tenant_id=p_tenant_id and r.command_id=p_command_id;

  if not found then
    select r.* into v_existing
    from public.sellertray_commercial_branch_setup_readiness r
    where r.tenant_id=p_tenant_id
      and r.commercial_order_id=p_commercial_order_id
      and r.branch_id=p_branch_id;
  end if;

  if found then
    if v_existing.commercial_order_id<>p_commercial_order_id
       or v_existing.branch_id<>p_branch_id
       or v_existing.evidence is distinct from v_evidence
       or v_existing.actor_user_id<>p_actor_user_id
       or v_existing.reason<>v_reason
       or v_existing.ready_at<>p_ready_at then
      raise exception 'SellerTray setup readiness is already recorded with different facts' using errcode='23505';
    end if;
    return v_existing.id;
  end if;

  if not v_database_owner_session then
    perform public.assert_sellertray_setup_completion_evidence(v_evidence);
  end if;
  if not v_database_owner_session and not exists (
    select 1
    from public.sellertray_commercial_setup_appointment_events e
    join public.sellertray_commercial_setup_appointments a
      on a.id=e.appointment_id
     and a.tenant_id=e.tenant_id
     and a.commercial_order_id=e.commercial_order_id
     and a.branch_id=e.branch_id
    where e.tenant_id=p_tenant_id
      and e.commercial_order_id=p_commercial_order_id
      and e.branch_id=p_branch_id
      and e.command_id=p_command_id
      and e.event_type='completed'
      and e.actor_user_id=p_actor_user_id
      and a.status='completed'
      and v_evidence = (e.details->'evidence') || jsonb_build_object('source','oa3_setup_appointment','appointmentId',a.id)
      and p_ready_at=a.completed_at
  ) then
    raise exception 'Branch setup readiness must come from a completed governed setup appointment' using errcode='23514';
  end if;

  insert into public.sellertray_commercial_branch_setup_readiness(
    tenant_id,commercial_order_id,branch_id,command_id,evidence,
    actor_user_id,reason,ready_at,recorded_at
  ) values (
    p_tenant_id,p_commercial_order_id,p_branch_id,p_command_id,v_evidence,
    p_actor_user_id,v_reason,p_ready_at,now()
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is not null then return v_id; end if;

  select r.* into v_existing
  from public.sellertray_commercial_branch_setup_readiness r
  where r.tenant_id=p_tenant_id and r.command_id=p_command_id;

  if not found then
    select r.* into strict v_existing
    from public.sellertray_commercial_branch_setup_readiness r
    where r.tenant_id=p_tenant_id and r.commercial_order_id=p_commercial_order_id and r.branch_id=p_branch_id;
  end if;

  if v_existing.commercial_order_id<>p_commercial_order_id
     or v_existing.branch_id<>p_branch_id
     or v_existing.evidence is distinct from v_evidence
     or v_existing.actor_user_id<>p_actor_user_id
     or v_existing.reason<>v_reason
     or v_existing.ready_at<>p_ready_at then
    raise exception 'SellerTray setup readiness is already recorded with different facts' using errcode='23505';
  end if;
  return v_existing.id;
end;
$$;

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
  v_settlement jsonb;
  v_billing jsonb;
  v_direct_payment_amount numeric(18,2):=0;
  v_policy jsonb;
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
        and public.sellertray_commercial_agreement_terms_current(a.id)
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

    v_settlement:=public.get_sellertray_commercial_settlement_state(p_tenant_id,v_order.id);
    v_policy:=public.resolve_sellertray_installment_policy(p_tenant_id,v_order.id,v_plan_code,v_billing_cycle,now());
    v_approved_adjustment_amount:=(v_settlement->>'approvedAdjustmentAmount')::numeric;
    v_direct_payment_amount:=(v_settlement->>'directPaymentAmount')::numeric;
    v_confirmed_payment_amount:=(v_settlement->>'totalConfirmedPaymentAmount')::numeric;
    v_outstanding_amount:=(v_settlement->>'outstandingAmount')::numeric;
    v_fully_settled:=v_outstanding_amount<0.005;
    if v_obligation.id is not null then
      v_billing:=public.get_sellertray_installment_billing_state(p_tenant_id,v_obligation.id);
      v_qualifying_settlement:=coalesce((v_billing->>'qualifyingSettlementSatisfied')::boolean,false);
      v_paid_schedule_count:=(v_billing->>'paidInstallmentCount')::integer;
      v_first_installment_amount:=(v_settlement->'schedule'->0->>'amountDue')::numeric;
      v_first_paid_at:=(v_billing->>'firstPaidAt')::timestamptz;
    else
      v_qualifying_settlement:=v_fully_settled;
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
            'readyAt',r.ready_at,
            'setupStatus',case when r.id is not null then 'Setup complete' when ap.status='completed' then 'Completion needs review' when ap.status='in_progress' then 'Setup in progress' when ap.status='scheduled' then 'Setup scheduled' when ap.status='no_show' then 'Setup missed' when ap.status='cancelled' then 'Setup cancelled' else 'Setup not scheduled' end,
            'scheduledStartAt',ap.scheduled_start_at
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
    left join lateral (
      select a.status,a.scheduled_start_at from public.sellertray_commercial_setup_appointments a
      where a.tenant_id=ps.tenant_id and a.commercial_order_id=ps.commercial_order_id and a.branch_id=ps.branch_id
      order by a.created_at desc,a.id desc limit 1
    ) ap on true
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

  -- Report every blocking Branch even when agreement/payment is also pending.
  if v_entitlement_state='not_active' and v_setup_required_count>v_setup_ready_count then
    v_blockers := coalesce((select jsonb_agg(b) from jsonb_array_elements(v_blockers) b where b->>'code'<>'branch_setup_incomplete'),'[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object('code','branch_setup_incomplete','branchId',b->>'branchId','message',(b->>'branchName') || ' — ' || (b->>'setupStatus') || '. Activation is waiting for this Branch.','surface','admin_web')) from jsonb_array_elements(v_setup_branches) b where not (b->>'ready')::boolean),'[]'::jsonb);
  end if;
  return jsonb_build_object(
    'readModelVersion','oa4-v1',
    'generatedAt',now(),
    'tenantId',p_tenant_id,
    'currentStage',v_current_stage,
    'blockers',v_blockers,
    'nextAction',v_next_action,
    'accessEnforcement','governed_runtime',
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
      'gatewayPaymentAmount',coalesce((v_settlement->>'gatewayPaymentAmount')::numeric,0),
      'directPaymentAmount',v_direct_payment_amount,
      'confirmedPaymentAmount',v_confirmed_payment_amount,
      'outstandingAmount',v_outstanding_amount,
      'qualifyingSettlementSatisfied',v_qualifying_settlement,
      'fullySettled',v_fully_settled,
      'installmentCount',v_schedule_count,
      'paidInstallmentCount',v_paid_schedule_count,
      'firstInstallmentAmount',v_first_installment_amount,
      'firstPaidAt',v_first_paid_at
    ),
    'installmentPolicy',v_policy,
    'branchSetup',jsonb_build_object(
      'requiredCount',v_setup_required_count,
      'readyCount',v_setup_ready_count,
      'ready',v_setup_required_count>0 and v_setup_ready_count=v_setup_required_count,
      'branches',v_setup_branches
    ),
    'activation',jsonb_build_object(
      'entitlementState',v_entitlement_state,
      'effectiveFrom',v_entitlement_effective_from,'guaranteeStart',v_entitlement_effective_from,'guaranteeEnd',v_entitlement_effective_from+interval '1 month',
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

create or replace function public.platform_admin_setup_scheduling_center(
  p_actor_user_id uuid,
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_result jsonb;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then
    raise exception 'Branch setup management capability required' using errcode='42501';
  end if;

  select jsonb_build_object(
    'canManage',true,
    'canManagePlatformMasters',public.platform_admin_has_capability(
      p_actor_user_id,'admin.branch_setup.manage',null,now()
    ),
    'serviceAreas',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'code',a.code,'name',a.name,'active',a.active
      ) order by a.name)
      from public.sellertray_setup_service_areas a
    ),'[]'::jsonb),
    'workers',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',w.id,
        'code',w.worker_code,
        'name',w.display_name,
        'active',w.active,
        'maxConcurrentSetups',w.max_concurrent_setups,
        'travelBufferMinutes',w.travel_buffer_minutes,
        'serviceAreaIds',coalesce((
          select jsonb_agg(c.service_area_id order by c.service_area_id)
          from public.sellertray_setup_worker_service_areas c
          where c.worker_id=w.id
        ),'[]'::jsonb)
      ) order by w.display_name)
      from public.sellertray_setup_workers w
    ),'[]'::jsonb),
    'branchAreas',coalesce((
      select jsonb_agg(jsonb_build_object(
        'branchId',b.id,
        'branchCode',b.code,
        'branchName',b.name,
        'serviceAreaId',ba.service_area_id
      ) order by b.name)
      from public.branches b
      left join public.sellertray_setup_branch_service_areas ba
        on ba.tenant_id=b.tenant_id and ba.branch_id=b.id
      where b.tenant_id=p_tenant_id and b.is_active
    ),'[]'::jsonb),
    'appointments',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,
        'commercialOrderId',a.commercial_order_id,
        'branchId',a.branch_id,
        'branchName',b.name,
        'workerId',a.worker_id,
        'workerName',w.display_name,
        'serviceAreaId',a.service_area_id,
        'serviceAreaName',sa.name,
        'scheduledStartAt',a.scheduled_start_at,
        'scheduledEndAt',a.scheduled_end_at,
        'status',a.status,
        'merchantNote',a.merchant_note,
        'internalNote',a.internal_note,
        'createdAt',a.created_at,
        'completedAt',a.completed_at
      ) order by a.scheduled_start_at desc)
      from public.sellertray_commercial_setup_appointments a
      join public.branches b on b.id=a.branch_id
      join public.sellertray_setup_workers w on w.id=a.worker_id
      join public.sellertray_setup_service_areas sa on sa.id=a.service_area_id
      where a.tenant_id=p_tenant_id
    ),'[]'::jsonb),
    'pendingRequests',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',r.id,
        'appointmentId',r.appointment_id,
        'branchId',r.branch_id,
        'requestedStartAt',r.requested_start_at,
        'requestedEndAt',r.requested_end_at,
        'merchantNote',r.merchant_note,
        'requestedAt',r.requested_at,
        'requestedByUserId',r.requested_by_user_id
      ) order by r.requested_at)
      from public.sellertray_setup_reschedule_requests r
      where r.tenant_id=p_tenant_id and r.status='pending'
    ),'[]'::jsonb),
    'onboarding',public.get_sellertray_onboarding_state_core(p_tenant_id),
    'setupSubjects',coalesce((
      select jsonb_agg(jsonb_build_object(
        'commercialOrderId',s.commercial_order_id,
        'branchId',s.branch_id,
        'branchCode',b.code,
        'branchName',b.name,
        'ready',rr.id is not null,
        'readyAt',rr.ready_at,'completionEvidence',rr.evidence,
        'serviceAreaId',ba.service_area_id
      ) order by s.line_no)
      from public.sellertray_commercial_order_price_snapshots s
      join public.branches b on b.id=s.branch_id and b.tenant_id=s.tenant_id
      left join public.sellertray_commercial_branch_setup_readiness rr
        on rr.tenant_id=s.tenant_id
       and rr.commercial_order_id=s.commercial_order_id
       and rr.branch_id=s.branch_id
      left join public.sellertray_setup_branch_service_areas ba
        on ba.tenant_id=s.tenant_id and ba.branch_id=s.branch_id
      where s.tenant_id=p_tenant_id and s.line_type='branch_setup'
    ),'[]'::jsonb),
    'generatedAt',now()
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.ensure_orderdesk_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trial_days integer := 14;
begin
  select coalesce(p.trial_days, 14)
  into v_trial_days
  from public.subscription_plans p
  where p.code = 'business';

  insert into public.tenant_subscriptions (
    tenant_id,
    plan_code,
    status,
    trial_started_at,
    trial_ends_at
  ) values (
    new.id,
    'business',
    'trial',
    now(),
    now()
  )
  on conflict (tenant_id) do nothing;

  return new;
end;
$$;

create or replace function public.sellertray_has_governed_subscription_purchase(p_tenant_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' and not exists (
    select 1 from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=auth.uid()
  ) and session_user not in ('postgres','supabase_admin') then return false; end if;
  return exists(select 1 from public.sellertray_commercial_order_price_snapshots ps where ps.tenant_id=p_tenant_id and ps.line_type='subscription');
end;
$$;
revoke all on function public.sellertray_has_governed_subscription_purchase(uuid) from public,anon;
grant execute on function public.sellertray_has_governed_subscription_purchase(uuid) to authenticated,service_role;
create or replace function public.orderdesk_subscription_can_write(p_tenant_id uuid)
returns boolean
language sql
stable
set search_path=''
as $$
  select coalesce(
    (
      select case
        when public.sellertray_c1b_runtime_period_state(s.tenant_id) in (
          'provisional_expired','full_term_expired'
        ) then false
        when s.status = 'active' then true
        when s.status = 'trial' and public.sellertray_has_governed_subscription_purchase(s.tenant_id) then false
        when s.status = 'trial' then s.trial_ends_at is null or s.trial_ends_at > now()
        when s.status = 'grace' then s.grace_ends_at is null or s.grace_ends_at > now()
        else false
      end
      from public.tenant_subscriptions s
      where s.tenant_id = p_tenant_id
    ),
    false
  );
$$;

create or replace function public.get_orderdesk_subscription_access(p_tenant_id uuid)
returns jsonb
language sql
stable
set search_path=''
as $$
  select jsonb_build_object(
    'planCode', s.plan_code,
    'planName', p.name,
    'baseStatus', s.status,
    'effectiveStatus', case
      when s.status='trial' and not public.orderdesk_subscription_can_write(s.tenant_id) then 'pending_setup'
      when public.sellertray_c1b_runtime_period_state(s.tenant_id)='provisional_expired' then 'past_due'
      when public.sellertray_c1b_runtime_period_state(s.tenant_id)='full_term_expired' then 'past_due'
      when s.status = 'trial' and s.trial_ends_at is not null and s.trial_ends_at <= now() then 'trial_expired'
      when s.status = 'grace' and s.grace_ends_at is not null and s.grace_ends_at <= now() then 'grace_expired'
      else s.status
    end,
    'accessMode', case
      when not public.orderdesk_subscription_can_write(s.tenant_id) then 'read_only'
      when public.sellertray_c1b_runtime_period_state(s.tenant_id) in (
        'provisional_expired','full_term_expired'
      ) then 'read_only'
      when s.status = 'active' then 'full'
      when s.status = 'trial' and (s.trial_ends_at is null or s.trial_ends_at > now()) then 'full'
      when s.status = 'grace' and (s.grace_ends_at is null or s.grace_ends_at > now()) then 'full'
      else 'read_only'
    end,
     'offlineWriteAllowedUntil',case
      when s.status='trial' then s.trial_ends_at
      when s.status='grace' then s.grace_ends_at
      when public.sellertray_c1b_runtime_period_state(s.tenant_id)<>'legacy' then s.current_period_end
      else null end,
    'commercialEntitlementState', public.sellertray_c1b_runtime_period_state(s.tenant_id),
    'trialStartedAt', s.trial_started_at,
    'trialEndsAt', s.trial_ends_at,
    'currentPeriodStart', s.current_period_start,
    'currentPeriodEnd', s.current_period_end,
    'graceEndsAt', s.grace_ends_at,
    'cancelAtPeriodEnd', s.cancel_at_period_end,
    'currency', p.currency,
    'priceAmount', p.price_amount,
    'billingInterval', p.billing_interval,
    'checkoutReady', (
      p.is_active = true
      and p.provider = 'paystack'
      and p.provider_plan_ref is not null
      and p.price_amount is not null
      and p.price_amount > 0
    ),
    'usageEventCode', p.usage_event_code,
    'usageUnitPrice', p.usage_unit_price,
    'usagePricingActive', (p.usage_unit_price is not null and p.usage_unit_price > 0),
    'usageBillableNow', (
      public.orderdesk_subscription_can_write(s.tenant_id)
      and s.status in ('active', 'grace')
      and p.usage_unit_price is not null
      and p.usage_unit_price > 0
    ),
    'usageUnitsThisPeriod', coalesce((
      select sum(u.quantity)
      from public.usage_events u
      where u.tenant_id = s.tenant_id
        and u.event_code = p.usage_event_code
        and u.occurred_at >= coalesce(s.current_period_start, s.trial_started_at, date_trunc('month', now()))
        and u.occurred_at < coalesce(s.current_period_end, s.trial_ends_at, date_trunc('month', now()) + interval '1 month')
    ), 0),
    'usageAmountThisPeriod', coalesce((
      select sum(u.amount)
      from public.usage_events u
      where u.tenant_id = s.tenant_id
        and u.event_code = p.usage_event_code
        and u.occurred_at >= coalesce(s.current_period_start, s.trial_started_at, date_trunc('month', now()))
        and u.occurred_at < coalesce(s.current_period_end, s.trial_ends_at, date_trunc('month', now()) + interval '1 month')
    ), 0)
  )
  from public.tenant_subscriptions s
  join public.subscription_plans p on p.code = s.plan_code
  where s.tenant_id = p_tenant_id;
$$;

-- Preparation is a bounded exception for profile/Branch setup only. It is
-- not an operational write entitlement and cannot revive a previously activated Business.
create or replace function public.sellertray_business_is_preparing(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.tenant_subscriptions s where s.tenant_id=p_tenant_id and s.status='trial' and s.current_period_start is null and s.current_period_end is null)
    and not exists(select 1 from public.sellertray_commercial_entitlement_events e where e.tenant_id=p_tenant_id and e.event_type in ('installment.provisional_activated','installment.full_entitlement_released'));
$$;
revoke all on function public.sellertray_business_is_preparing(uuid) from public,anon,authenticated;
grant execute on function public.sellertray_business_is_preparing(uuid) to service_role;
create or replace function public.save_sellertray_branch(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_code text,
  p_name text,
  p_is_default boolean,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_branch_id uuid := p_branch_id;
  v_code text := upper(nullif(btrim(coalesce(p_code,'')),''));
  v_name text := nullif(btrim(coalesce(p_name,'')),'');
  v_existing public.branches%rowtype;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Only business Owners and Managers can manage Branches' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) and not public.sellertray_business_is_preparing(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if v_code is null or v_name is null then
    raise exception 'Branch code and name are required' using errcode='22023';
  end if;
  if char_length(v_code)>40 or char_length(v_name)>120 then
    raise exception 'Branch code or name is too long' using errcode='22023';
  end if;
  if coalesce(p_is_default,false) and not coalesce(p_is_active,true) then
    raise exception 'The default Branch must remain active' using errcode='23514';
  end if;

  if v_branch_id is not null then
    select * into v_existing
    from public.branches b
    where b.tenant_id=p_tenant_id and b.id=v_branch_id
    for update;
    if not found then raise exception 'Branch not found' using errcode='22023'; end if;
    if v_existing.is_default and not coalesce(p_is_default,false) then
      raise exception 'Choose another default Branch before clearing this one' using errcode='23514';
    end if;
    if v_existing.is_default and not coalesce(p_is_active,true) then
      raise exception 'Choose another default Branch before archiving this one' using errcode='23514';
    end if;
  end if;

  if coalesce(p_is_default,false) then
    update public.branches b
    set is_default=false,updated_at=now()
    where b.tenant_id=p_tenant_id
      and (v_branch_id is null or b.id<>v_branch_id)
      and b.is_default=true;
  end if;

  if v_branch_id is null then
    insert into public.branches(tenant_id,code,name,is_default,is_active)
    values(p_tenant_id,v_code,v_name,coalesce(p_is_default,false),coalesce(p_is_active,true))
    returning id into v_branch_id;
  else
    update public.branches b
    set code=v_code,
        name=v_name,
        is_default=coalesce(p_is_default,false),
        is_active=coalesce(p_is_active,true),
        updated_at=now()
    where b.tenant_id=p_tenant_id and b.id=v_branch_id;
  end if;

  return v_branch_id;
end;
$$;



create or replace function public.save_sellertray_business_profile(
  p_tenant_id uuid,
  p_name text,
  p_business_email text default null,
  p_business_phone text default null,
  p_business_type text default null,
  p_logo_url text default null,
  p_currency text default 'NGN',
  p_timezone text default 'Africa/Lagos'
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name,'')),'');
  v_email text := nullif(lower(btrim(coalesce(p_business_email,''))),'');
  v_phone text := nullif(btrim(coalesce(p_business_phone,'')),'');
  v_type text := nullif(btrim(coalesce(p_business_type,'')),'');
  v_logo text := nullif(btrim(coalesce(p_logo_url,'')),'');
  v_currency text := upper(nullif(btrim(coalesce(p_currency,'')),''));
  v_timezone text := nullif(btrim(coalesce(p_timezone,'')),'');
  v_issuer text;
  v_logo_prefix text;
  v_logo_object_name text;
  v_row public.tenants%rowtype;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  if not exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Only business Owners and Managers can update business settings' using errcode='42501';
  end if;

  if not public.orderdesk_subscription_can_write(p_tenant_id) and not public.sellertray_business_is_preparing(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  if v_name is null then
    raise exception 'Business name is required' using errcode='22023';
  end if;
  if char_length(v_name)>160 then
    raise exception 'Business name is too long' using errcode='22023';
  end if;
  if v_email is not null and (char_length(v_email)>320 or position('@' in v_email)<=1) then
    raise exception 'Business email is invalid' using errcode='22023';
  end if;
  if v_phone is not null and char_length(v_phone)>60 then
    raise exception 'Business phone is too long' using errcode='22023';
  end if;
  if v_type is not null and char_length(v_type)>120 then
    raise exception 'Business type is too long' using errcode='22023';
  end if;

  if v_logo is not null then
    v_issuer := nullif(auth.jwt()->>'iss','');
    if v_issuer is null or v_issuer !~* '^https://' then
      raise exception 'SellerTray could not verify the logo storage origin' using errcode='22023';
    end if;

    v_logo_prefix := regexp_replace(v_issuer, '/auth/v1/?$', '')
      || '/storage/v1/object/public/business-logos/';

    if v_logo not like v_logo_prefix || p_tenant_id::text || '/%' then
      raise exception 'Business logo must use the governed SellerTray logo store' using errcode='22023';
    end if;

    v_logo_object_name := substring(v_logo from char_length(v_logo_prefix) + 1);
    if v_logo_object_name is null
      or position('?' in v_logo_object_name) > 0
      or position('#' in v_logo_object_name) > 0
      or split_part(v_logo_object_name, '/', 1) <> p_tenant_id::text
      or v_logo_object_name !~* ('^' || p_tenant_id::text || '/business-logo-[A-Za-z0-9-]+\.(png|jpg|jpeg|webp)$')
      or not exists (
        select 1
        from storage.objects so
        where so.bucket_id='business-logos'
          and so.name=v_logo_object_name
      )
    then
      raise exception 'Business logo is not a valid SellerTray-managed image' using errcode='22023';
    end if;
  end if;

  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a 3-letter code' using errcode='22023';
  end if;
  if v_timezone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names tz where tz.name=v_timezone
  ) then
    raise exception 'Timezone is invalid' using errcode='22023';
  end if;

  update public.tenants t
  set name=v_name,
      business_email=v_email,
      business_phone=v_phone,
      business_type=v_type,
      logo_url=v_logo,
      currency=v_currency,
      timezone=v_timezone,
      updated_at=now()
  where t.id=p_tenant_id
  returning t.* into v_row;

  if not found then
    raise exception 'Business not found' using errcode='P0002';
  end if;

  return jsonb_build_object(
    'name',v_row.name,
    'merchantCode',v_row.merchant_code,
    'businessEmail',v_row.business_email,
    'businessPhone',v_row.business_phone,
    'businessType',v_row.business_type,
    'logoUrl',v_row.logo_url,
    'currency',upper(v_row.currency),
    'timezone',coalesce(nullif(v_row.timezone,''),'Africa/Lagos'),
    'subscriptionStatus',v_row.subscription_status,
    'whatsappConnectionStatus',v_row.whatsapp_connection_status
  );
end;
$function$;

create or replace function public.platform_admin_retry_setup_activation(
  p_actor_user_id uuid,p_tenant_id uuid,p_installment_obligation_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then
    raise exception 'Branch setup management capability required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_installment_obligation_id is null or char_length(btrim(coalesce(p_reason,''))) not between 6 and 1000 then
    raise exception 'Business, obligation and recovery reason are required' using errcode='22023';
  end if;
  -- Existing entitlement authority revalidates all prerequisites and runtime ownership.
  begin
    v_result:=public.reconcile_sellertray_installment_entitlement(p_tenant_id,p_installment_obligation_id);
  exception when others then
    v_result:=jsonb_build_object('retryRequired',true);
  end;
  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'setup_activation_reconciliation_retry',jsonb_build_object('obligationId',p_installment_obligation_id,'reason',btrim(p_reason),'result',v_result));
  return v_result;
end;
$$;
revoke all on function public.platform_admin_retry_setup_activation(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.platform_admin_retry_setup_activation(uuid,uuid,uuid,text) to service_role;

commit;
