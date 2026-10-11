begin;

create or replace function public.start_sellertray_stock_count(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_reference text,
  p_reason text,
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
  v_stock_location_id uuid;
  v_count_id uuid;
  v_existing public.stock_counts%rowtype;
  v_total integer := 0;
  v_captured integer := 0;
begin
  if p_tenant_id is null or p_branch_id is null or p_actor_user_id is null
     or v_reference is null or v_reason is null then
    raise exception 'Business, branch, reference, reason and operator are required'
      using errcode='22023';
  end if;
  if char_length(v_reference)>160 or char_length(v_reason)>500 then
    raise exception 'Stock count reference or reason is too long' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,p_branch_id,p_actor_user_id
  ) then
    raise exception 'You do not have access to count stock in this branch'
      using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_count_stock'
  ) then
    raise exception 'You do not have permission to count stock'
      using errcode='42501';
  end if;

  select sl.id into v_stock_location_id
  from public.stock_locations sl
  where sl.tenant_id=p_tenant_id
    and sl.branch_id=p_branch_id
    and sl.is_default=true
    and sl.is_active=true
  order by sl.created_at,sl.id
  limit 1;

  if v_stock_location_id is null then
    raise exception 'This branch has no active default stock location'
      using errcode='23514';
  end if;

  select * into v_existing
  from public.stock_counts sc
  where sc.tenant_id=p_tenant_id
    and sc.branch_id=p_branch_id
    and lower(btrim(sc.reference))=lower(v_reference)
  limit 1;

  if found then
    if v_existing.reason<>v_reason
       or v_existing.stock_location_id<>v_stock_location_id then
      raise exception 'This stock count reference is already used for different facts'
        using errcode='23505';
    end if;

    select count(*)::integer,
           count(*) filter (where sci.is_captured)::integer
    into v_total,v_captured
    from public.stock_count_items sci
    where sci.tenant_id=p_tenant_id
      and sci.stock_count_id=v_existing.id;

    return jsonb_build_object(
      'countId',v_existing.id,
      'status',v_existing.status,
      'reference',v_existing.reference,
      'totalItems',v_total,
      'capturedItems',v_captured,
      'idempotentReplay',true
    );
  end if;

  if exists (
    select 1 from public.stock_counts sc
    where sc.tenant_id=p_tenant_id
      and sc.stock_location_id=v_stock_location_id
      and sc.status in ('counting','review')
  ) then
    raise exception 'Finish or cancel the active stock count before starting another'
      using errcode='23514';
  end if;

  insert into public.stock_counts(
    tenant_id,branch_id,stock_location_id,reference,reason,status,
    started_by_user_id,started_at
  ) values(
    p_tenant_id,p_branch_id,v_stock_location_id,v_reference,v_reason,'counting',
    p_actor_user_id,now()
  )
  returning id into v_count_id;

  insert into public.stock_count_items(
    tenant_id,stock_count_id,catalog_item_id,product_name,stock_uom
  )
  select ci.tenant_id,v_count_id,ci.id,ci.name,ci.stock_uom
  from public.catalog_items ci
  where ci.tenant_id=p_tenant_id
    and ci.is_active=true
  order by ci.name,ci.id;

  get diagnostics v_total=row_count;
  if v_total<1 then
    raise exception 'Add at least one active product before starting a stock count'
      using errcode='23514';
  end if;

  return jsonb_build_object(
    'countId',v_count_id,
    'status','counting',
    'reference',v_reference,
    'totalItems',v_total,
    'capturedItems',0,
    'idempotentReplay',false
  );
end;
$$;

