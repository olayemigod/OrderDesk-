begin;

create or replace function public.receive_sellertray_purchase_order(
  p_tenant_id uuid,
  p_purchase_order_id uuid,
  p_reference text,
  p_notes text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_reference text := nullif(btrim(coalesce(p_reference,'')),'');
  v_notes text := nullif(btrim(coalesce(p_notes,'')),'');
  v_items_fingerprint text;
  v_input_count integer;
  v_distinct_count integer;
  v_po public.sellertray_purchase_orders%rowtype;
  v_supplier_name text;
  v_existing_receipt public.sellertray_purchase_receipts%rowtype;
  v_existing_item_count integer;
  v_receipt_id uuid;
  v_row jsonb;
  v_item_id uuid;
  v_quantity numeric(18,6);
  v_item public.sellertray_purchase_order_items%rowtype;
  v_current_factor numeric(18,6);
  v_current_uom text;
  v_result jsonb;
  v_movement_id uuid;
  v_stock_quantity numeric(18,6);
  v_count integer := 0;
  v_complete boolean;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if v_reference is null then raise exception 'Receipt reference is required' using errcode='22023'; end if;
  if char_length(v_reference)>120 then raise exception 'Receipt reference is too long' using errcode='22023'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>200 then
    raise exception 'Receipt must contain between 1 and 200 items' using errcode='22023';
  end if;

  begin
    with normalized as (
      select
        nullif(value->>'purchaseOrderItemId','')::uuid as item_id,
        round(nullif(value->>'quantity','')::numeric,6) as quantity
      from jsonb_array_elements(p_items)
    )
    select
      count(*)::integer,
      count(distinct item_id)::integer,
      pg_catalog.md5(pg_catalog.string_agg(
        item_id::text || ':' || quantity::text,
        '|' order by item_id
      ))
    into v_input_count,v_distinct_count,v_items_fingerprint
    from normalized
    where item_id is not null and quantity is not null and quantity>0;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Receipt contains an invalid purchase item or quantity' using errcode='22023';
  end;

  if v_input_count<>jsonb_array_length(p_items) or v_items_fingerprint is null then
    raise exception 'Every receipt item requires a valid purchase item and positive quantity' using errcode='22023';
  end if;
  if v_distinct_count<>v_input_count then
    raise exception 'Each purchase item can appear only once in a receipt' using errcode='22023';
  end if;

  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_po
  from public.sellertray_purchase_orders po
  where po.tenant_id=p_tenant_id and po.id=p_purchase_order_id
  for update;
  if not found then raise exception 'Purchase order not found' using errcode='P0002'; end if;

  select s.name into v_supplier_name
  from public.sellertray_suppliers s
  where s.tenant_id=p_tenant_id and s.id=v_po.supplier_id;
  if not found then raise exception 'Purchase order supplier is unavailable' using errcode='P0002'; end if;

  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_po.branch_id,v_user_id) then
    raise exception 'You do not have access to receive stock for this Branch' using errcode='42501';
  end if;
  if not public.sellertray_purchase_management_role(p_tenant_id,v_user_id) then
    raise exception 'Purchase Receiving is available to business management only' using errcode='42501';
  end if;

  select * into v_existing_receipt
  from public.sellertray_purchase_receipts r
  where r.tenant_id=p_tenant_id and lower(btrim(r.reference))=lower(v_reference)
  limit 1;
  if found then
    if v_existing_receipt.purchase_order_id<>p_purchase_order_id then
      raise exception 'Receipt reference is already used for another purchase' using errcode='23505';
    end if;
    if v_existing_receipt.items_fingerprint<>v_items_fingerprint
       or coalesce(btrim(v_existing_receipt.notes),'')<>coalesce(v_notes,'') then
      raise exception 'Receipt reference is already used for different receiving facts' using errcode='23505';
    end if;
    select count(*)::integer into v_existing_item_count
    from public.sellertray_purchase_receipt_items ri
    where ri.tenant_id=p_tenant_id and ri.receipt_id=v_existing_receipt.id;
    return jsonb_build_object(
      'receiptId',v_existing_receipt.id,'purchaseOrderId',v_existing_receipt.purchase_order_id,
      'reference',v_existing_receipt.reference,'status',v_po.status,
      'itemCount',v_existing_item_count,'idempotentReplay',true
    );
  end if;

  if v_po.status not in ('ordered','partially_received') then
    raise exception 'Only an ordered purchase can receive stock' using errcode='23514';
  end if;

  v_receipt_id := gen_random_uuid();
  insert into public.sellertray_purchase_receipts(
    id,tenant_id,purchase_order_id,branch_id,supplier_id,reference,notes,items_fingerprint,
    received_by,received_at,created_at
  ) values(
    v_receipt_id,p_tenant_id,v_po.id,v_po.branch_id,v_po.supplier_id,v_reference,v_notes,
    v_items_fingerprint,v_user_id,now(),now()
  );

  for v_row in select value from jsonb_array_elements(p_items)
  loop
    v_count := v_count + 1;
    begin
      v_item_id := nullif(v_row->>'purchaseOrderItemId','')::uuid;
      v_quantity := round(nullif(v_row->>'quantity','')::numeric,6);
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Receipt item % has an invalid purchase item or quantity',v_count using errcode='22023';
    end;
    if v_item_id is null or v_quantity is null or v_quantity<=0 then
      raise exception 'Receipt item % requires a positive quantity',v_count using errcode='22023';
    end if;

    select * into v_item
    from public.sellertray_purchase_order_items i
    where i.tenant_id=p_tenant_id and i.purchase_order_id=v_po.id and i.id=v_item_id
    for update;
    if not found then raise exception 'Receipt item % is not part of this purchase order',v_count using errcode='23503'; end if;
    if v_item.received_quantity+v_quantity>v_item.ordered_quantity then
      raise exception 'Receipt quantity for % exceeds the remaining ordered quantity',v_item.product_name using errcode='23514';
    end if;

    select u.conversion_factor,u.uom_name into v_current_factor,v_current_uom
    from public.catalog_item_uoms u
    where u.tenant_id=p_tenant_id and u.catalog_item_id=v_item.catalog_item_id and u.id=v_item.uom_id;
    if not found then
      raise exception 'The purchase unit for % is no longer available',v_item.product_name using errcode='23514';
    end if;
    if v_current_factor<>v_item.conversion_factor or lower(v_current_uom)<>lower(v_item.selected_uom) then
      raise exception 'The unit conversion for % changed after this purchase was placed; review the purchase before receiving stock',v_item.product_name using errcode='23514';
    end if;

    v_result := public.apply_sellertray_inventory_operation(
      p_tenant_id,
      v_po.branch_id,
      v_item.catalog_item_id,
      v_item.uom_id,
      'receive',
      v_quantity,
      null,
      left(v_reference || '/' || v_item.id::text,160),
      left('Purchase receipt ' || v_reference || ' from ' || coalesce(v_supplier_name,'supplier'),500),
      v_user_id
    );

    begin
      v_movement_id := nullif(v_result->>'movementId','')::uuid;
    exception when invalid_text_representation then
      v_movement_id := null;
    end;
    v_stock_quantity := round((v_quantity*v_item.conversion_factor)::numeric,6);
    if v_movement_id is null
       or abs(coalesce((v_result->>'quantityDelta')::numeric,0)-v_stock_quantity)>0.000001 then
      raise exception 'SellerTray could not confirm the stock movement for %',v_item.product_name using errcode='23514';
    end if;

    insert into public.sellertray_purchase_receipt_items(
      tenant_id,receipt_id,purchase_order_item_id,catalog_item_id,uom_id,selected_uom,
      conversion_factor,received_quantity,received_stock_quantity,inventory_movement_id,created_at
    ) values(
      p_tenant_id,v_receipt_id,v_item.id,v_item.catalog_item_id,v_item.uom_id,v_item.selected_uom,
      v_item.conversion_factor,v_quantity,v_stock_quantity,v_movement_id,now()
    );

    update public.sellertray_purchase_order_items
    set received_quantity=received_quantity+v_quantity,
        received_stock_quantity=received_stock_quantity+v_stock_quantity
    where tenant_id=p_tenant_id and id=v_item.id;
  end loop;

  select not exists(
    select 1 from public.sellertray_purchase_order_items i
    where i.tenant_id=p_tenant_id and i.purchase_order_id=v_po.id
      and i.received_quantity<i.ordered_quantity
  ) into v_complete;

  update public.sellertray_purchase_orders
  set status=case when v_complete then 'received' else 'partially_received' end,
      received_at=case when v_complete then coalesce(received_at,now()) else received_at end,
      updated_at=now()
  where tenant_id=p_tenant_id and id=v_po.id
  returning * into v_po;

  return jsonb_build_object(
    'receiptId',v_receipt_id,'purchaseOrderId',v_po.id,'reference',v_reference,
    'status',v_po.status,'itemCount',v_count,'idempotentReplay',false
  );
end;
$$;

revoke all on function public.receive_sellertray_purchase_order(uuid,uuid,text,text,jsonb)
  from public,anon;
grant execute on function public.receive_sellertray_purchase_order(uuid,uuid,text,text,jsonb)
  to authenticated;

commit;
