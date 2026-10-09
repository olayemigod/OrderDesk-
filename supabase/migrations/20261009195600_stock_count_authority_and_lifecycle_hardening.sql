begin;

alter table public.stock_count_items
  drop constraint if exists stock_count_items_uom_same_tenant,
  add constraint stock_count_items_uom_same_tenant
    foreign key (tenant_id,catalog_item_id,counted_uom_id)
    references public.catalog_item_uoms(tenant_id,catalog_item_id,id)
    on delete cascade,
  drop constraint if exists stock_count_items_movement_same_tenant,
  add constraint stock_count_items_movement_same_tenant
    foreign key (tenant_id,applied_movement_id)
    references public.inventory_movements(tenant_id,id)
    on delete cascade;

create or replace function public.review_sellertray_stock_count(
  p_tenant_id uuid,
  p_count_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_count public.stock_counts%rowtype;
  v_missing integer;
begin
  select * into v_count
  from public.stock_counts sc
  where sc.tenant_id=p_tenant_id and sc.id=p_count_id
  for update;

  if not found then raise exception 'Stock count not found' using errcode='22023'; end if;

  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,v_count.branch_id,p_actor_user_id
  ) or not public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_count_stock'
  ) then
    raise exception 'You do not have permission to review this stock count'
      using errcode='42501';
  end if;

  if v_count.status='review' then
    return jsonb_build_object('countId',p_count_id,'status','review','idempotentReplay',true);
  end if;
  if v_count.status<>'counting' then
    raise exception 'Only an active stock count can move to review' using errcode='23514';
  end if;

  select count(*)::integer into v_missing
  from public.stock_count_items sci
  where sci.tenant_id=p_tenant_id
    and sci.stock_count_id=p_count_id
    and sci.captured_at is null;

  if v_missing>0 then
    raise exception '% product(s) still need a counted quantity',v_missing using errcode='23514';
  end if;

  update public.stock_counts
  set status='review',
      review_started_by=p_actor_user_id,
      review_started_at=now(),
      updated_at=now()
  where tenant_id=p_tenant_id and id=p_count_id;

  return jsonb_build_object('countId',p_count_id,'status','review','idempotentReplay',false);
end;
$$;

create or replace function public.cancel_sellertray_stock_count(
  p_tenant_id uuid,
  p_count_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_count public.stock_counts%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
begin
  if v_reason is null then raise exception 'Cancellation reason is required' using errcode='22023'; end if;

  select * into v_count
  from public.stock_counts sc
  where sc.tenant_id=p_tenant_id and sc.id=p_count_id
  for update;

  if not found then raise exception 'Stock count not found' using errcode='22023'; end if;

  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,v_count.branch_id,p_actor_user_id
  ) or not public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_count_stock'
  ) then
    raise exception 'You do not have permission to cancel this stock count'
      using errcode='42501';
  end if;

  if v_count.status='cancelled' then
    return jsonb_build_object('countId',p_count_id,'status','cancelled','idempotentReplay',true);
  end if;
  if v_count.status='applied' then
    raise exception 'An applied stock count cannot be cancelled' using errcode='23514';
  end if;

  update public.stock_counts
  set status='cancelled',cancelled_by=p_actor_user_id,cancelled_at=now(),
      cancel_reason=left(v_reason,500),updated_at=now()
  where tenant_id=p_tenant_id and id=p_count_id;

  return jsonb_build_object('countId',p_count_id,'status','cancelled','idempotentReplay',false);
end;
$$;