revoke all on function public.start_sellertray_stock_count(uuid,uuid,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.start_sellertray_stock_count(uuid,uuid,text,text,uuid)
  to service_role;

create or replace function public.capture_sellertray_stock_count_item(
  p_tenant_id uuid,
  p_stock_count_id uuid,
  p_catalog_item_id uuid,
  p_uom_id uuid,
  p_quantity numeric,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_count public.stock_counts%rowtype;
  v_item public.stock_count_items%rowtype;
  v_source_uom text;
  v_conversion_factor numeric(18,6);
  v_allow_fractional boolean;
  v_expected numeric(18,6);
  v_counted numeric(18,6);
  v_variance numeric(18,6);
  v_total integer;
  v_captured integer;
begin
  if p_tenant_id is null or p_stock_count_id is null
     or p_catalog_item_id is null or p_uom_id is null
     or p_quantity is null or p_quantity<0 or p_actor_user_id is null then
    raise exception 'Stock count, product, unit, quantity and operator are required'
      using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_count
  from public.stock_counts sc
  where sc.tenant_id=p_tenant_id
    and sc.id=p_stock_count_id
  for update;

  if not found then
    raise exception 'Stock count not found' using errcode='22023';
  end if;
  if v_count.status<>'counting' then
    raise exception 'Only an active counting session can capture quantities'
      using errcode='23514';
  end if;
  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,v_count.branch_id,p_actor_user_id
  ) then
    raise exception 'You do not have access to count stock in this branch'
      using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_count_stock'
  ) then
    raise exception 'You do not have permission to count stock'
      using errcode='42501';
  end if;

  select * into v_item
  from public.stock_count_items sci
  where sci.tenant_id=p_tenant_id
    and sci.stock_count_id=p_stock_count_id
    and sci.catalog_item_id=p_catalog_item_id
  for update;

  if not found then
    raise exception 'Product is not part of this stock count'
      using errcode='23514';
  end if;

  select u.uom_name,u.conversion_factor,u.allow_fractional
  into v_source_uom,v_conversion_factor,v_allow_fractional
  from public.catalog_item_uoms u
  where u.tenant_id=p_tenant_id
    and u.catalog_item_id=p_catalog_item_id
    and u.id=p_uom_id;

  if not found then
    raise exception 'Product unit is unavailable for this stock count'
      using errcode='23514';
  end if;
  if not v_allow_fractional and p_quantity<>trunc(p_quantity) then
    raise exception 'This product unit does not allow fractional quantity'
      using errcode='23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    public.sellertray_inventory_lock_key(
      p_tenant_id,v_count.branch_id,v_count.stock_location_id,p_catalog_item_id
    )
  );

  select coalesce(sum(im.quantity_delta),0)::numeric(18,6)
  into v_expected
  from public.inventory_movements im
  where im.tenant_id=p_tenant_id
    and im.branch_id=v_count.branch_id
    and im.stock_location_id=v_count.stock_location_id
    and im.catalog_item_id=p_catalog_item_id;

  v_counted := round((p_quantity*v_conversion_factor)::numeric,6);
  v_variance := round((v_counted-v_expected)::numeric,6);

  update public.stock_count_items
  set is_captured=true,
      selected_uom=v_source_uom,
      counted_quantity=p_quantity,
      conversion_factor=v_conversion_factor,
      counted_stock_quantity=v_counted,
      expected_stock_quantity=v_expected,
      variance_quantity=v_variance,
      captured_by_user_id=p_actor_user_id,
      captured_at=now(),
      updated_at=now()
  where tenant_id=p_tenant_id
    and id=v_item.id;

  select count(*)::integer,
         count(*) filter (where sci.is_captured)::integer
  into v_total,v_captured
  from public.stock_count_items sci
  where sci.tenant_id=p_tenant_id
    and sci.stock_count_id=p_stock_count_id;

  return jsonb_build_object(
    'countId',p_stock_count_id,
    'status','counting',
    'productId',p_catalog_item_id,
    'productName',v_item.product_name,
    'sourceUom',v_source_uom,
    'sourceQuantity',p_quantity,
    'conversionFactor',v_conversion_factor,
    'countedStockQuantity',v_counted,
    'stockUom',v_item.stock_uom,
    'totalItems',v_total,
    'capturedItems',v_captured
  );
end;
$$;

revoke all on function public.capture_sellertray_stock_count_item(uuid,uuid,uuid,uuid,numeric,uuid)
  from public,anon,authenticated;
grant execute on function public.capture_sellertray_stock_count_item(uuid,uuid,uuid,uuid,numeric,uuid)
  to service_role;

