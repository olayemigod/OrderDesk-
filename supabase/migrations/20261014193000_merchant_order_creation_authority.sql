begin;

-- Merchant-created customer orders are a human order-management operation.
-- Keep POS and WhatsApp creation on their dedicated commands, but make manual
-- merchant creation Branch-explicit, capability-aware, customer-convergent and
-- transactionally audited.
create or replace function public.create_sellertray_merchant_order_atomic(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_note text,
  p_items jsonb,
  p_branch_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_branch_id uuid := p_branch_id;
  v_customer_id uuid;
  v_order_id uuid;
  v_currency text;
  v_total numeric(14,2);
  v_item_count integer;
  v_actor_role text;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    raise exception 'Business and staff member are required' using errcode='22023';
  end if;
  if nullif(btrim(coalesce(p_customer_name,'')),'') is null then
    raise exception 'Customer name is required' using errcode='22023';
  end if;
  if p_customer_phone is null or p_customer_phone !~ '^\+?[0-9]{7,15}$' then
    raise exception 'Customer phone is invalid' using errcode='22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items)<1
     or jsonb_array_length(p_items)>50 then
    raise exception 'Add between 1 and 50 products' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_manage_orders'
  ) then
    raise exception 'You do not have permission to manage orders' using errcode='42501';
  end if;

  if v_branch_id is null then
    select b.id into v_branch_id
    from public.branches b
    where b.tenant_id=p_tenant_id
      and b.is_default=true
      and b.is_active=true
    limit 1;
  end if;

  if v_branch_id is null or not exists (
    select 1 from public.branches b
    where b.tenant_id=p_tenant_id
      and b.id=v_branch_id
      and b.is_active=true
  ) then
    raise exception 'Choose an active Branch for this order' using errcode='23514';
  end if;

  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,v_branch_id,p_actor_user_id
  ) then
    raise exception 'You do not have permission to operate this Branch' using errcode='42501';
  end if;

  select t.currency into v_currency
  from public.tenants t
  where t.id=p_tenant_id;
  if v_currency is null then
    raise exception 'Business not found' using errcode='P0002';
  end if;

  with requested as (
    select x.catalog_item_id,x.quantity
    from jsonb_to_recordset(p_items) as x(catalog_item_id uuid,quantity numeric)
  )
  select count(*)::int
  into v_item_count
  from requested r
  join public.catalog_items ci
    on ci.id=r.catalog_item_id
   and ci.tenant_id=p_tenant_id
   and ci.is_active=true
   and ci.price_ngn is not null
   and ci.price_ngn>=0
  where r.quantity>0 and r.quantity<=9999;

  if v_item_count<>jsonb_array_length(p_items) then
    raise exception 'One selected product is unavailable, unpriced or has an invalid quantity'
      using errcode='23514';
  end if;

  -- Reuse the shared customer resolver so a merchant-created order cannot
  -- create channel-specific customer truth for an existing phone identity.
  v_customer_id := public.resolve_sellertray_pos_customer(
    p_tenant_id,
    null,
    left(btrim(p_customer_name),120),
    p_customer_phone
  );

  with requested as (
    select x.catalog_item_id,x.quantity
    from jsonb_to_recordset(p_items) as x(catalog_item_id uuid,quantity numeric)
  )
  select sum(ci.price_ngn*r.quantity)::numeric(14,2)
  into v_total
  from requested r
  join public.catalog_items ci
    on ci.id=r.catalog_item_id
   and ci.tenant_id=p_tenant_id;

  perform set_config('sellertray.audit_actor_user_id',p_actor_user_id::text,true);

  insert into public.orders(
    tenant_id,branch_id,customer_id,status,source,customer_note,
    parser_source,parser_version,parser_confidence,review_reasons,
    currency,total_amount
  ) values(
    p_tenant_id,v_branch_id,v_customer_id,'needs_review','manual',
    nullif(btrim(coalesce(p_note,'')),''),
    'manual',null,null,'{}'::text[],v_currency,v_total
  )
  returning id into v_order_id;

  insert into public.order_items(
    tenant_id,order_id,catalog_item_id,item_name,original_item_name,
    quantity,unit_price,match_source,match_confidence
  )
  select
    p_tenant_id,v_order_id,ci.id,ci.name,ci.name,
    r.quantity,ci.price_ngn,'manual',1
  from jsonb_to_recordset(p_items) as r(catalog_item_id uuid,quantity numeric)
  join public.catalog_items ci
    on ci.id=r.catalog_item_id
   and ci.tenant_id=p_tenant_id;

  select tm.role into v_actor_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;

  insert into public.commercial_action_ledger(
    tenant_id,action_key,channel,customer_id,target_order_id,action_type,
    risk_class,requested_by,actor_user_id,policy_result,action_status,
    financial_impact,currency,before_state,after_state,metadata,applied_at
  ) values(
    p_tenant_id,
    'manual-order:'||v_order_id::text,
    'merchant_app',
    v_customer_id,
    v_order_id,
    'manual_order_created',
    'medium',
    case when v_actor_role='staff' then 'staff' else 'merchant' end,
    p_actor_user_id,
    'allowed',
    'applied',
    null,
    v_currency,
    '{}'::jsonb,
    jsonb_build_object(
      'status','needs_review',
      'payment_status','unpaid',
      'total_amount',v_total,
      'currency',v_currency,
      'branch_id',v_branch_id,
      'source','manual'
    ),
    jsonb_build_object(
      'customer_name',left(btrim(p_customer_name),120),
      'customer_phone',p_customer_phone,
      'line_count',jsonb_array_length(p_items),
      'source','merchant_app'
    ),
    now()
  );

  return v_order_id;
end;
$$;

revoke all on function public.create_sellertray_merchant_order_atomic(
  uuid,uuid,text,text,text,jsonb,uuid
) from public,anon,authenticated;
grant execute on function public.create_sellertray_merchant_order_atomic(
  uuid,uuid,text,text,text,jsonb,uuid
) to service_role;

commit;
