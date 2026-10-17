begin;

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
  v_idempotent boolean := false;
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

  v_counted := round((p_quantity*v_conversion_factor)::numeric,6);

  if v_item.is_captured
     and lower(btrim(v_item.selected_uom))=lower(btrim(v_source_uom))
     and v_item.counted_quantity=p_quantity
     and v_item.conversion_factor=v_conversion_factor then
    v_expected := v_item.expected_stock_quantity;
    v_variance := v_item.variance_quantity;
    v_idempotent := true;
  else
    perform pg_catalog.pg_advisory_xact_lock(
      public.sellertray_inventory_lock_key(
        p_tenant_id,v_count.branch_id,v_count.stock_location_id,p_catalog_item_id
      )
    );

    if v_item.is_captured then
      -- A correction to the physical quantity keeps the original expected
      -- stock snapshot. Later sales/receipts must not shift the count baseline.
      v_expected := v_item.expected_stock_quantity;
    else
      select coalesce(sum(im.quantity_delta),0)::numeric(18,6)
      into v_expected
      from public.inventory_movements im
      where im.tenant_id=p_tenant_id
        and im.branch_id=v_count.branch_id
        and im.stock_location_id=v_count.stock_location_id
        and im.catalog_item_id=p_catalog_item_id;
    end if;

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
  end if;

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
    'capturedItems',v_captured,
    'idempotentReplay',v_idempotent
  );
end;
$$;

revoke all on function public.capture_sellertray_stock_count_item(uuid,uuid,uuid,uuid,numeric,uuid)
  from public,anon,authenticated;
grant execute on function public.capture_sellertray_stock_count_item(uuid,uuid,uuid,uuid,numeric,uuid)
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
    when v_count.status='review' or (v_count.status='cancelled' and v_count.submitted_at is not null)
      then 'can_apply_stock_count'
    else 'can_count_stock'
  end;
  if not public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,v_required_capability
  ) then
    raise exception 'You do not have permission to cancel this stock count'
      using errcode='42501';
  end if;

  if v_count.status='cancelled' then
    return jsonb_build_object(
      'countId',p_stock_count_id,'status','cancelled','idempotentReplay',true
    );
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

commit;