create or replace function public.submit_sellertray_stock_count(
  p_tenant_id uuid,
  p_stock_count_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_count public.stock_counts%rowtype;
  v_total integer;
  v_captured integer;
  v_variance_items integer;
  v_positive numeric(18,6);
  v_negative numeric(18,6);
begin
  if p_tenant_id is null or p_stock_count_id is null or p_actor_user_id is null then
    raise exception 'Business, stock count and operator are required' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_count
  from public.stock_counts sc
  where sc.tenant_id=p_tenant_id and sc.id=p_stock_count_id
  for update;
  if not found then raise exception 'Stock count not found' using errcode='22023'; end if;

  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,v_count.branch_id,p_actor_user_id
  ) then
    raise exception 'You do not have access to count stock in this branch'
      using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_count_stock'
  ) then
    raise exception 'You do not have permission to count stock'
      using errcode='42501';
  end if;

  select count(*)::integer,
         count(*) filter (where sci.is_captured)::integer,
         count(*) filter (where sci.is_captured and sci.variance_quantity<>0)::integer,
         coalesce(sum(greatest(sci.variance_quantity,0)) filter (where sci.is_captured),0)::numeric(18,6),
         coalesce(sum(least(sci.variance_quantity,0)) filter (where sci.is_captured),0)::numeric(18,6)
  into v_total,v_captured,v_variance_items,v_positive,v_negative
  from public.stock_count_items sci
  where sci.tenant_id=p_tenant_id and sci.stock_count_id=p_stock_count_id;

  if v_count.status='review' then
    return jsonb_build_object(
      'countId',p_stock_count_id,'status','review','totalItems',v_total,
      'capturedItems',v_captured,'varianceItems',v_variance_items,
      'positiveVariance',v_positive,'negativeVariance',v_negative,
      'idempotentReplay',true
    );
  end if;
  if v_count.status<>'counting' then
    raise exception 'This stock count cannot be submitted for review'
      using errcode='23514';
  end if;
  if v_total<1 or v_captured<>v_total then
    raise exception 'Count every product before submitting this stock count for review'
      using errcode='23514';
  end if;

  update public.stock_counts
  set status='review',
      submitted_by_user_id=p_actor_user_id,
      submitted_at=now(),
      updated_at=now()
  where tenant_id=p_tenant_id and id=p_stock_count_id;

  return jsonb_build_object(
    'countId',p_stock_count_id,'status','review','totalItems',v_total,
    'capturedItems',v_captured,'varianceItems',v_variance_items,
    'positiveVariance',v_positive,'negativeVariance',v_negative,
    'idempotentReplay',false
  );
end;
$$;