create or replace function public.apply_sellertray_stock_count(
  p_tenant_id uuid,
  p_count_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_count public.stock_counts%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_line record;
  v_current numeric(18,6);
  v_variance numeric(18,6);
  v_movement_id uuid;
  v_movement_count integer := 0;
  v_total_absolute_variance numeric(18,6) := 0;
begin
  if v_reason is null then raise exception 'Reconciliation reason is required' using errcode='22023'; end if;

  select * into v_count
  from public.stock_counts sc
  where sc.tenant_id=p_tenant_id and sc.id=p_count_id
  for update;

  if not found then raise exception 'Stock count not found' using errcode='22023'; end if;

  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,v_count.branch_id,p_actor_user_id
  ) then
    raise exception 'You do not have access to apply stock for this branch' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_apply_stock_count'
  ) then
    raise exception 'You do not have permission to apply stock count variances'
      using errcode='42501';
  end if;

  if v_count.status='applied' then
    select count(*)::integer,coalesce(sum(abs(im.quantity_delta)),0)::numeric(18,6)
    into v_movement_count,v_total_absolute_variance
    from public.inventory_movements im
    where im.tenant_id=p_tenant_id
      and im.reference_type='stock_count'
      and im.reference_id=v_count.reference;
    return jsonb_build_object(
      'countId',p_count_id,'reference',v_count.reference,'status','applied',
      'movementCount',v_movement_count,'totalAbsoluteVariance',v_total_absolute_variance,
      'idempotentReplay',true
    );
  end if;
  if v_count.status<>'review' then
    raise exception 'Review the completed count before applying it' using errcode='23514';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  if exists(
    select 1
    from public.catalog_items ci
    where ci.tenant_id=p_tenant_id
      and ci.is_active=true
      and not exists(
        select 1
        from public.stock_count_items sci
        where sci.tenant_id=p_tenant_id
          and sci.stock_count_id=p_count_id
          and sci.catalog_item_id=ci.id
      )
  ) then
    raise exception 'The product list changed after this count started. Cancel it and start a new count.'
      using errcode='40001';
  end if;

  for v_line in
    select sci.catalog_item_id
    from public.stock_count_items sci
    where sci.tenant_id=p_tenant_id and sci.stock_count_id=p_count_id
    order by sci.catalog_item_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      public.sellertray_inventory_lock_key(
        p_tenant_id,v_count.branch_id,v_count.stock_location_id,v_line.catalog_item_id
      )
    );
  end loop;

  for v_line in
    select sci.catalog_item_id,sci.expected_quantity
    from public.stock_count_items sci
    where sci.tenant_id=p_tenant_id and sci.stock_count_id=p_count_id
    order by sci.catalog_item_id
  loop
    select coalesce(sum(im.quantity_delta),0)::numeric(18,6)
    into v_current
    from public.inventory_movements im
    where im.tenant_id=p_tenant_id
      and im.branch_id=v_count.branch_id
      and im.stock_location_id=v_count.stock_location_id
      and im.catalog_item_id=v_line.catalog_item_id;

    if v_current is distinct from v_line.expected_quantity then
      raise exception 'Stock changed after this count started. Cancel it and start a new count before applying variances.'
        using errcode='40001';
    end if;
  end loop;

  for v_line in
    select
      sci.id,
      sci.catalog_item_id,
      sci.stock_uom,
      sci.expected_quantity,
      sci.counted_uom,
      sci.counted_quantity,
      sci.counted_conversion_factor,
      sci.counted_stock_quantity
    from public.stock_count_items sci
    where sci.tenant_id=p_tenant_id and sci.stock_count_id=p_count_id
    order by sci.catalog_item_id
  loop
    v_variance := round((v_line.counted_stock_quantity-v_line.expected_quantity)::numeric,6);
    v_total_absolute_variance := v_total_absolute_variance+abs(v_variance);

    if v_variance<>0 then
      v_movement_id := public.record_sellertray_inventory_movement(
        p_tenant_id,
        v_count.branch_id,
        v_count.stock_location_id,
        v_line.catalog_item_id,
        'count_reconciliation',
        v_variance,
        v_line.stock_uom,
        abs(v_variance),
        1,
        'stock_count',
        v_count.reference,
        'stock_count:'||p_count_id::text||':'||v_line.catalog_item_id::text,
        now(),
        p_actor_user_id,
        left(v_reason,500),
        jsonb_build_object(
          'stock_count_id',p_count_id,
          'expected_stock_quantity',v_line.expected_quantity,
          'counted_uom',v_line.counted_uom,
          'counted_quantity',v_line.counted_quantity,
          'counted_conversion_factor',v_line.counted_conversion_factor,
          'counted_stock_quantity',v_line.counted_stock_quantity
        ),
        null
      );

      update public.stock_count_items
      set applied_movement_id=v_movement_id,updated_at=now()
      where tenant_id=p_tenant_id and id=v_line.id;
      v_movement_count := v_movement_count+1;
    end if;
  end loop;

  update public.stock_counts
  set status='applied',applied_by=p_actor_user_id,applied_at=now(),
      apply_reason=left(v_reason,500),updated_at=now()
  where tenant_id=p_tenant_id and id=p_count_id;

  return jsonb_build_object(
    'countId',p_count_id,
    'reference',v_count.reference,
    'status','applied',
    'movementCount',v_movement_count,
    'totalAbsoluteVariance',v_total_absolute_variance,
    'idempotentReplay',false
  );
end;
$$;

commit;