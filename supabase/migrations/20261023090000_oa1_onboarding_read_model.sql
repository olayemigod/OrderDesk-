begin;

-- OA1: one read-only SellerTray onboarding projection for Mobile, Merchant Web
-- and ProcessEdge Admin. Existing merchants retain their pre-C2 runtime access;
-- businesses created after this migration enter the governed activation journey.
-- This rollout marker is compatibility policy only. Commercial lifecycle truth
-- remains derived from orders, agreements, confirmed payments, Branch setup
-- readiness and entitlement events.
alter table public.tenants
  add column if not exists commercial_activation_required boolean;

update public.tenants
set commercial_activation_required=false
where commercial_activation_required is null;

alter table public.tenants
  alter column commercial_activation_required set default true,
  alter column commercial_activation_required set not null;

comment on column public.tenants.commercial_activation_required is
  'Pre-C2 onboarding rollout policy. False preserves existing merchant access; true requires governed initial commercial activation. Not a lifecycle status.';

create or replace function public.derive_sellertray_onboarding_state(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_activation_required boolean;
  v_active_branch_count integer := 0;
  v_first_order_id uuid;
  v_first_order_time timestamptz;
  v_first_order_tie_count integer := 0;
  v_obligation_id uuid;
  v_obligation_count integer := 0;
  v_billing jsonb := '{}'::jsonb;
  v_agreement_accepted boolean := false;
  v_first_payment_confirmed boolean := false;
  v_setup_required_count integer := 0;
  v_setup_ready_count integer := 0;
  v_setup_ready boolean := false;
  v_entitlement_state text := 'pending';
  v_activation_at timestamptz;
  v_stage text;
  v_message text;
  v_next_action text;
  v_next_action_label text;
  v_blockers jsonb := '[]'::jsonb;
begin
  if p_tenant_id is null then
    raise exception 'Business is required' using errcode='22023';
  end if;

  select t.commercial_activation_required
    into v_activation_required
  from public.tenants t
  where t.id=p_tenant_id;

  if not found then
    raise exception 'Business not found' using errcode='P0002';
  end if;

  select count(*)::integer
    into v_active_branch_count
  from public.branches b
  where b.tenant_id=p_tenant_id
    and b.is_active=true;

  -- Existing merchants are explicitly grandfathered at OA1 rollout. Their
  -- ongoing subscription/access state remains governed by existing runtime
  -- subscription authorities rather than being reclassified as new onboarding.
  if not v_activation_required then
    return jsonb_build_object(
      'tenantId',p_tenant_id,
      'governanceMode','legacy_compatibility',
      'activationRequired',false,
      'stage','active',
      'merchantMessage','SellerTray is ready for this existing business.',
      'nextAction','open_workspace',
      'nextActionLabel','Open SellerTray',
      'operationalAccessAllowed',true,
      'activationComplete',true,
      'activeBranchCount',v_active_branch_count,
      'commercialOrderId',null,
      'installmentObligationId',null,
      'agreementAccepted',null,
      'firstPaymentConfirmed',null,
      'setupRequiredCount',0,
      'setupReadyCount',0,
      'setupReady',null,
      'entitlementState',null,
      'activationAt',null,
      'blockers','[]'::jsonb,
      'generatedAt',now()
    );
  end if;

  if v_active_branch_count=0 then
    v_stage := 'business_setup';
    v_message := 'Add at least one active Branch to continue setting up SellerTray.';
    v_next_action := 'manage_branches';
    v_next_action_label := 'Add a Branch';
    v_blockers := jsonb_build_array('branch_required');
  else
    -- C1B defines the controlled initial purchase as the earliest subscription
    -- commercial order. Equal earliest timestamps are ambiguous and fail closed.
    select min(o.ordered_at)
      into v_first_order_time
    from public.sellertray_commercial_orders o
    where o.tenant_id=p_tenant_id
      and exists (
        select 1
        from public.sellertray_commercial_order_price_snapshots ps
        where ps.tenant_id=o.tenant_id
          and ps.commercial_order_id=o.id
          and ps.line_type='subscription'
      );

    if v_first_order_time is null then
      v_stage := 'commercial_purchase';
      v_message := 'Your business profile is ready. Continue your SellerTray commercial setup on Merchant Web.';
      v_next_action := 'open_merchant_billing';
      v_next_action_label := 'Continue setup';
      v_blockers := jsonb_build_array('commercial_purchase_required');
    else
      select count(*)::integer,min(o.id)
        into v_first_order_tie_count,v_first_order_id
      from public.sellertray_commercial_orders o
      where o.tenant_id=p_tenant_id
        and o.ordered_at=v_first_order_time
        and exists (
          select 1
          from public.sellertray_commercial_order_price_snapshots ps
          where ps.tenant_id=o.tenant_id
            and ps.commercial_order_id=o.id
            and ps.line_type='subscription'
        );

      if v_first_order_tie_count<>1 then
        v_stage := 'commercial_review';
        v_message := 'SellerTray needs ProcessEdge to review this commercial setup before activation can continue.';
        v_next_action := 'contact_processedge';
        v_next_action_label := 'Contact ProcessEdge';
        v_blockers := jsonb_build_array('ambiguous_initial_purchase');
      else
        select count(*)::integer,min(io.id)
          into v_obligation_count,v_obligation_id
        from public.sellertray_commercial_installment_obligations io
        where io.tenant_id=p_tenant_id
          and io.commercial_order_id=v_first_order_id;

        if v_obligation_count<>1 then
          v_stage := 'commercial_review';
          v_message := 'SellerTray needs ProcessEdge to review this commercial setup before activation can continue.';
          v_next_action := 'contact_processedge';
          v_next_action_label := 'Contact ProcessEdge';
          v_blockers := jsonb_build_array('initial_payment_obligation_review_required');
        else
          v_billing := public.get_sellertray_installment_billing_state(
            p_tenant_id,
            v_first_order_id,
            v_obligation_id
          );

          v_agreement_accepted := coalesce((v_billing->>'agreementAccepted')::boolean,false);
          v_first_payment_confirmed := coalesce((v_billing->>'paidInstallmentCount')::integer,0)>0;
          v_setup_required_count := coalesce((v_billing->>'setupRequiredCount')::integer,0);
          v_setup_ready_count := coalesce((v_billing->>'setupReadyCount')::integer,0);
          v_setup_ready := coalesce((v_billing->>'setupReady')::boolean,false);
          v_entitlement_state := coalesce(nullif(v_billing->>'entitlementState',''),'pending');
          v_activation_at := nullif(v_billing->>'activationAt','')::timestamptz;

          -- Once authoritative activation has happened, onboarding is complete.
          -- Later expiry/suspension is subscription lifecycle, not re-onboarding.
          if v_activation_at is not null then
            v_stage := 'active';
            v_message := 'SellerTray is activated and ready for business.';
            v_next_action := 'open_workspace';
            v_next_action_label := 'Start selling';
            v_blockers := '[]'::jsonb;
          elsif not v_agreement_accepted then
            v_stage := 'agreement';
            v_message := 'Review and accept the current SellerTray commercial agreement to continue.';
            v_next_action := 'open_merchant_billing';
            v_next_action_label := 'Review agreement';
            v_blockers := jsonb_build_array('agreement_acceptance_required');
          elsif not v_first_payment_confirmed then
            v_stage := 'payment';
            v_message := 'Complete the required SellerTray payment on Merchant Web to continue.';
            v_next_action := 'open_merchant_billing';
            v_next_action_label := 'Complete payment';
            v_blockers := jsonb_build_array('qualifying_payment_required');
          elsif not v_setup_ready then
            v_stage := 'setup';
            v_message := case
              when v_setup_required_count>0
                then format('Payment is confirmed. %s of %s Branch setups are complete.',v_setup_ready_count,v_setup_required_count)
              else 'Payment is confirmed. Branch setup must be completed before activation.'
            end;
            v_next_action := 'await_or_schedule_setup';
            v_next_action_label := 'View setup status';
            v_blockers := jsonb_build_array('branch_setup_required');
          else
            v_stage := 'activation';
            v_message := 'All activation requirements are complete. SellerTray is finalising activation.';
            v_next_action := 'refresh_activation';
            v_next_action_label := 'Refresh status';
            v_blockers := jsonb_build_array('activation_reconciliation_pending');
          end if;
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'governanceMode','governed',
    'activationRequired',true,
    'stage',v_stage,
    'merchantMessage',v_message,
    'nextAction',v_next_action,
    'nextActionLabel',v_next_action_label,
    'operationalAccessAllowed',v_stage='active',
    'activationComplete',v_stage='active',
    'activeBranchCount',v_active_branch_count,
    'commercialOrderId',v_first_order_id,
    'installmentObligationId',v_obligation_id,
    'agreementAccepted',v_agreement_accepted,
    'firstPaymentConfirmed',v_first_payment_confirmed,
    'setupRequiredCount',v_setup_required_count,
    'setupReadyCount',v_setup_ready_count,
    'setupReady',v_setup_ready,
    'entitlementState',v_entitlement_state,
    'activationAt',v_activation_at,
    'blockers',v_blockers,
    'generatedAt',now()
  );