revoke all on function public.submit_sellertray_stock_count(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.submit_sellertray_stock_count(uuid,uuid,uuid)
  to service_role;

create or replace function public.apply_sellertray_stock_count(
  p_tenant_id uuid,
  p_stock_count_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_count public.stock_counts%rowtype;
  v_line record;
  v_current numeric(18,6);
  v_movement_count integer := 0;
  v_existing_movement_count integer := 0;
begin
  if p_tenant_id is null or p_stock_count_id is null or p_actor_user_id is null then
    raise exception 'Business, stock count and operator are required' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_count
  from public.stock_counts sc
  where sc.tenant_id=p_tenant_id and sc.id=p_stock_count_id
  for update;
  if not found then raise exception 'Stock count not found' using errcode='22023'; end if;

  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,v_count.branch_id,p_actor_user_id
  ) then
    raise exception 'You do not have access to apply stock counts in this branch'
      using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_apply_stock_count'
  ) then
    raise exception 'You do not have permission to apply stock count variances'
      using errcode='42501';
  end if;

  if v_count.status='applied' then
    select count(*)::integer into v_existing_movement_count
    from public.inventory_movements im
    where im.tenant_id=p_tenant_id
      and im.reference_type='stock_count'
      and im.reference_id=p_stock_count_id::text
      and im.movement_type='count_reconciliation';

    return jsonb_build_object(
      'countId',p_stock_count_id,'status','applied',
      'inventoryMovementCount',v_existing_movement_count,
      'idempotentReplay',true
    );
  end if;
  if v_count.status<>'review' then
    raise exception 'Stock count must be in review before variances can be applied'
      using errcode='23514';
  end if;

  for v_line in
    select sci.*
    from public.stock_count_items sci
    where sci.tenant_id=p_tenant_id
      and sci.stock_count_id=p_stock_count_id
      and sci.is_captured=true
    order by sci.catalog_item_id
  loop
    if v_line.variance_quantity=0 then
      continue;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      public.sellertray_inventory_lock_key(
        p_tenant_id,v_count.branch_id,v_count.stock_location_id,v_line.catalog_item_id
      )
    );

    select coalesce(sum(im.quantity_delta),0)::numeric(18,6)
    into v_current
    from public.inventory_movements im
    where im.tenant_id=p_tenant_id
      and im.branch_id=v_count.branch_id
      and im.stock_location_id=v_count.stock_location_id
      and im.catalog_item_id=v_line.catalog_item_id;

    if v_current+v_line.variance_quantity<0 then
      raise exception 'Stock changed after counting %. Recount or review this product before applying the variance',
        v_line.product_name using errcode='23514';
    end if;

    perform public.record_sellertray_inventory_movement(
      p_tenant_id,
      v_count.branch_id,
      v_count.stock_location_id,
      v_line.catalog_item_id,
      'count_reconciliation',
      v_line.variance_quantity,
      v_line.stock_uom,
      abs(v_line.variance_quantity),
      1,
      'stock_count',
      p_stock_count_id::text,
      'stock-count:' || p_stock_count_id::text || ':' || v_line.catalog_item_id::text,
      now(),
      p_actor_user_id,
      v_count.reason,
      jsonb_build_object(
        'stock_count_reference',v_count.reference,
        'expected_at_capture',v_line.expected_stock_quantity,
        'counted_stock_quantity',v_line.counted_stock_quantity,
        'variance_quantity',v_line.variance_quantity,
        'captured_uom',v_line.selected_uom,
        'captured_quantity',v_line.counted_quantity,
        'captured_conversion_factor',v_line.conversion_factor,
        'captured_at',v_line.captured_at
      ),
      null
    );
    v_movement_count := v_movement_count+1;
  end loop;

  update public.stock_counts
  set status='applied',
      applied_by_user_id=p_actor_user_id,
      applied_at=now(),
      updated_at=now()
  where tenant_id=p_tenant_id and id=p_stock_count_id;

  return jsonb_build_object(
    'countId',p_stock_count_id,'status','applied',
    'inventoryMovementCount',v_movement_count,
    'idempotentReplay',false
  );
end;
$$;

revoke all on function public.apply_sellertray_stock_count(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.apply_sellertray_stock_count(uuid,uuid,uuid)
  to service_role;

create or replace function public.cancel_sellertray_stock_count(
  p_tenant_id uuid,
  p_stock_count_id uuid,
  p_reason text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_count public.stock_counts%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_required_capability text;
begin
  if p_tenant_id is null or p_stock_count_id is null or p_actor_user_id is null
     or v_reason is null then
    raise exception 'Business, stock count, reason and operator are required'
      using errcode='22023';
  end if;
  if char_length(v_reason)>500 then
    raise exception 'Cancellation reason is too long' using errcode='22023';
  end if;

  select * into v_count
  from public.stock_counts sc
  where sc.tenant_id=p_tenant_id and sc.id=p_stock_count_id
  for update;
  if not found then raise exception 'Stock count not found' using errcode='22023'; end if;

  if v_count.status='cancelled' then
    return jsonb_build_object(
      'countId',p_stock_count_id,'status','cancelled','idempotentReplay',true
    );
  end if;
  if v_count.status='applied' then
    raise exception 'Applied stock counts cannot be cancelled' using errcode='23514';
  end if;

  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,v_count.branch_id,p_actor_user_id
  ) then
    raise exception 'You do not have access to cancel stock counts in this branch'
      using errcode='42501';
  end if;

  v_required_capability := case
    when v_count.status='review' then 'can_apply_stock_count'
    else 'can_count_stock'
  end;
  if not public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,v_required_capability
  ) then
    raise exception 'You do not have permission to cancel this stock count'
      using errcode='42501';
  end if;

  update public.stock_counts
  set status='cancelled',
      cancelled_by_user_id=p_actor_user_id,
      cancelled_at=now(),
      cancel_reason=v_reason,
      updated_at=now()
  where tenant_id=p_tenant_id and id=p_stock_count_id;

  return jsonb_build_object(
    'countId',p_stock_count_id,'status','cancelled','idempotentReplay',false
  );
