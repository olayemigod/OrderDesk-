begin;

-- OA1: one read-only onboarding and activation projection for every SellerTray surface.
-- This composes existing Business, Branch, C1B commercial, setup and entitlement
-- authorities. It does not create another lifecycle table or mutate entitlement.

create or replace function public.get_sellertray_onboarding_state_impl(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_subscription_status text;
  v_current_period_end timestamptz;
  v_active_branch_count integer := 0;
  v_order_id uuid;
  v_order_reference text;
  v_ordered_at timestamptz;
  v_initial_order_count integer := 0;
  v_obligation_id uuid;
  v_installment_count integer := 0;
  v_paid_installment_count integer := 0;
  v_first_schedule_id uuid;
  v_first_paid boolean := false;
  v_agreement_id uuid;
  v_agreement_required boolean := false;
  v_agreement_accepted boolean := false;
  v_setup_required_count integer := 0;
  v_setup_ready_count integer := 0;
  v_activation_at timestamptz;
  v_has_full_entitlement boolean := false;
  v_legacy_runtime_access boolean := false;
  v_onboarding_complete boolean := false;
  v_stage text;
  v_entitlement_state text := 'pending';
  v_blockers jsonb := '[]'::jsonb;
  v_next_action jsonb;
begin
  if p_tenant_id is null or not exists (select 1 from public.tenants t where t.id=p_tenant_id) then
    raise exception 'Business not found' using errcode='P0002';
  end if;

  select s.status,s.current_period_end into v_subscription_status,v_current_period_end
  from public.tenant_subscriptions s where s.tenant_id=p_tenant_id;

  select count(*)::integer into v_active_branch_count
  from public.branches b where b.tenant_id=p_tenant_id and b.is_active;

  -- C1B deliberately treats equal initial-purchase business timestamps as
  -- ambiguous rather than inventing ordering by UUID. OA1 must preserve the
  -- same identity rule when deriving the onboarding subject.
  select min(o.ordered_at) into v_ordered_at
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id
    and exists (
      select 1 from public.sellertray_commercial_order_price_snapshots ps
      where ps.tenant_id=o.tenant_id and ps.commercial_order_id=o.id and ps.line_type='subscription'
    );

  if v_ordered_at is not null then
    select count(*)::integer into v_initial_order_count
    from public.sellertray_commercial_orders o
    where o.tenant_id=p_tenant_id
      and o.ordered_at=v_ordered_at
      and exists (
        select 1 from public.sellertray_commercial_order_price_snapshots ps
        where ps.tenant_id=o.tenant_id and ps.commercial_order_id=o.id and ps.line_type='subscription'
      );

    if v_initial_order_count<>1 then
      raise exception 'Initial SellerTray commercial purchase is ambiguous' using errcode='23514';
    end if;

    select o.id,o.order_reference into v_order_id,v_order_reference
    from public.sellertray_commercial_orders o
    where o.tenant_id=p_tenant_id
      and o.ordered_at=v_ordered_at
      and exists (
        select 1 from public.sellertray_commercial_order_price_snapshots ps
        where ps.tenant_id=o.tenant_id and ps.commercial_order_id=o.id and ps.line_type='subscription'
      );
  end if;

  if v_order_id is null then
    -- Preserve only historical operational compatibility. A legacy trial is not
    -- a SellerTray offer and never grants OA1 operational access.
    v_legacy_runtime_access := coalesce(v_subscription_status,'') in ('active','grace');
    v_onboarding_complete := v_legacy_runtime_access;

    if v_legacy_runtime_access then
      v_stage := 'active';
      v_entitlement_state := 'legacy';
      v_next_action := jsonb_build_object('code','operate_sellertray','label','SellerTray is ready','surface','mobile');
    elsif v_active_branch_count=0 then
      v_stage := 'business_setup';
      v_blockers := jsonb_build_array('branch_required');
      v_next_action := jsonb_build_object('code','add_branch','label','Add the first Branch','surface','merchant_web');
    else
      v_stage := 'commercial_order';
      v_blockers := jsonb_build_array('commercial_order_required');
      v_next_action := jsonb_build_object('code','complete_purchase','label','Complete your SellerTray purchase','surface','merchant_web');
    end if;

    return jsonb_build_object(
      'tenantId',p_tenant_id,'stage',v_stage,'onboardingComplete',v_onboarding_complete,
      'operationalAccess',v_onboarding_complete,'legacyRuntimeAccess',v_legacy_runtime_access,
      'blockerCodes',v_blockers,'nextAction',v_next_action,'activeBranchCount',v_active_branch_count,
      'commercialOrderId',null,'commercialOrderReference',null,'commercialOrderCreatedAt',null,
      'installmentObligationId',null,'agreementRequired',false,'agreementAccepted',false,
      'paidInstallmentCount',0,'installmentCount',0,'setupRequiredCount',0,'setupReadyCount',0,
      'setupReady',false,'activationAt',null,'entitlementState',v_entitlement_state,
      'runtimeCompatibilityStatus',v_subscription_status,'currentPeriodEnd',v_current_period_end
    );
  end if;

  select io.id into v_obligation_id
  from public.sellertray_commercial_installment_obligations io
  where io.tenant_id=p_tenant_id and io.commercial_order_id=v_order_id
  order by io.created_at asc,io.id asc limit 1;

  if v_obligation_id is not null then
    v_agreement_required := true;

    select count(*)::integer into v_installment_count
    from public.sellertray_commercial_installment_schedule s
    where s.tenant_id=p_tenant_id and s.installment_obligation_id=v_obligation_id;

    select s.id into v_first_schedule_id
    from public.sellertray_commercial_installment_schedule s
    where s.tenant_id=p_tenant_id and s.installment_obligation_id=v_obligation_id
    order by s.sequence_no asc,s.id asc limit 1;

    select count(*)::integer into v_paid_installment_count
    from public.sellertray_commercial_installment_schedule s
    where s.tenant_id=p_tenant_id and s.installment_obligation_id=v_obligation_id
      and exists (
        select 1 from public.sellertray_commercial_installment_payment_confirmations pc
        where pc.tenant_id=p_tenant_id and pc.installment_obligation_id=v_obligation_id
          and pc.installment_schedule_id=s.id
      );

    v_first_paid := v_first_schedule_id is not null and exists (
      select 1 from public.sellertray_commercial_installment_payment_confirmations pc
      where pc.tenant_id=p_tenant_id and pc.installment_obligation_id=v_obligation_id
        and pc.installment_schedule_id=v_first_schedule_id
    );

    select a.id into v_agreement_id
    from public.sellertray_commercial_agreements a
    where a.tenant_id=p_tenant_id and a.commercial_order_id=v_order_id
      and (a.installment_obligation_id is null or a.installment_obligation_id=v_obligation_id)
      and not exists (
        select 1 from public.sellertray_commercial_agreements replacement
        where replacement.tenant_id=a.tenant_id and replacement.supersedes_agreement_id=a.id
      )
    order by a.issued_at desc,a.id desc limit 1;

    v_agreement_accepted := v_agreement_id is not null and exists (
      select 1 from public.sellertray_commercial_agreement_acceptances ac
      where ac.tenant_id=p_tenant_id and ac.agreement_id=v_agreement_id
    );
  end if;

  select count(*)::integer,
         (count(*) filter (where exists (
           select 1 from public.sellertray_commercial_branch_setup_readiness r
           where r.tenant_id=ps.tenant_id and r.commercial_order_id=ps.commercial_order_id
             and r.branch_id=ps.branch_id
         )))::integer
    into v_setup_required_count,v_setup_ready_count
  from public.sellertray_commercial_order_price_snapshots ps
  where ps.tenant_id=p_tenant_id and ps.commercial_order_id=v_order_id and ps.line_type='branch_setup';

  select min(e.effective_from) into v_activation_at
  from public.sellertray_commercial_entitlement_events e
  where e.tenant_id=p_tenant_id and e.commercial_order_id=v_order_id
    and e.event_type in ('installment.provisional_activated','installment.full_entitlement_released');

  select exists (
    select 1 from public.sellertray_commercial_entitlement_events e
    where e.tenant_id=p_tenant_id and e.commercial_order_id=v_order_id
      and e.event_type='installment.full_entitlement_released'
  ) into v_has_full_entitlement;

  if v_activation_at is not null then
    v_onboarding_complete := true;
    v_stage := 'active';
    v_entitlement_state := case when v_has_full_entitlement then 'full' else 'provisional' end;
    v_blockers := '[]'::jsonb;
    v_next_action := jsonb_build_object('code','operate_sellertray','label','SellerTray is ready','surface','mobile');
  else
    if v_active_branch_count=0 then v_blockers := v_blockers || jsonb_build_array('branch_required'); end if;
    if v_obligation_id is null then
      v_blockers := v_blockers || jsonb_build_array('payment_obligation_required');
    else
      if not v_agreement_accepted then v_blockers := v_blockers || jsonb_build_array('agreement_required'); end if;
      if not v_first_paid then v_blockers := v_blockers || jsonb_build_array('qualifying_payment_required'); end if;
    end if;
    if v_setup_required_count=0 then
      v_blockers := v_blockers || jsonb_build_array('branch_setup_scope_required');
    elsif v_setup_ready_count<v_setup_required_count then
      v_blockers := v_blockers || jsonb_build_array('branch_setup_readiness_required');
    end if;

    if v_active_branch_count=0 then
      v_stage := 'business_setup';
      v_next_action := jsonb_build_object('code','add_branch','label','Add the first Branch','surface','merchant_web');
    elsif v_obligation_id is null then
      v_stage := 'payment';
      v_next_action := jsonb_build_object('code','review_purchase','label','Review your SellerTray purchase','surface','merchant_web');
    elsif not v_agreement_accepted then
      v_stage := 'agreement';
      v_next_action := jsonb_build_object('code','accept_agreement','label','Review and accept your SellerTray agreement','surface','merchant_web');
    elsif not v_first_paid then
      v_stage := 'payment';
      v_next_action := jsonb_build_object('code','complete_payment','label','Complete your SellerTray payment','surface','merchant_web');
    elsif v_setup_required_count=0 or v_setup_ready_count<v_setup_required_count then
      v_stage := 'setup';
      v_next_action := jsonb_build_object('code','complete_setup','label','Complete your SellerTray setup','surface','merchant_web');
    else
      v_stage := 'activation';
      v_blockers := v_blockers || jsonb_build_array('activation_reconciliation_pending');
      v_next_action := jsonb_build_object('code','activation_pending','label','SellerTray activation checks are in progress','surface','automatic');
    end if;
  end if;

  return jsonb_build_object(
    'tenantId',p_tenant_id,'stage',v_stage,'onboardingComplete',v_onboarding_complete,
    'operationalAccess',v_onboarding_complete,'legacyRuntimeAccess',false,
    'blockerCodes',v_blockers,'nextAction',v_next_action,'activeBranchCount',v_active_branch_count,
    'commercialOrderId',v_order_id,'commercialOrderReference',v_order_reference,
    'commercialOrderCreatedAt',v_ordered_at,'installmentObligationId',v_obligation_id,
    'agreementRequired',v_agreement_required,'agreementAccepted',v_agreement_accepted,
    'paidInstallmentCount',v_paid_installment_count,'installmentCount',v_installment_count,
    'setupRequiredCount',v_setup_required_count,'setupReadyCount',v_setup_ready_count,
    'setupReady',v_setup_required_count>0 and v_setup_ready_count=v_setup_required_count,
    'activationAt',v_activation_at,'entitlementState',v_entitlement_state,
    'runtimeCompatibilityStatus',v_subscription_status,'currentPeriodEnd',v_current_period_end
  );
end;
$$;

revoke all on function public.get_sellertray_onboarding_state_impl(uuid) from public,anon,authenticated;
grant execute on function public.get_sellertray_onboarding_state_impl(uuid) to service_role;

create or replace function public.get_sellertray_onboarding_state(p_actor_user_id uuid,p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_member_role text;
  v_admin_role text;
  v_state jsonb;
begin
  if p_actor_user_id is null or p_tenant_id is null then
    raise exception 'Authenticated user and Business are required' using errcode='42501';
  end if;

  select tm.role into v_member_role from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;

  select pa.role into v_admin_role from public.platform_admins pa
  where pa.user_id=p_actor_user_id and pa.role in ('admin','support');

  if v_member_role is null and v_admin_role is null then
    raise exception 'SellerTray Business access required' using errcode='42501';
  end if;

  v_state := public.get_sellertray_onboarding_state_impl(p_tenant_id);
  return v_state || jsonb_build_object(
    'actorKind',case when v_member_role is not null then 'merchant' else 'platform_admin' end,
    'actorRole',coalesce(v_member_role,v_admin_role)
  );
end;
$$;

revoke all on function public.get_sellertray_onboarding_state(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_sellertray_onboarding_state(uuid,uuid) to service_role;

commit;
