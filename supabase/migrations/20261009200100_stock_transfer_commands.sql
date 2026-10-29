begin;

alter table public.stock_transfers
  add column items_fingerprint text not null;

create or replace function public.create_sellertray_stock_transfer(
  p_tenant_id uuid,
  p_source_branch_id uuid,
  p_destination_branch_id uuid,
  p_reference text,
  p_reason text,
  p_items jsonb,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_reference text := nullif(btrim(coalesce(p_reference,'')),'');
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_source_location_id uuid;
  v_destination_location_id uuid;
  v_transfer_id uuid;
  v_existing public.stock_transfers%rowtype;
  v_item_count integer;
  v_normalized_count integer;
  v_distinct_products integer;
  v_fractional_ok boolean;
  v_fingerprint text;
begin
  if p_tenant_id is null or p_source_branch_id is null or p_destination_branch_id is null
     or p_actor_user_id is null or v_reference is null or v_reason is null
     or p_items is null or jsonb_typeof(p_items)<>'array' then
    raise exception 'Business, source branch, destination branch, reference, reason and items are required'
      using errcode='22023';
  end if;
  if p_source_branch_id=p_destination_branch_id then
    raise exception 'Choose a different destination branch' using errcode='22023';
  end if;
  if char_length(v_reference)>160 or char_length(v_reason)>500 then
    raise exception 'Transfer reference or reason is too long' using errcode='22023';
  end if;

  v_item_count := jsonb_array_length(p_items);
  if v_item_count<1 then
    raise exception 'Add at least one product to this transfer' using errcode='22023';
  end if;

  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_transfer_stock'
  ) then
    raise exception 'You do not have permission to transfer stock' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,p_source_branch_id,p_actor_user_id
  ) then
    raise exception 'You do not have access to transfer stock from this branch'
      using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,p_destination_branch_id,p_actor_user_id
  ) then
    raise exception 'You do not have access to transfer stock to this branch'
      using errcode='42501';
  end if;

  select sl.id into v_source_location_id
  from public.stock_locations sl
  where sl.tenant_id=p_tenant_id
    and sl.branch_id=p_source_branch_id
    and sl.is_default=true and sl.is_active=true
  order by sl.created_at,sl.id limit 1;

  select sl.id into v_destination_location_id
  from public.stock_locations sl
  where sl.tenant_id=p_tenant_id
    and sl.branch_id=p_destination_branch_id
    and sl.is_default=true and sl.is_active=true
  order by sl.created_at,sl.id limit 1;

  if v_source_location_id is null or v_destination_location_id is null then
    raise exception 'Both branches need an active default stock location'
      using errcode='23514';
  end if;

  with input_lines as (
    select
      nullif(line->>'catalogItemId','')::uuid as catalog_item_id,
      nullif(line->>'uomId','')::uuid as uom_id,
      nullif(line->>'quantity','')::numeric as quantity
    from jsonb_array_elements(p_items) line
  ), normalized as (
    select
      ci.id as catalog_item_id,
      ci.name as product_name,
      ci.stock_uom,
      u.id as uom_id,
      u.uom_name,
      u.conversion_factor::numeric(18,6) as conversion_factor,
      u.allow_fractional,
      il.quantity::numeric(18,6) as quantity,
      round((il.quantity*u.conversion_factor)::numeric,6) as stock_quantity
    from input_lines il
    join public.catalog_items ci
      on ci.tenant_id=p_tenant_id and ci.id=il.catalog_item_id and ci.is_active=true
    join public.catalog_item_uoms u
      on u.tenant_id=ci.tenant_id and u.catalog_item_id=ci.id and u.id=il.uom_id
    where il.quantity is not null and il.quantity>0
  )
  select
    count(*)::integer,
    count(distinct catalog_item_id)::integer,
    coalesce(bool_and(allow_fractional or quantity=trunc(quantity)),false),
    md5(coalesce(jsonb_agg(
      jsonb_build_object(
        'productId',catalog_item_id,
        'uomId',uom_id,
        'uom',uom_name,
        'quantity',quantity,
        'conversionFactor',conversion_factor,
        'stockQuantity',stock_quantity
      ) order by catalog_item_id
    )::text,'[]'))
  into v_normalized_count,v_distinct_products,v_fractional_ok,v_fingerprint
  from normalized;

  if v_normalized_count<>v_item_count then
    raise exception 'One or more transfer products, units or quantities are invalid'
      using errcode='23514';
  end if;
  if v_distinct_products<>v_item_count then
    raise exception 'Add each product only once per stock transfer'
      using errcode='23514';
  end if;
  if not v_fractional_ok then
    raise exception 'One or more product units do not allow fractional quantity'
      using errcode='23514';
  end if;

  select * into v_existing
  from public.stock_transfers st
  where st.tenant_id=p_tenant_id
    and lower(btrim(st.reference))=lower(v_reference)
  limit 1;

  if found then
    if v_existing.source_branch_id<>p_source_branch_id
       or v_existing.destination_branch_id<>p_destination_branch_id
       or v_existing.source_stock_location_id<>v_source_location_id
       or v_existing.destination_stock_location_id<>v_destination_location_id
       or v_existing.reason<>v_reason
       or v_existing.items_fingerprint<>v_fingerprint then
      raise exception 'This transfer reference is already used for different facts'
        using errcode='23505';
    end if;

    return jsonb_build_object(
      'transferId',v_existing.id,
      'reference',v_existing.reference,
      'status',v_existing.status,
      'itemCount',v_item_count,
      'idempotentReplay',true
    );
  end if;

  insert into public.stock_transfers(
    tenant_id,source_branch_id,source_stock_location_id,
    destination_branch_id,destination_stock_location_id,
    reference,reason,status,created_by_user_id,items_fingerprint
  ) values(
    p_tenant_id,p_source_branch_id,v_source_location_id,
    p_destination_branch_id,v_destination_location_id,
    v_reference,v_reason,'draft',p_actor_user_id,v_fingerprint
  ) returning id into v_transfer_id;

  with input_lines as (
    select
      nullif(line->>'catalogItemId','')::uuid as catalog_item_id,
      nullif(line->>'uomId','')::uuid as uom_id,
      nullif(line->>'quantity','')::numeric as quantity
    from jsonb_array_elements(p_items) line
  )
  insert into public.stock_transfer_items(
    tenant_id,stock_transfer_id,catalog_item_id,product_name,stock_uom,
    selected_uom,transfer_quantity,conversion_factor,stock_quantity
  )
  select
    p_tenant_id,v_transfer_id,ci.id,ci.name,ci.stock_uom,
    u.uom_name,il.quantity,u.conversion_factor,
    round((il.quantity*u.conversion_factor)::numeric,6)
  from input_lines il
  join public.catalog_items ci
    on ci.tenant_id=p_tenant_id and ci.id=il.catalog_item_id and ci.is_active=true
  join public.catalog_item_uoms u
    on u.tenant_id=ci.tenant_id and u.catalog_item_id=ci.id and u.id=il.uom_id
  order by ci.id;

  return jsonb_build_object(
    'transferId',v_transfer_id,
    'reference',v_reference,
    'status','draft',
    'itemCount',v_item_count,
    'idempotentReplay',false
  );