end;
$$;

revoke all on function public.cancel_sellertray_stock_count(uuid,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.cancel_sellertray_stock_count(uuid,uuid,text,uuid)
  to service_role;

create or replace function public.get_sellertray_stock_count(
  p_tenant_id uuid,
  p_stock_count_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_count public.stock_counts%rowtype;
  v_items jsonb;
  v_total integer;
  v_captured integer;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  select * into v_count
  from public.stock_counts sc
  where sc.tenant_id=p_tenant_id and sc.id=p_stock_count_id;
  if not found then return null; end if;

  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,v_count.branch_id,v_user_id
  ) then
    raise exception 'You do not have access to this stock count'
      using errcode='42501';
  end if;
  if not (
    public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_count_stock')
    or public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_apply_stock_count')
  ) then
    raise exception 'You do not have permission to view stock counts'
      using errcode='42501';
  end if;

  select count(*)::integer,
         count(*) filter (where sci.is_captured)::integer,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'itemId',sci.id,
               'productId',sci.catalog_item_id,
               'productName',sci.product_name,
               'stockUom',sci.stock_uom,
               'captured',sci.is_captured,
               'selectedUom',sci.selected_uom,
               'countedQuantity',sci.counted_quantity,
               'conversionFactor',sci.conversion_factor,
               'countedStockQuantity',sci.counted_stock_quantity,
               'expectedStockQuantity',case when v_count.status='counting' then null else sci.expected_stock_quantity end,
               'varianceQuantity',case when v_count.status='counting' then null else sci.variance_quantity end,
               'capturedAt',sci.captured_at
             ) order by sci.product_name,sci.catalog_item_id
           ),
           '[]'::jsonb
         )
  into v_total,v_captured,v_items
  from public.stock_count_items sci
  where sci.tenant_id=p_tenant_id and sci.stock_count_id=p_stock_count_id;

  return jsonb_build_object(
    'countId',v_count.id,
    'branchId',v_count.branch_id,
    'reference',v_count.reference,
    'reason',v_count.reason,
    'status',v_count.status,
    'startedAt',v_count.started_at,
    'submittedAt',v_count.submitted_at,
    'appliedAt',v_count.applied_at,
    'cancelledAt',v_count.cancelled_at,
    'cancelReason',v_count.cancel_reason,
    'totalItems',v_total,
    'capturedItems',v_captured,
    'items',v_items
  );
end;
$$;

revoke all on function public.get_sellertray_stock_count(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_stock_count(uuid,uuid)
  to authenticated;

create or replace function public.get_sellertray_active_stock_count(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_count_id uuid;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,p_branch_id,v_user_id
  ) then
    raise exception 'You do not have access to stock counts in this branch'
      using errcode='42501';
  end if;
  if not (
    public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_count_stock')
    or public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_apply_stock_count')
  ) then
    return null;
  end if;

  select sc.id into v_count_id
  from public.stock_counts sc
  where sc.tenant_id=p_tenant_id
    and sc.branch_id=p_branch_id
    and sc.status in ('counting','review')
  order by sc.started_at desc,sc.id
  limit 1;

  if v_count_id is null then return null; end if;
  return public.get_sellertray_stock_count(p_tenant_id,v_count_id);
end;
$$;

revoke all on function public.get_sellertray_active_stock_count(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_active_stock_count(uuid,uuid)
  to authenticated;

commit;