end;
$$;

revoke all on function public.derive_sellertray_onboarding_state(uuid)
  from public,anon,authenticated,service_role;

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
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  if not exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
  ) then
    raise exception 'SellerTray Business access required' using errcode='42501';
  end if;

  return public.derive_sellertray_onboarding_state(p_tenant_id);
end;
$$;

revoke all on function public.get_sellertray_onboarding_state(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_sellertray_onboarding_state(uuid)
  to authenticated;

create or replace function public.get_sellertray_onboarding_state_for_actor(
  p_tenant_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if p_actor_user_id is null or not exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=p_actor_user_id
  ) then
    raise exception 'SellerTray Business access required' using errcode='42501';
  end if;

  return public.derive_sellertray_onboarding_state(p_tenant_id);
end;
$$;

revoke all on function public.get_sellertray_onboarding_state_for_actor(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_sellertray_onboarding_state_for_actor(uuid,uuid)
  to service_role;

create or replace function public.get_sellertray_onboarding_state_admin(
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
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if coalesce(v_role,'') not in ('admin','support') then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;

  return public.derive_sellertray_onboarding_state(p_tenant_id);
end;
$$;

revoke all on function public.get_sellertray_onboarding_state_admin(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_sellertray_onboarding_state_admin(uuid,uuid)
  to service_role;

commit;