end;
$$;

revoke all on function public.create_sellertray_stock_transfer(
  uuid,uuid,uuid,text,text,jsonb,uuid
) from public,anon,authenticated;
grant execute on function public.create_sellertray_stock_transfer(
  uuid,uuid,uuid,text,text,jsonb,uuid
) to service_role;

create or replace function public.dispatch_sellertray_stock_transfer(
  p_tenant_id uuid,
  p_stock_transfer_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_transfer public.stock_transfers%rowtype;
  v_line record;
  v_current numeric(18,6);
  v_movement_count integer := 0;
begin
  if p_tenant_id is null or p_stock_transfer_id is null or p_actor_user_id is null then
    raise exception 'Business, stock transfer and operator are required' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_transfer
  from public.stock_transfers st
  where st.tenant_id=p_tenant_id and st.id=p_stock_transfer_id
  for update;
  if not found then raise exception 'Stock transfer not found' using errcode='22023'; end if;

  if not public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_transfer_stock'
  ) then
    raise exception 'You do not have permission to transfer stock' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,v_transfer.source_branch_id,p_actor_user_id
  ) then
    raise exception 'You do not have access to dispatch stock from this branch'
      using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,v_transfer.destination_branch_id,p_actor_user_id
  ) then
    raise exception 'You do not have access to this transfer destination'
      using errcode='42501';
  end if;

  if v_transfer.status in ('dispatched','received') then
    select count(*)::integer into v_movement_count
    from public.inventory_movements im
    where im.tenant_id=p_tenant_id
      and im.reference_type='stock_transfer'
      and im.reference_id=p_stock_transfer_id::text
      and im.movement_type='transfer_out';
    return jsonb_build_object(
      'transferId',p_stock_transfer_id,'status',v_transfer.status,
      'inventoryMovementCount',v_movement_count,'idempotentReplay',true
    );
  end if;
  if v_transfer.status<>'draft' then
    raise exception 'Only a draft stock transfer can be dispatched' using errcode='23514';
  end if;

  for v_line in
    select * from public.stock_transfer_items sti
    where sti.tenant_id=p_tenant_id and sti.stock_transfer_id=p_stock_transfer_id
    order by sti.catalog_item_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      public.sellertray_inventory_lock_key(
        p_tenant_id,v_transfer.source_branch_id,
        v_transfer.source_stock_location_id,v_line.catalog_item_id
      )
    );
  end loop;

  for v_line in
    select * from public.stock_transfer_items sti
    where sti.tenant_id=p_tenant_id and sti.stock_transfer_id=p_stock_transfer_id
    order by sti.catalog_item_id
  loop
    select coalesce(sum(im.quantity_delta),0)::numeric(18,6)
    into v_current
    from public.inventory_movements im
    where im.tenant_id=p_tenant_id
      and im.branch_id=v_transfer.source_branch_id
      and im.stock_location_id=v_transfer.source_stock_location_id
      and im.catalog_item_id=v_line.catalog_item_id;

    if v_current<v_line.stock_quantity then
      raise exception 'Not enough % stock to dispatch this transfer',v_line.product_name
        using errcode='23514';
    end if;

    perform public.record_sellertray_inventory_movement(
      p_tenant_id,
      v_transfer.source_branch_id,
      v_transfer.source_stock_location_id,
      v_line.catalog_item_id,
      'transfer_out',
      -v_line.stock_quantity,
      v_line.selected_uom,
      v_line.transfer_quantity,
      v_line.conversion_factor,
      'stock_transfer',
      p_stock_transfer_id::text,
      'stock-transfer:out:'||p_stock_transfer_id::text||':'||v_line.catalog_item_id::text,
      now(),
      p_actor_user_id,
      v_transfer.reason,
      jsonb_build_object(
        'stock_transfer_reference',v_transfer.reference,
        'destination_branch_id',v_transfer.destination_branch_id
      ),
      null
    );
    v_movement_count:=v_movement_count+1;
  end loop;

  update public.stock_transfers
  set status='dispatched',dispatched_by_user_id=p_actor_user_id,
      dispatched_at=now(),updated_at=now()
  where tenant_id=p_tenant_id and id=p_stock_transfer_id;

  return jsonb_build_object(
    'transferId',p_stock_transfer_id,'status','dispatched',
    'inventoryMovementCount',v_movement_count,'idempotentReplay',false
  );
