begin;

create or replace function public.sellertray_add_catalogue_order_item(
  p_tenant_id uuid,
  p_order_id uuid,
  p_catalog_item_id uuid,
  p_quantity numeric default 1
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_order public.orders%rowtype;
  v_item public.catalog_items%rowtype;
  v_order_item_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_quantity is null or p_quantity<=0 or p_quantity>9999 then raise exception 'Enter a valid quantity' using errcode='22023'; end if;

  select * into v_order
  from public.orders o
  where o.id=p_order_id and o.tenant_id=p_tenant_id
  for update;
  if not found then raise exception 'Order not found' using errcode='22023'; end if;

  if not public.sellertray_user_can_manage_order_operation(p_tenant_id,p_order_id,v_user_id) then
    raise exception 'You do not have permission to manage this order' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if v_order.status not in ('draft','needs_review','accepted') then
    raise exception 'Products can only be changed before fulfilment starts' using errcode='23514';
  end if;

  select * into v_item
  from public.catalog_items ci
  where ci.id=p_catalog_item_id and ci.tenant_id=p_tenant_id and ci.is_active=true;
  if not found then raise exception 'Active catalogue item not found' using errcode='22023'; end if;
  if v_item.price_ngn is null then
    raise exception 'Catalogue item needs a selling price before it can be ordered' using errcode='23514';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  perform set_config('sellertray.audit_actor_user_id',v_user_id::text,true);

  insert into public.order_items(
    tenant_id,order_id,catalog_item_id,item_name,original_item_name,
    quantity,unit_price,selected_uom,conversion_factor,match_source,match_confidence
  ) values (
    p_tenant_id,p_order_id,p_catalog_item_id,v_item.name,null,
    p_quantity,v_item.price_ngn,v_item.stock_uom,1,'merchant_match',1
  ) returning id into v_order_item_id;

  perform public.refresh_sellertray_order_review_reasons(p_order_id);

  insert into public.commercial_action_ledger(
    tenant_id,action_key,channel,customer_id,target_order_id,
    action_type,risk_class,requested_by,policy_result,action_status,metadata,applied_at
  ) values (
    p_tenant_id,'catalogue-add:'||v_order_item_id::text,'merchant_app',
    v_order.customer_id,p_order_id,'catalogue_item_added_to_order','medium',
    case when v_role='staff' then 'staff' else 'merchant' end,
    'allowed','applied',
    jsonb_build_object(
      'order_item_id',v_order_item_id,
      'catalog_item_id',p_catalog_item_id,
      'catalogue_name',v_item.name,
      'quantity',p_quantity,
      'unit_price',v_item.price_ngn,
      'selected_uom',v_item.stock_uom,
      'conversion_factor',1,
      'actor_role',v_role
    ),now()
  ) on conflict(tenant_id,action_key) do nothing;

  return v_order_item_id;
end;
$$;

create or replace function public.sellertray_match_order_item_to_catalogue(
  p_tenant_id uuid,
  p_order_item_id uuid,
  p_catalog_item_id uuid,
  p_learn_alias boolean default true
)
returns void
language plpgsql
security definer
set search_path=''
as $$
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
  v_stock_uom text;
  v_alias text;
  v_alias_learned boolean := false;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;

  select oi.order_id,o.status,o.customer_id,
         coalesce(nullif(btrim(oi.original_item_name),''),oi.item_name),
         oi.item_name,oi.catalog_item_id,oi.unit_price
    into v_order_id,v_order_status,v_customer_id,v_original,
         v_previous_name,v_previous_catalog_item_id,v_previous_price
  from public.order_items oi
  join public.orders o on o.id=oi.order_id and o.tenant_id=oi.tenant_id
  where oi.id=p_order_item_id and oi.tenant_id=p_tenant_id
  for update of oi;
  if v_order_id is null then raise exception 'Order item not found' using errcode='22023'; end if;

  if not public.sellertray_user_can_manage_order_operation(p_tenant_id,v_order_id,v_user_id) then
    raise exception 'You do not have permission to manage this order' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if v_order_status not in ('draft','needs_review','accepted') then
    raise exception 'Product correction is only available before fulfilment starts' using errcode='23514';
  end if;

  select ci.name,ci.price_ngn,ci.stock_uom
    into v_item_name,v_price,v_stock_uom
  from public.catalog_items ci
  where ci.id=p_catalog_item_id and ci.tenant_id=p_tenant_id and ci.is_active=true;
  if v_item_name is null then raise exception 'Active catalogue item not found' using errcode='22023'; end if;
  if v_price is null then raise exception 'Catalogue item needs a selling price before it can resolve this order' using errcode='23514'; end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  perform set_config('sellertray.audit_actor_user_id',v_user_id::text,true);

  update public.order_items
  set catalog_item_id=p_catalog_item_id,
      item_name=v_item_name,
      unit_price=v_price,
      selected_uom=v_stock_uom,
      conversion_factor=1,
      match_source='merchant_match',
      match_confidence=1
  where id=p_order_item_id and tenant_id=p_tenant_id;

  v_alias := nullif(btrim(v_original),'');
  if coalesce(p_learn_alias,true)
     and public.sellertray_user_can_manage_products(p_tenant_id,v_user_id)
     and v_alias is not null
     and lower(v_alias)<>lower(btrim(v_item_name))
     and not exists(
       select 1 from public.catalog_item_aliases a
       where a.tenant_id=p_tenant_id and lower(btrim(a.alias))=lower(v_alias)
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
      reviewed_by=v_user_id,reviewed_at=now(),updated_at=now()
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
      'selected_uom',v_stock_uom,
      'conversion_factor',1,
      'learned_alias',case when v_alias_learned then v_alias else null end,
      'actor_role',v_role
    ),now()
  ) on conflict(tenant_id,action_key) do nothing;
