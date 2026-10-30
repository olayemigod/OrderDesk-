do $migration$
declare
  v_source text;
begin
  select pg_get_functiondef(p.oid)
  into v_source
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='create_sellertray_initial_installment_purchase_admin_impl'
  limit 1;

  if v_source is null then
    raise exception 'Initial installment purchase implementation is missing';
  end if;

  v_source:=replace(
    v_source,
    'CREATE OR REPLACE FUNCTION public.create_sellertray_initial_installment_purchase_admin_impl(',
    'CREATE OR REPLACE FUNCTION public.create_sellertray_initial_installment_purchase_core('
  );
  v_source:=replace(v_source, E'  v_role text;\n', '');
  v_source:=replace(
    v_source,
    E'  select pa.role into v_role from public.platform_admins pa where pa.user_id=p_actor_user_id;\n  if v_role<>''admin'' then raise exception ''Platform admin role required for this action'' using errcode=''42501''; end if;\n',
    ''
  );

  if position('v_role' in v_source)>0 then
    raise exception 'Initial purchase core extraction did not remove admin authorization';
  end if;

  execute v_source;
end
$migration$;

revoke all on function public.create_sellertray_initial_installment_purchase_core(uuid,text,text,uuid[],text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.create_sellertray_initial_installment_purchase_core(uuid,text,text,uuid[],text,text,text,uuid) to service_role;

create or replace function public.create_sellertray_initial_installment_purchase_admin(
  p_tenant_id uuid,
  p_plan_code text,
  p_currency text,
  p_branch_ids uuid[],
  p_structure_code text,
  p_order_reference text,
  p_reason text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_role text;
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if v_role is distinct from 'admin' then
    raise exception 'Platform admin role required for this action' using errcode='42501';
  end if;

  if p_tenant_id is null then
    raise exception 'Business not found' using errcode='P0002';
  end if;

  perform 1 from public.tenants t where t.id=p_tenant_id for update;
  if not found then
    raise exception 'Business not found' using errcode='P0002';
  end if;

  return public.create_sellertray_initial_installment_purchase_core(
    p_tenant_id,p_plan_code,p_currency,p_branch_ids,p_structure_code,
    p_order_reference,p_reason,p_actor_user_id
  );
end;
$function$;

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
      'idempotentReplay',coalesce((v_result->>'idempotentReplay')::boolean,false)
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

  v_can_purchase_initial := v_role='owner'
    and jsonb_array_length(v_orders)=0
    and exists(
      select 1 from public.tenant_subscriptions s
      where s.tenant_id=p_tenant_id and s.status='trial'
    );

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
    'availablePlans',v_available_plans,
    'activeBranches',v_branches,
    'supportedInstallmentStructures',jsonb_build_array('two_installment_70_30','three_installment_60_20_20'),
    'orders',v_orders,
    'generatedAt',now()
  );
end;
$function$;

create or replace function public.get_sellertray_merchant_web_handoff_target(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
  v_state jsonb;
  v_action_code text;
  v_action_label text;
  v_target_page text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  if v_role is null or v_role not in ('owner','manager') then
    raise exception 'Merchant Web onboarding handoff requires an Owner or Manager' using errcode='42501';
  end if;

  v_state := public.get_sellertray_onboarding_state(p_tenant_id);
  v_action_code := v_state #>> '{nextAction,code}';
  v_action_label := v_state #>> '{nextAction,label}';

  if v_action_code='select_plan' and v_role<>'owner' then
    raise exception 'Only the Business Owner can create the first SellerTray purchase' using errcode='42501';
  end if;

  v_target_page := case v_action_code
    when 'review_master_agreement' then 'agreements'
    when 'select_plan' then 'sellertray_billing'
    when 'pay_outstanding' then 'sellertray_billing'
    when 'review_setup_appointments' then 'setup'
    else null
  end;

  if v_target_page is null or v_state #>> '{nextAction,surface}' <> 'merchant_web' then
    raise exception 'No Merchant Web onboarding action is currently available' using errcode='22023';
  end if;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'userId',v_user_id,
    'role',v_role,
    'actionCode',v_action_code,
    'actionLabel',v_action_label,
    'targetPage',v_target_page
  );
end;
$function$;

create or replace function public.orderdesk_subscription_can_write(p_tenant_id uuid)
returns boolean
language sql
stable
set search_path=''
as $function$
  select coalesce(
    (
      select case
        when not exists(select 1 from public.tenants t where t.id=s.tenant_id) then false
        when not exists(select 1 from public.subscription_plans p where p.code=s.plan_code and p.is_active) then false
        when public.sellertray_c1b_runtime_period_state(s.tenant_id) in ('provisional_expired','full_term_expired') then false
        when s.status='active' then true
        when s.status='trial' and public.sellertray_has_governed_subscription_purchase(s.tenant_id) then false
        when s.status='trial' then s.trial_ends_at is null or s.trial_ends_at>now()
        when s.status='grace' then s.grace_ends_at is null or s.grace_ends_at>now()
        else false
      end
      from public.tenant_subscriptions s
      where s.tenant_id=p_tenant_id
    ),
    false
  );
$function$;