end;
$$;

revoke all on function public.dispatch_sellertray_stock_transfer(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.dispatch_sellertray_stock_transfer(uuid,uuid,uuid)
  to service_role;

create or replace function public.receive_sellertray_stock_transfer(
  p_tenant_id uuid,
  p_stock_transfer_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_transfer public.stock_transfers%rowtype;
  v_line record;
  v_movement_count integer := 0;
begin
  if p_tenant_id is null or p_stock_transfer_id is null or p_actor_user_id is null then
    raise exception 'Business, stock transfer and operator are required' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_transfer
  from public.stock_transfers st
  where st.tenant_id=p_tenant_id and st.id=p_stock_transfer_id
  for update;
  if not found then raise exception 'Stock transfer not found' using errcode='22023'; end if;

  if not public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_transfer_stock'
  ) then
    raise exception 'You do not have permission to receive stock transfers'
      using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,v_transfer.destination_branch_id,p_actor_user_id
  ) then
    raise exception 'You do not have access to receive stock into this branch'
      using errcode='42501';
  end if;

  if v_transfer.status='received' then
    select count(*)::integer into v_movement_count
    from public.inventory_movements im
    where im.tenant_id=p_tenant_id
      and im.reference_type='stock_transfer'
      and im.reference_id=p_stock_transfer_id::text
      and im.movement_type='transfer_in';
    return jsonb_build_object(
      'transferId',p_stock_transfer_id,'status','received',
      'inventoryMovementCount',v_movement_count,'idempotentReplay',true
    );
  end if;
  if v_transfer.status<>'dispatched' then
    raise exception 'Only a dispatched stock transfer can be received'
      using errcode='23514';
  end if;

  for v_line in
    select * from public.stock_transfer_items sti
    where sti.tenant_id=p_tenant_id and sti.stock_transfer_id=p_stock_transfer_id
    order by sti.catalog_item_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      public.sellertray_inventory_lock_key(
        p_tenant_id,v_transfer.destination_branch_id,
        v_transfer.destination_stock_location_id,v_line.catalog_item_id
      )
    );
  end loop;

  for v_line in
    select * from public.stock_transfer_items sti
    where sti.tenant_id=p_tenant_id and sti.stock_transfer_id=p_stock_transfer_id
    order by sti.catalog_item_id
  loop
    perform public.record_sellertray_inventory_movement(
      p_tenant_id,
      v_transfer.destination_branch_id,
      v_transfer.destination_stock_location_id,
      v_line.catalog_item_id,
      'transfer_in',
      v_line.stock_quantity,
      v_line.selected_uom,
      v_line.transfer_quantity,
      v_line.conversion_factor,
      'stock_transfer',
      p_stock_transfer_id::text,
      'stock-transfer:in:'||p_stock_transfer_id::text||':'||v_line.catalog_item_id::text,
      now(),
      p_actor_user_id,
      v_transfer.reason,
      jsonb_build_object(
        'stock_transfer_reference',v_transfer.reference,
        'source_branch_id',v_transfer.source_branch_id
      ),
      null
    );
    v_movement_count:=v_movement_count+1;
  end loop;

  update public.stock_transfers
  set status='received',received_by_user_id=p_actor_user_id,
      received_at=now(),updated_at=now()
  where tenant_id=p_tenant_id and id=p_stock_transfer_id;

  return jsonb_build_object(
    'transferId',p_stock_transfer_id,'status','received',
    'inventoryMovementCount',v_movement_count,'idempotentReplay',false
  );