end;
$$;

create or replace function public.sellertray_keep_order_item_one_off(
  p_tenant_id uuid,
  p_order_item_id uuid,
  p_price numeric,
  p_name text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_order_id uuid;
  v_order_status text;
  v_original text;
  v_final_name text;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;

  select oi.order_id,o.status,
         coalesce(nullif(btrim(oi.original_item_name),''),oi.item_name),
         coalesce(nullif(btrim(p_name),''),oi.item_name)
    into v_order_id,v_order_status,v_original,v_final_name
  from public.order_items oi
  join public.orders o on o.id=oi.order_id and o.tenant_id=oi.tenant_id
  where oi.id=p_order_item_id and oi.tenant_id=p_tenant_id
  for update of oi;
  if v_order_id is null then raise exception 'Order item not found' using errcode='22023'; end if;

  if not public.sellertray_user_can_manage_order_operation(p_tenant_id,v_order_id,v_user_id) then
    raise exception 'You do not have permission to manage this order' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role not in ('owner','manager') then
    raise exception 'Only an Owner or Manager can approve a one-off selling price' using errcode='42501';
  end if;

  if p_price is null or p_price<0 then raise exception 'A valid selling price is required' using errcode='22023'; end if;
  if v_order_status not in ('draft','needs_review') then
    raise exception 'One-off resolution is only available before order acceptance' using errcode='23514';
  end if;

  perform set_config('sellertray.audit_actor_user_id',v_user_id::text,true);

  update public.order_items
  set catalog_item_id=null,
      item_name=v_final_name,
      unit_price=p_price,
      selected_uom='Each',
      conversion_factor=1,
      match_source='one_off',
      match_confidence=1
  where id=p_order_item_id and tenant_id=p_tenant_id;

  update public.order_item_catalogue_candidates
  set status='one_off',resolution_catalog_item_id=null,learned_alias=null,
      reviewed_by=v_user_id,reviewed_at=now(),updated_at=now()
  where tenant_id=p_tenant_id and order_item_id=p_order_item_id;

  perform public.refresh_sellertray_order_review_reasons(v_order_id);

  insert into public.commercial_action_ledger(
    tenant_id,action_key,channel,customer_id,target_order_id,
    action_type,risk_class,requested_by,policy_result,action_status,metadata,applied_at
  )
  select p_tenant_id,'catalogue-one-off:'||p_order_item_id::text,'merchant_app',
         o.customer_id,v_order_id,'order_item_kept_one_off','medium','merchant',
         'allowed','applied',
         jsonb_build_object(
           'order_item_id',p_order_item_id,
           'customer_wording',v_original,
           'final_name',v_final_name,
           'unit_price',p_price,
           'selected_uom','Each',
           'conversion_factor',1,
           'actor_role',v_role
         ),now()
  from public.orders o where o.id=v_order_id
  on conflict(tenant_id,action_key) do nothing;
end;
$$;

create or replace function public.sellertray_create_catalogue_from_order_item(
  p_tenant_id uuid,
  p_order_item_id uuid,
  p_name text,
  p_price numeric,
  p_sku text default null,
  p_category text default null,
  p_learn_alias boolean default true
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_order_id uuid;
  v_order_status text;
  v_original text;
  v_item_id uuid;
  v_stock_uom text;
  v_alias text;
  v_aliases jsonb := '[]'::jsonb;
  v_alias_learned boolean := false;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if nullif(btrim(p_name),'') is null then raise exception 'Product name is required' using errcode='22023'; end if;
  if p_price is null or p_price<0 then raise exception 'A valid selling price is required' using errcode='22023'; end if;

  select oi.order_id,o.status,
         coalesce(nullif(btrim(oi.original_item_name),''),oi.item_name)
    into v_order_id,v_order_status,v_original
  from public.order_items oi
  join public.orders o on o.id=oi.order_id and o.tenant_id=oi.tenant_id
  where oi.id=p_order_item_id and oi.tenant_id=p_tenant_id
  for update of oi;
  if v_order_id is null then raise exception 'Order item not found' using errcode='22023'; end if;

  if not public.sellertray_user_can_manage_order_operation(p_tenant_id,v_order_id,v_user_id) then
    raise exception 'You do not have permission to manage this order' using errcode='42501';
  end if;
  if not public.sellertray_user_can_manage_products(p_tenant_id,v_user_id) then
    raise exception 'You do not have permission to manage products' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if v_order_status not in ('draft','needs_review') then
    raise exception 'Catalogue resolution is only available before order acceptance' using errcode='23514';
  end if;

  v_alias := nullif(btrim(v_original),'');
  if coalesce(p_learn_alias,true)
     and v_alias is not null
     and lower(v_alias)<>lower(btrim(p_name))
  then
    v_aliases := jsonb_build_array(v_alias);
    v_alias_learned := true;
  end if;

  v_item_id := public.save_sellertray_catalogue_item(
    p_tenant_id,null,btrim(p_name),p_sku,p_category,null,p_price,v_aliases
  );

  select ci.stock_uom into v_stock_uom
  from public.catalog_items ci
  where ci.tenant_id=p_tenant_id and ci.id=v_item_id;
  if v_stock_uom is null then raise exception 'Created product is missing its Stock UOM' using errcode='23514'; end if;

  perform set_config('sellertray.audit_actor_user_id',v_user_id::text,true);

  update public.order_items
  set catalog_item_id=v_item_id,
      item_name=btrim(p_name),
      unit_price=p_price,
      selected_uom=v_stock_uom,
      conversion_factor=1,
      match_source='merchant_match',
      match_confidence=1
  where id=p_order_item_id and tenant_id=p_tenant_id;

  update public.order_item_catalogue_candidates
  set status='created_product',
      resolution_catalog_item_id=v_item_id,
      learned_alias=case when v_alias_learned then v_alias else null end,
      reviewed_by=v_user_id,reviewed_at=now(),updated_at=now()
  where tenant_id=p_tenant_id and order_item_id=p_order_item_id;

  perform public.refresh_sellertray_order_review_reasons(v_order_id);

  insert into public.commercial_action_ledger(
    tenant_id,action_key,channel,customer_id,target_order_id,
    action_type,risk_class,requested_by,policy_result,action_status,metadata,applied_at
  )
  select p_tenant_id,
         'catalogue-create:'||p_order_item_id::text||':'||v_item_id::text,
         'merchant_app',o.customer_id,v_order_id,
         'catalogue_item_created_from_order','medium','merchant',
         'allowed','applied',
         jsonb_build_object(
           'order_item_id',p_order_item_id,
           'catalog_item_id',v_item_id,
           'customer_wording',v_original,
           'catalogue_name',btrim(p_name),
           'selected_uom',v_stock_uom,
           'conversion_factor',1,
           'learned_alias',case when v_alias_learned then v_alias else null end
         ),now()
  from public.orders o where o.id=v_order_id
  on conflict(tenant_id,action_key) do nothing;

  return v_item_id;
end;
$$;

create or replace function public.sellertray_list_order_item_catalogue_candidates(
  p_tenant_id uuid,
  p_order_id uuid
)
returns table(
  id uuid,
  order_item_id uuid,
  customer_wording text,
  status text,
  resolution_catalog_item_id uuid,
  learned_alias text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not exists(
    select 1 from public.orders o
    where o.id=p_order_id and o.tenant_id=p_tenant_id
  ) then
    raise exception 'Order not found' using errcode='22023';
  end if;

  if not public.sellertray_user_can_manage_order_operation(p_tenant_id,p_order_id,v_user_id) then
    raise exception 'You do not have permission to review this order' using errcode='42501';
  end if;

  return query
  select c.id,c.order_item_id,c.customer_wording,c.status,
         c.resolution_catalog_item_id,c.learned_alias,c.created_at
  from public.order_item_catalogue_candidates c
  where c.tenant_id=p_tenant_id and c.order_id=p_order_id
  order by c.created_at asc;
end;
$$;

revoke all on function public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric) from public,anon;
revoke all on function public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean) from public,anon;
revoke all on function public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text) from public,anon;
revoke all on function public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean) from public,anon;
revoke all on function public.sellertray_list_order_item_catalogue_candidates(uuid,uuid) from public,anon;

grant execute on function public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric) to authenticated;
grant execute on function public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean) to authenticated;
grant execute on function public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text) to authenticated;
grant execute on function public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean) to authenticated;
grant execute on function public.sellertray_list_order_item_catalogue_candidates(uuid,uuid) to authenticated;

commit;
