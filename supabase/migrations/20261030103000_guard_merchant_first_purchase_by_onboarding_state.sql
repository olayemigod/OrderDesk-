create or replace function public.create_sellertray_initial_installment_purchase_merchant(
  p_tenant_id uuid,
  p_plan_code text,
  p_currency text,
  p_branch_ids uuid[],
  p_structure_code text,
  p_command_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_role text;
  v_reference text;
  v_result jsonb;
  v_state jsonb;
  v_is_replay boolean := false;
begin
  if p_tenant_id is null or p_actor_user_id is null or p_command_id is null then
    raise exception 'Business, user and purchase command are required' using errcode='22023';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;

  if v_role is distinct from 'owner' then
    raise exception 'Only the Business Owner can create the first SellerTray purchase' using errcode='42501';
  end if;

  perform 1 from public.tenants t where t.id=p_tenant_id for update;
  if not found then
    raise exception 'Business not found' using errcode='P0002';
  end if;

  v_reference:='ST-FIRST-'||upper(replace(p_command_id::text,'-',''));

  select exists(
    select 1
    from public.sellertray_commercial_orders o
    where o.tenant_id=p_tenant_id
      and o.order_reference=v_reference
  ) into v_is_replay;

  -- Preserve exact-command replay after the first call has advanced onboarding.
  -- New commands may create the first purchase only when shared onboarding
  -- authority says plan selection is the current Merchant Web action.
  if not v_is_replay then
    v_state:=public.get_sellertray_onboarding_state_core(p_tenant_id);
    if coalesce(v_state #>> '{nextAction,code}','') <> 'select_plan'
       or coalesce(v_state #>> '{nextAction,surface}','') <> 'merchant_web' then
      raise exception 'SellerTray first purchase is not the current onboarding action for this Business' using errcode='23514';
    end if;
  end if;

  v_result:=public.create_sellertray_initial_installment_purchase_core(
    p_tenant_id,
    btrim(coalesce(p_plan_code,'')),
    upper(btrim(coalesce(p_currency,''))),
    p_branch_ids,
    btrim(coalesce(p_structure_code,'')),
    v_reference,
    'Business Owner created the governed initial SellerTray purchase from SellerTray Billing.',
    p_actor_user_id
  );

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(
    p_actor_user_id,
    p_tenant_id,
    'sellertray_merchant_create_initial_installment_purchase',
    jsonb_build_object(
      'actorRole',v_role,
      'commandId',p_command_id,
      'commercialOrderId',v_result->>'commercialOrderId',
      'orderReference',v_result->>'orderReference',
      'idempotentReplay',coalesce((v_result->>'idempotentReplay')::boolean,false),
      'onboardingGuard',case when v_is_replay then 'exact_command_replay' else 'select_plan' end
    )
  );

  return v_result;
end;
$function$;

revoke all on function public.create_sellertray_initial_installment_purchase_merchant(uuid,text,text,uuid[],text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.create_sellertray_initial_installment_purchase_merchant(uuid,text,text,uuid[],text,uuid,uuid) to service_role;

create or replace function public.get_sellertray_commercial_billing_center(p_tenant_id uuid,p_actor_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_role text;
  v_orders jsonb;
  v_available_plans jsonb;
  v_branches jsonb;
  v_can_purchase_initial boolean;
  v_onboarding_state jsonb;
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

  v_onboarding_state:=public.get_sellertray_onboarding_state_core(p_tenant_id);

  v_can_purchase_initial := v_role='owner'
    and jsonb_array_length(v_orders)=0
    and exists(
      select 1 from public.tenant_subscriptions s
      where s.tenant_id=p_tenant_id and s.status='trial'
    )
    and coalesce(v_onboarding_state #>> '{nextAction,code}','')='select_plan'
    and coalesce(v_onboarding_state #>> '{nextAction,surface}','')='merchant_web';

  select coalesce(jsonb_agg(option_row order by option_row->>'name'),'[]'::jsonb)
  into v_available_plans
  from (
    select jsonb_build_object(
      'code',sp.code,
      'name',sp.name,
      'billingCycle','yearly',
      'currency',pv.currency,
      'subscriptionGrossAmount',pv.gross_amount,
      'subscriptionPriceVersionId',pv.id,
      'subscriptionPriceScope',pv.price_scope,
      'branchSetupGrossAmount',setup.gross_amount,
      'branchSetupPriceVersionId',setup.id,
      'branchSetupPriceScope',setup.price_scope
    ) option_row
    from public.subscription_plans sp
    join lateral (
      select cp.*
      from public.sellertray_commercial_price_versions cp
      where cp.id=public.resolve_sellertray_commercial_price_version_for_tenant(
        p_tenant_id,'subscription',sp.code,'yearly',sp.currency,now()
      )
    ) pv on true
    join lateral (
      select cp.*
      from public.sellertray_commercial_price_versions cp
      where cp.id=public.resolve_sellertray_commercial_price_version_for_tenant(
        p_tenant_id,'branch_setup',null,null,pv.currency,now()
      )
    ) setup on true
    where sp.is_active
  ) options;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',b.id,'code',b.code,'name',b.name,'isDefault',b.is_default
  ) order by b.is_default desc,b.name,b.id),'[]'::jsonb)
  into v_branches
  from public.branches b
  where b.tenant_id=p_tenant_id and b.is_active;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'actorRole',v_role,
    'canPay',v_role='owner',
    'canPurchaseInitial',v_can_purchase_initial,
    'initialPurchaseActionCode',v_onboarding_state #>> '{nextAction,code}',
    'initialPurchaseActionSurface',v_onboarding_state #>> '{nextAction,surface}',
    'availablePlans',v_available_plans,
    'activeBranches',v_branches,
    'supportedInstallmentStructures',jsonb_build_array('two_installment_70_30','three_installment_60_20_20'),
    'orders',v_orders,
    'generatedAt',now()
  );
end;
$function$;

revoke all on function public.get_sellertray_commercial_billing_center(uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_sellertray_commercial_billing_center(uuid,uuid) to service_role;