end;
$$;

revoke all on function public.receive_sellertray_stock_transfer(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.receive_sellertray_stock_transfer(uuid,uuid,uuid)
  to service_role;

create or replace function public.cancel_sellertray_stock_transfer(
  p_tenant_id uuid,
  p_stock_transfer_id uuid,
  p_reason text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_transfer public.stock_transfers%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
begin
  if p_tenant_id is null or p_stock_transfer_id is null or p_actor_user_id is null
     or v_reason is null then
    raise exception 'Business, stock transfer, reason and operator are required'
      using errcode='22023';
  end if;
  if char_length(v_reason)>500 then
    raise exception 'Cancellation reason is too long' using errcode='22023';
  end if;

  select * into v_transfer
  from public.stock_transfers st
  where st.tenant_id=p_tenant_id and st.id=p_stock_transfer_id
  for update;
  if not found then raise exception 'Stock transfer not found' using errcode='22023'; end if;

  if not public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_transfer_stock'
  ) or not public.sellertray_user_can_operate_branch(
    p_tenant_id,v_transfer.source_branch_id,p_actor_user_id
  ) then
    raise exception 'You do not have permission to cancel this stock transfer'
      using errcode='42501';
  end if;

  if v_transfer.status='cancelled' then
    return jsonb_build_object(
      'transferId',p_stock_transfer_id,'status','cancelled','idempotentReplay',true
    );
  end if;
  if v_transfer.status<>'draft' then
    raise exception 'Only a draft stock transfer can be cancelled. Receive dispatched stock before creating a return transfer.'
      using errcode='23514';
  end if;

  update public.stock_transfers
  set status='cancelled',cancelled_by_user_id=p_actor_user_id,
      cancelled_at=now(),cancel_reason=v_reason,updated_at=now()
  where tenant_id=p_tenant_id and id=p_stock_transfer_id;

  return jsonb_build_object(
    'transferId',p_stock_transfer_id,'status','cancelled','idempotentReplay',false
  );
end;
$$;

revoke all on function public.cancel_sellertray_stock_transfer(uuid,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.cancel_sellertray_stock_transfer(uuid,uuid,text,uuid)
  to service_role;

create or replace function public.get_sellertray_stock_transfer(
  p_tenant_id uuid,
  p_stock_transfer_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_transfer public.stock_transfers%rowtype;
  v_source_name text;
  v_destination_name text;
  v_items jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  select * into v_transfer
  from public.stock_transfers st
  where st.tenant_id=p_tenant_id and st.id=p_stock_transfer_id;
  if not found then return null; end if;

  if not (
    public.sellertray_user_can_operate_branch(p_tenant_id,v_transfer.source_branch_id,v_user_id)
    or public.sellertray_user_can_operate_branch(p_tenant_id,v_transfer.destination_branch_id,v_user_id)
  ) then
    raise exception 'You do not have access to this stock transfer'
      using errcode='42501';
  end if;

  select b.name into v_source_name from public.branches b
  where b.tenant_id=p_tenant_id and b.id=v_transfer.source_branch_id;
  select b.name into v_destination_name from public.branches b
  where b.tenant_id=p_tenant_id and b.id=v_transfer.destination_branch_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'itemId',sti.id,
      'productId',sti.catalog_item_id,
      'productName',sti.product_name,
      'stockUom',sti.stock_uom,
      'selectedUom',sti.selected_uom,
      'quantity',sti.transfer_quantity,
      'conversionFactor',sti.conversion_factor,
      'stockQuantity',sti.stock_quantity
    ) order by sti.product_name,sti.catalog_item_id
  ),'[]'::jsonb)
  into v_items
  from public.stock_transfer_items sti
  where sti.tenant_id=p_tenant_id and sti.stock_transfer_id=p_stock_transfer_id;

  return jsonb_build_object(
    'transferId',v_transfer.id,
    'reference',v_transfer.reference,
    'reason',v_transfer.reason,
    'status',v_transfer.status,
    'sourceBranchId',v_transfer.source_branch_id,
    'sourceBranchName',v_source_name,
    'destinationBranchId',v_transfer.destination_branch_id,
    'destinationBranchName',v_destination_name,
    'createdAt',v_transfer.created_at,
    'dispatchedAt',v_transfer.dispatched_at,
    'receivedAt',v_transfer.received_at,
    'cancelledAt',v_transfer.cancelled_at,
    'cancelReason',v_transfer.cancel_reason,
    'items',v_items
  );
