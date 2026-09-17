-- SellerTray P0 audit hardening: catalogue-governed order additions and corrections.

create or replace function public.sellertray_add_catalogue_order_item(
  p_tenant_id uuid,
  p_order_id uuid,
  p_catalog_item_id uuid,
  p_quantity numeric default 1
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_order public.orders%rowtype;
  v_item public.catalog_items%rowtype;
  v_order_item_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  if v_role is null then
    raise exception 'SellerTray business membership required' using errcode='42501';
  end if;

  if p_quantity is null or p_quantity <= 0 or p_quantity > 9999 then
    raise exception 'Enter a valid quantity' using errcode='22023';
  end if;

  select * into v_order
  from public.orders o
  where o.id=p_order_id and o.tenant_id=p_tenant_id
  for update;

  if not found then
    raise exception 'Order not found' using errcode='22023';
  end if;

  if v_order.status not in ('draft','needs_review','accepted') then
    raise exception 'Products can only be changed before fulfilment starts' using errcode='23514';
  end if;

  select * into v_item
  from public.catalog_items ci
  where ci.id=p_catalog_item_id
    and ci.tenant_id=p_tenant_id
    and ci.is_active=true;

  if not found then
    raise exception 'Active catalogue item not found' using errcode='22023';
  end if;

  if v_item.price_ngn is null then
    raise exception 'Catalogue item needs a selling price before it can be ordered' using errcode='23514';
  end if;

  insert into public.order_items(
    tenant_id,order_id,catalog_item_id,item_name,original_item_name,
    quantity,unit_price,match_source,match_confidence
  ) values (
    p_tenant_id,p_order_id,p_catalog_item_id,v_item.name,null,
    p_quantity,v_item.price_ngn,'merchant_match',1
  ) returning id into v_order_item_id;

  perform public.refresh_sellertray_order_review_reasons(p_order_id);

  insert into public.commercial_action_ledger(
    tenant_id,action_key,channel,customer_id,target_order_id,
    action_type,risk_class,requested_by,policy_result,action_status,metadata,applied_at
  ) values (
    p_tenant_id,
    'catalogue-add:'||v_order_item_id::text,
    'merchant_app',
    v_order.customer_id,
    p_order_id,
    'catalogue_item_added_to_order',
    'medium',
    case when v_role='staff' then 'staff' else 'merchant' end,
    'allowed','applied',
    jsonb_build_object(
      'order_item_id',v_order_item_id,
      'catalog_item_id',p_catalog_item_id,
      'catalogue_name',v_item.name,
      'quantity',p_quantity,
      'unit_price',v_item.price_ngn,
      'actor_role',v_role
    ),
    now()
  ) on conflict(tenant_id,action_key) do nothing;

  return v_order_item_id;
end;
$function$;

revoke all on function public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric) from public, anon;
grant execute on function public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric) to authenticated;

create or replace function public.sellertray_match_order_item_to_catalogue(
  p_tenant_id uuid,
  p_order_item_id uuid,
  p_catalog_item_id uuid,
  p_learn_alias boolean default true
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_order_id uuid;
  v_order_status text;
  v_customer_id uuid;
  v_original text;
  v_previous_name text;
  v_previous_catalog_item_id uuid;
  v_previous_price numeric;
  v_item_name text;
  v_price numeric;
  v_alias text;
  v_alias_learned boolean := false;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  if v_role is null then raise exception 'SellerTray business membership required'; end if;

  select oi.order_id,o.status,o.customer_id,
         coalesce(nullif(btrim(oi.original_item_name),''),oi.item_name),
         oi.item_name,oi.catalog_item_id,oi.unit_price
  into v_order_id,v_order_status,v_customer_id,v_original,
       v_previous_name,v_previous_catalog_item_id,v_previous_price
  from public.order_items oi
  join public.orders o on o.id=oi.order_id and o.tenant_id=oi.tenant_id
  where oi.id=p_order_item_id and oi.tenant_id=p_tenant_id
  for update of oi;

  if v_order_id is null then raise exception 'Order item not found'; end if;
  if v_order_status not in ('draft','needs_review','accepted') then
    raise exception 'Product correction is only available before fulfilment starts';
  end if;

  select ci.name,ci.price_ngn
  into v_item_name,v_price
  from public.catalog_items ci
  where ci.id=p_catalog_item_id and ci.tenant_id=p_tenant_id and ci.is_active=true;

  if v_item_name is null then raise exception 'Active catalogue item not found'; end if;
  if v_price is null then raise exception 'Catalogue item needs a selling price before it can resolve this order'; end if;

  update public.order_items
  set catalog_item_id=p_catalog_item_id,
      item_name=v_item_name,
      unit_price=v_price,
      match_source='merchant_match',
      match_confidence=1
  where id=p_order_item_id and tenant_id=p_tenant_id;

  v_alias := nullif(btrim(v_original),'');
  if coalesce(p_learn_alias,true)
     and v_role in ('owner','manager')
     and v_alias is not null
     and lower(v_alias) <> lower(btrim(v_item_name))
     and not exists(
       select 1 from public.catalog_item_aliases a
       where a.tenant_id=p_tenant_id
         and lower(btrim(a.alias))=lower(v_alias)
     )
  then
    insert into public.catalog_item_aliases(tenant_id,catalog_item_id,alias)
    values(p_tenant_id,p_catalog_item_id,v_alias);
    v_alias_learned := true;
  end if;

  update public.order_item_catalogue_candidates
  set status='matched_existing',
      resolution_catalog_item_id=p_catalog_item_id,
      learned_alias=case when v_alias_learned then v_alias else null end,
      reviewed_by=v_user_id,
      reviewed_at=now(),
      updated_at=now()
  where tenant_id=p_tenant_id and order_item_id=p_order_item_id;

  perform public.refresh_sellertray_order_review_reasons(v_order_id);

  insert into public.commercial_action_ledger(
    tenant_id,action_key,channel,customer_id,target_order_id,
    action_type,risk_class,requested_by,policy_result,action_status,metadata,applied_at
  ) values (
    p_tenant_id,
    'catalogue-match:'||p_order_item_id::text||':'||p_catalog_item_id::text||':'||extract(epoch from clock_timestamp())::bigint::text,
    'merchant_app',v_customer_id,v_order_id,
    'order_item_matched_to_catalogue','medium',
    case when v_role='staff' then 'staff' else 'merchant' end,
    'allowed','applied',
    jsonb_build_object(
      'order_item_id',p_order_item_id,
      'catalog_item_id',p_catalog_item_id,
      'customer_wording',v_original,
      'previous_name',v_previous_name,
      'previous_catalog_item_id',v_previous_catalog_item_id,
      'previous_unit_price',v_previous_price,
      'new_name',v_item_name,
      'new_unit_price',v_price,
      'learned_alias',case when v_alias_learned then v_alias else null end,
      'actor_role',v_role
    ),
    now()
  ) on conflict(tenant_id,action_key) do nothing;
end;
$function$;

revoke all on function public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean) from public, anon;
grant execute on function public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean) to authenticated;

-- Authenticated clients can still adjust quantity or remove a line where existing
-- RLS/trigger rules permit it, but they cannot inject arbitrary names/prices.
revoke insert on public.order_items from authenticated;
revoke update(item_name,unit_price) on public.order_items from authenticated;
grant update(quantity) on public.order_items to authenticated;