end;
$$;

revoke all on function public.get_sellertray_stock_transfer(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_stock_transfer(uuid,uuid)
  to authenticated;

create or replace function public.get_sellertray_stock_transfers(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_limit integer default 50
)
returns table(
  id uuid,
  reference text,
  status text,
  source_branch_id uuid,
  source_branch_name text,
  destination_branch_id uuid,
  destination_branch_name text,
  item_count integer,
  created_at timestamptz,
  dispatched_at timestamptz,
  received_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_limit integer := greatest(1,least(coalesce(p_limit,50),100));
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'You do not have access to this branch' using errcode='42501';
  end if;

  return query
  select
    st.id,st.reference,st.status,
    st.source_branch_id,sb.name,
    st.destination_branch_id,db.name,
    (select count(*)::integer from public.stock_transfer_items sti
      where sti.tenant_id=st.tenant_id and sti.stock_transfer_id=st.id),
    st.created_at,st.dispatched_at,st.received_at
  from public.stock_transfers st
  join public.branches sb on sb.tenant_id=st.tenant_id and sb.id=st.source_branch_id
  join public.branches db on db.tenant_id=st.tenant_id and db.id=st.destination_branch_id
  where st.tenant_id=p_tenant_id
    and (st.source_branch_id=p_branch_id or st.destination_branch_id=p_branch_id)
  order by st.created_at desc,st.id desc
  limit v_limit;
end;
$$;

revoke all on function public.get_sellertray_stock_transfers(uuid,uuid,integer)
  from public,anon;
grant execute on function public.get_sellertray_stock_transfers(uuid,uuid,integer)
  to authenticated;

commit;